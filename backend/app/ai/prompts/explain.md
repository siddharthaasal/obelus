<!--
Explain passage: the `e` action. The answer's fields are fixed by ExplainResult in
app/ai/schemas.py; this file says what goes in each.

Placeholders: {{page}}, {{selection}} (the selected text), and {{context}} (the paragraphs
around it).
-->
The reader selected this passage on [p. {{page}}] and wants it explained:

<selection>
{{selection}}
</selection>

It sits in this context:

<context>
{{context}}
</context>

Fill in:

- restatement: the passage in plain language, as one short paragraph. Keep the author's claims and how they connect (what follows from what), and drop the jargon. Don't add claims the passage doesn't make.
- key_terms: up to five terms in the passage that a reader needs, each with what it means here in one sentence. An empty list if there are none.
- in_argument: where the passage fits in the argument, in two to four sentences with page citations: what question or claim it answers, and what it sets up.
- related_pages: up to five pages that shed light on the passage (where a term is defined, where the argument continues), each with a note of under fifteen words.
