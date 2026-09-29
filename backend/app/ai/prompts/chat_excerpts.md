<!--
Sent with a chat question instead of the whole book when the book is too long for the model's
context window: the pages around the reader's page, the pages that best match the question's
words, and pages the last answer cited.

Placeholders: {{pages}}, the pages' text with [p. N] markers.
-->
The whole book is too long to include, so here are excerpts: the pages around where the reader is, pages that match words in their question, and pages the conversation has cited. Base your answer on these, and say when they aren't enough to answer fully.

<excerpts>
{{pages}}
</excerpts>
