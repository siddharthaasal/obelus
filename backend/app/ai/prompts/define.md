<!--
Define in context: the `d` action. The answer's fields are fixed by DefineResult in
app/ai/schemas.py; this file says what goes in each.

Placeholders: {{term}}, {{page}}, {{passage}} (the paragraph around the selection), and
{{occurrences}} (a sentence listing pages where full-text search found the term).
-->
The reader selected the term "{{term}}" on [p. {{page}}], in this passage:

<passage>
{{passage}}
</passage>

Explain what the term means in this book.

{{occurrences}}

Fill in:

- term: the term as the book writes it, without surrounding punctuation.
- in_context: what the author means by it, in two to four sentences with page citations. Start from the sense it has in the passage above.
- general: its ordinary or dictionary meaning in one or two sentences, only if that differs meaningfully from the author's use. Otherwise null.
- across_book: how the author's use of it develops or shifts across the book, in two to four sentences with page citations. Null if it's used the same way throughout, or appears only here.
- key_pages: the three to six pages most worth reading to understand the term, each with a note of under fifteen words on what that page adds. Prefer pages from the search results above.
