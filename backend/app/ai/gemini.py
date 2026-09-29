"""The Gemini API client: the one module that talks to Gemini.

Everything else goes through `Gemini`, reached with `require_gemini()`. Tests replace
`gemini_client` with a fake.
"""

import logging
from collections.abc import Iterator
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import datetime
from functools import cache
from typing import Literal

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

from app.config import get_settings

log = logging.getLogger("uvicorn.error")

TIMEOUT_MS = 180_000  # creating a cache for a long book takes a while
DEFAULT_INPUT_LIMIT = 1_048_576

NOT_CONFIGURED = (
    "AI features need a Gemini API key. Add GEMINI_API_KEY to .env and restart the app."
)


class GeminiError(Exception):
    """A failed Gemini call, with a message fit to show the reader."""

    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.message = message
        self.code = code

    @property
    def http_status(self) -> int:
        """The status our API answers with: rate limits pass through, the rest is a bad gateway."""
        return 429 if self.code == 429 else 502


class NotConfigured(GeminiError):
    def __init__(self) -> None:
        super().__init__(NOT_CONFIGURED)

    @property
    def http_status(self) -> int:
        return 503


class CacheMissing(GeminiError):
    """The cache expired or was deleted on Gemini's side."""


@dataclass(frozen=True)
class CacheInfo:
    name: str
    expires_at: datetime
    token_count: int | None


@dataclass(frozen=True)
class Usage:
    input: int = 0  # prompt tokens, cached ones included
    cached: int = 0
    output: int = 0
    thinking: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


@dataclass(frozen=True)
class Generated[T: BaseModel]:
    result: T
    usage: Usage


@dataclass(frozen=True)
class Turn:
    """One side's turn in a conversation. Its parts reach the model as one message."""

    role: Literal["user", "model"]
    parts: tuple[str, ...]


class TextStream:
    """An answer as it's written. Iterate for the text in pieces; once that ends, `usage` says
    what it cost and `complete` whether the model finished (rather than hit its output limit
    or a safety stop). Close it to stop early."""

    def __init__(self, responses: Iterator[types.GenerateContentResponse], uses_cache: bool):
        self._responses = responses
        self._uses_cache = uses_cache
        self.usage = Usage()
        self.finish_reason: str | None = None

    @property
    def complete(self) -> bool:
        return self.finish_reason in (None, "STOP")

    def __iter__(self) -> Iterator[str]:
        wrote = False
        last = None
        while True:
            # The request goes out at the first chunk, so errors can arrive at any step.
            response = _call(lambda: next(self._responses, None), self._uses_cache)
            if response is None:
                break
            last = response
            if response.usage_metadata:
                self.usage = _usage(response.usage_metadata)
            candidate = response.candidates[0] if response.candidates else None
            if candidate is None:
                continue
            if candidate.finish_reason:
                self.finish_reason = candidate.finish_reason.value
            for part in (candidate.content.parts if candidate.content else None) or []:
                if part.text and not part.thought:
                    wrote = True
                    yield part.text
        if not wrote:
            why = _why_empty(last) if last else "empty response"
            raise GeminiError(f"Gemini returned no answer ({why}). Try again.")

    def close(self) -> None:
        close = getattr(self._responses, "close", None)
        if close:
            close()


