"""The real Gemini client over a mocked HTTP transport: checks what the SDK puts on the wire
and how we read its answers and errors. Worth re-running after upgrading google-genai."""

import json

import httpx
import pytest

from app.ai.gemini import CacheMissing, Gemini, GeminiError, Turn
from app.ai.schemas import DefineResult

ANSWER = {
    "term": "negation",
    "in_context": "Negation drives thought forward [p. 1].",
    "general": None,
    "across_book": None,
    "key_pages": [{"page": 1, "note": "Introduced"}],
}


STREAM = [
    {
        "candidates": [
            {
                "content": {
                    "role": "model",
                    "parts": [
                        {"text": "Weighing the passage…", "thought": True},
                        {"text": "Negation drives "},
                    ],
                }
            }
        ],
    },
    {
        "candidates": [
            {
                "content": {"role": "model", "parts": [{"text": "thought [p. 1]."}]},
                "finishReason": "STOP",
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 52000,
            "cachedContentTokenCount": 51234,
            "candidatesTokenCount": 12,
            "thoughtsTokenCount": 30,
        },
    },
]


def error(code: int, status: str, message: str) -> httpx.Response:
    return httpx.Response(
        code, json={"error": {"code": code, "status": status, "message": message}}
    )


class Wire:
    """Answers like the Gemini API and records each request's method, path, and JSON body."""

    def __init__(self):
        self.requests: list[tuple[str, str, dict | None]] = []
        self.queries: list[str] = []
        self.next_error: httpx.Response | None = None
        # What a streamed answer sends, one server-sent event per chunk.
        self.chunks: list[dict] = STREAM

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        path = request.url.path
        self.requests.append((request.method, path, body))
        self.queries.append(request.url.query.decode())
        if self.next_error is not None:
            response, self.next_error = self.next_error, None
            return response
        if request.method == "POST" and path.endswith("/cachedContents"):
            return httpx.Response(
                200,
                json={
                    "name": "cachedContents/abc",
                    "expireTime": "2026-09-29T12:00:00Z",
                    "usageMetadata": {"totalTokenCount": 51234},
                },
            )
        if request.method == "PATCH":
            return httpx.Response(
                200, json={"name": "cachedContents/abc", "expireTime": "2026-09-29T13:00:00Z"}
            )
        if path.endswith(":streamGenerateContent"):
            events = "".join(f"data: {json.dumps(c)}\r\n\r\n" for c in self.chunks)
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, content=events.encode()
            )
        if path.endswith(":generateContent"):
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {"role": "model", "parts": [{"text": json.dumps(ANSWER)}]},
                            "finishReason": "STOP",
                        }
                    ],
                    "usageMetadata": {
                        "promptTokenCount": 52000,
                        "cachedContentTokenCount": 51234,
                        "candidatesTokenCount": 90,
                        "thoughtsTokenCount": 30,
                    },
                },
            )
        if request.method == "GET":
            return httpx.Response(200, json={"name": path, "inputTokenLimit": 1048576})
        return error(500, "INTERNAL", f"unexpected {request.method} {path}")


@pytest.fixture
def wire() -> Wire:
    return Wire()


@pytest.fixture
def client(wire) -> Gemini:
    return Gemini("test-key", transport=httpx.MockTransport(wire))


def test_cache_lifecycle(client, wire):
    info = client.create_cache(
        "gemini-3.8-flash", system="SYS", text="<book>…</book>", ttl_seconds=3600, display_name="b"
    )
    assert (info.name, info.token_count) == ("cachedContents/abc", 51234)
    assert info.expires_at.isoformat() == "2026-09-29T12:00:00+00:00"
    _, path, body = wire.requests[-1]
    assert path.endswith("/cachedContents")
    assert body["model"] == "models/gemini-3.8-flash"
    assert body["ttl"] == "3600s"
    assert body["systemInstruction"]["parts"] == [{"text": "SYS"}]
    assert body["contents"] == [{"role": "user", "parts": [{"text": "<book>…</book>"}]}]

    assert client.extend_cache("cachedContents/abc", 3600).hour == 13
    assert wire.requests[-1][2] == {"ttl": "3600s"}

    wire.next_error = error(404, "NOT_FOUND", "not found")
    client.delete_cache("cachedContents/abc")  # already gone is fine


