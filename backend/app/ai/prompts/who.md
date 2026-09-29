<!--
Who is this: the `w` action. The answer's fields are fixed by WhoResult in app/ai/schemas.py;
this file says what goes in each.

Placeholders: {{name}}, {{page}}, {{passage}} (the paragraph around the selection), and
{{occurrences}} (a sentence listing pages where full-text search found the name).
-->
The reader selected the name "{{name}}" on [p. {{page}}], in this passage:

<passage>
{{passage}}
</passage>

Say who this is and why they matter to this book.

{{occurrences}}

Fill in:

- name: the full name as usually written, for example "Johann Gottlieb Fichte". If the selection names a group, school, or work rather than a person, name that instead. If you can't tell who is meant, give the name as selected.
- relation_label: one to three lowercase words for their relation to the author, such as "influence", "opponent", "source", "teacher", "contemporary", "commentator", "interlocutor", or "example".
- bio: two or three sentences on who they were: dates, and what they're known for. This comes from general knowledge, not the book. If you're unsure who is meant, say so instead of guessing.
- relation: their relevance to the author (influence, opponent, source, and so on) in two or three sentences, citing the pages where the book shows it.
- here: how the author uses them in this passage, in one to three sentences.
- key_pages: up to six other pages where they matter most, each with a note of under fifteen words. Prefer pages from the search results above. An empty list if there are none.