class Gemini:
    def __init__(self, api_key: str, *, transport: httpx.BaseTransport | None = None):
        """`transport` swaps the HTTP layer, for tests that check what reaches the wire."""
        retries = types.HttpRetryOptions(attempts=3)  # on 408, 429, and 5xx; the default is 5
        options = types.HttpOptions(timeout=TIMEOUT_MS, retry_options=retries)
        if transport:
            options.httpx_client = httpx.Client(transport=transport)
            options.retry_options = types.HttpRetryOptions(attempts=1)
        self._client = genai.Client(api_key=api_key, http_options=options)
        self._limits: dict[str, int] = {}

    def input_token_limit(self, model: str) -> int:
        if model not in self._limits:
            info = _call(lambda: self._client.models.get(model=model))
            self._limits[model] = info.input_token_limit or DEFAULT_INPUT_LIMIT
        return self._limits[model]

    def create_cache(
        self, model: str, *, system: str, text: str, ttl_seconds: int, display_name: str
    ) -> CacheInfo:
        created = _call(
            lambda: self._client.caches.create(
                model=model,
                config=types.CreateCachedContentConfig(
                    display_name=display_name,
                    system_instruction=system,
                    contents=[text],
                    ttl=f"{ttl_seconds}s",
                ),
            )
        )
        usage = created.usage_metadata
        return CacheInfo(
            name=created.name or "",
            expires_at=created.expire_time or datetime.now().astimezone(),
            token_count=usage.total_token_count if usage else None,
        )

    def extend_cache(self, name: str, ttl_seconds: int) -> datetime:
        updated = _call(
            lambda: self._client.caches.update(
                name=name, config=types.UpdateCachedContentConfig(ttl=f"{ttl_seconds}s")
            ),
            uses_cache=True,
        )
        return updated.expire_time or datetime.now().astimezone()

    def delete_cache(self, name: str) -> None:
        """Delete a cache. One that's already gone is fine."""
        with suppress(CacheMissing):
            _call(lambda: self._client.caches.delete(name=name), uses_cache=True)

    def generate[T: BaseModel](
        self,
        model: str,
        schema: type[T],
        *,
        contents: list[str],
        system: str | None = None,
        cache_name: str | None = None,
        thinking: str | None = None,
    ) -> Generated[T]:
        """Ask for JSON matching `schema`. With `cache_name`, the system prompt comes from the
        cache (Gemini rejects both at once)."""
        config = _config(
            system,
            cache_name,
            thinking,
            response_mime_type="application/json",
            response_schema=schema,
        )
        response = _call(
            lambda: self._client.models.generate_content(
                model=model, contents=contents, config=config
            ),
            uses_cache=cache_name is not None,
        )
        if not response.text:
            raise GeminiError(f"Gemini returned no answer ({_why_empty(response)}). Try again.")
        try:
            result = schema.model_validate_json(response.text)
        except ValidationError as e:
            log.warning("gemini: answer didn't match %s: %s", schema.__name__, e)
            raise GeminiError("Gemini's answer was malformed. Try again.") from e
        return Generated(result=result, usage=_usage(response.usage_metadata))

    def stream(
        self,
        model: str,
        *,
        turns: list[Turn],
        system: str | None = None,
        cache_name: str | None = None,
        thinking: str | None = None,
    ) -> TextStream:
        """Ask for prose, streamed. Nothing is sent until the stream is read."""
        contents = [
            types.Content(role=t.role, parts=[types.Part(text=p) for p in t.parts]) for t in turns
        ]
        responses = self._client.models.generate_content_stream(
            model=model, contents=contents, config=_config(system, cache_name, thinking)
        )
        return TextStream(responses, uses_cache=cache_name is not None)


def gemini_client() -> Gemini | None:
    """The shared client, or None when no API key is set."""
    key = get_settings().gemini_api_key
    return _client_for(key) if key else None


def require_gemini() -> Gemini:
    if (client := gemini_client()) is None:
        raise NotConfigured
    return client


@cache
def _client_for(api_key: str) -> Gemini:
    return Gemini(api_key)


def _config(
    system: str | None, cache_name: str | None, thinking: str | None, **extra
) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=None if cache_name else system,
        cached_content=cache_name,
        thinking_config=types.ThinkingConfig(thinking_level=thinking) if thinking else None,
        # No tools are declared; this also stops the SDK logging a warning per request.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        **extra,
    )


def _call(fn, uses_cache: bool = False):
    """Run an SDK call, turning its errors into GeminiError."""
    try:
        return fn()
    except errors.APIError as e:
        # An expired or deleted cache answers 403 or 404, depending on the call.
        if uses_cache and e.code in (403, 404):
            raise CacheMissing(f"Gemini cache is gone: {e.message}", e.code) from e
        raise GeminiError(_describe(e), e.code) from e
    except httpx.TransportError as e:
        raise GeminiError(f"Couldn't reach Gemini: {e or type(e).__name__}") from e


def _describe(e: errors.APIError) -> str:
    message = (e.message or e.status or "").strip()
    if e.code == 429:
        return "Gemini's rate limit or quota is used up. Wait a minute and try again."
    if e.code and e.code >= 500:
        return f"Gemini is having trouble ({e.code}). Try again in a moment."
    if "API key" in message:
        return f"Gemini didn't accept the API key: {message} Check GEMINI_API_KEY in .env."
    return f"Gemini error {e.code}: {message}"


def _why_empty(response: types.GenerateContentResponse) -> str:
    feedback = response.prompt_feedback
    if feedback and feedback.block_reason:
        return f"blocked: {feedback.block_reason}"
    if response.candidates and response.candidates[0].finish_reason:
        return f"stopped: {response.candidates[0].finish_reason}"
    return "empty response"


def _usage(meta: types.GenerateContentResponseUsageMetadata | None) -> Usage:
    if meta is None:
        return Usage()
    return Usage(
        input=meta.prompt_token_count or 0,
        cached=meta.cached_content_token_count or 0,
        output=meta.candidates_token_count or 0,
        thinking=meta.thoughts_token_count or 0,
    )