def test_generate_with_a_cache(client, wire):
    out = client.generate(
        "gemini-3.8-flash",
        DefineResult,
        contents=["the question"],
        system="SYS",
        cache_name="cachedContents/abc",
        thinking="low",
    )
    assert out.result == DefineResult.model_validate(ANSWER)
    assert out.usage.as_dict() == {"input": 52000, "cached": 51234, "output": 90, "thinking": 30}
    body = wire.requests[-1][2]
    assert body["cachedContent"] == "cachedContents/abc"
    assert "systemInstruction" not in body  # it's in the cache; Gemini rejects both
    config = body["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["responseSchema"]["properties"]["general"]["nullable"] is True
    assert config["thinkingConfig"] == {"thinking_level": "LOW"}


def test_generate_inline(client, wire):
    client.generate("gemini-3.8-flash", DefineResult, contents=["<book>", "q"], system="SYS")
    body = wire.requests[-1][2]
    assert body["systemInstruction"]["parts"] == [{"text": "SYS"}]
    assert body["contents"][0]["parts"] == [{"text": "<book>"}, {"text": "q"}]
    assert "thinkingConfig" not in body["generationConfig"]


def test_errors(client, wire):
    wire.next_error = error(403, "PERMISSION_DENIED", "CachedContent not found")
    with pytest.raises(CacheMissing):
        client.generate("m", DefineResult, contents=["q"], cache_name="cachedContents/old")

    wire.next_error = error(429, "RESOURCE_EXHAUSTED", "Quota exceeded")
    with pytest.raises(GeminiError) as e:
        client.generate("m", DefineResult, contents=["q"])
    assert e.value.http_status == 429
    assert "rate limit" in e.value.message

    wire.next_error = error(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid key.")
    with pytest.raises(GeminiError) as e:
        client.input_token_limit("gemini-3.8-flash")
    assert "GEMINI_API_KEY" in e.value.message
    assert e.value.http_status == 502

    wire.next_error = httpx.Response(
        200, json={"candidates": [{"content": {"parts": []}, "finishReason": "SAFETY"}]}
    )
    with pytest.raises(GeminiError, match="no answer"):
        client.generate("m", DefineResult, contents=["q"])


def test_stream(client, wire):
    turns = [
        Turn("user", ("<book>", "instructions", "first question")),
        Turn("model", ("first answer",)),
        Turn("user", ("second question",)),
    ]
    stream = client.stream("gemini-3.1-pro-preview", turns=turns, system="SYS", thinking="high")
    assert wire.requests == []  # nothing is sent until it's read
    # Thought parts stay out of the answer.
    assert list(stream) == ["Negation drives ", "thought [p. 1]."]
    assert stream.complete
    assert stream.usage.as_dict() == {"input": 52000, "cached": 51234, "output": 12, "thinking": 30}

    _, path, body = wire.requests[-1]
    assert path.endswith("/models/gemini-3.1-pro-preview:streamGenerateContent")
    assert wire.queries[-1] == "alt=sse"
    assert body["contents"] == [
        {
            "role": "user",
            "parts": [{"text": "<book>"}, {"text": "instructions"}, {"text": "first question"}],
        },
        {"role": "model", "parts": [{"text": "first answer"}]},
        {"role": "user", "parts": [{"text": "second question"}]},
    ]
    assert body["systemInstruction"]["parts"] == [{"text": "SYS"}]
    assert body["generationConfig"] == {"thinkingConfig": {"thinking_level": "HIGH"}}


def test_stream_with_a_cache_and_its_endings(client, wire):
    turns = [Turn("user", ("q",))]
    wire.chunks = [
        {**STREAM[1], "candidates": [{**STREAM[1]["candidates"][0], "finishReason": "MAX_TOKENS"}]}
    ]
    stream = client.stream("m", turns=turns, system="SYS", cache_name="cachedContents/abc")
    assert list(stream) == ["thought [p. 1]."]
    assert not stream.complete
    body = wire.requests[-1][2]
    assert body["cachedContent"] == "cachedContents/abc"
    assert "systemInstruction" not in body

    wire.next_error = error(403, "PERMISSION_DENIED", "CachedContent not found")
    with pytest.raises(CacheMissing):
        list(client.stream("m", turns=turns, cache_name="cachedContents/old"))

    wire.next_error = error(429, "RESOURCE_EXHAUSTED", "Quota exceeded")
    with pytest.raises(GeminiError, match="rate limit"):
        list(client.stream("m", turns=turns))

    wire.chunks = [{"promptFeedback": {"blockReason": "SAFETY"}}]
    with pytest.raises(GeminiError, match="no answer .blocked"):
        list(client.stream("m", turns=turns))
