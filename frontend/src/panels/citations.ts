// The model cites pages as [p. 12], [pp. 12–14], or [p. 12, 40] (see backend prompts/system.md).
const CITATION = /\[(pp?)\.\s*([^\]]+)\]/g
const REF = /^(\d+)(?:\s*[–—-]\s*(\d+))?$/

export type PageCitation = { page: number; end?: number }

export type TextPart = string | { refs: PageCitation[] }

/** Split text into plain runs and citations of pages that exist. */
export function splitCitations(text: string, pageCount: number): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(CITATION)) {
    const refs = parseRefs(match[2], pageCount)
    if (!refs) continue // brackets that aren't a citation of a real page stay as text
    parts.push(text.slice(last, match.index), { refs })
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}

/** Text without its citations, for one-line previews. */
export function stripCitations(text: string): string {
  return text
    .replace(CITATION, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function parseRefs(inner: string, pageCount: number): PageCitation[] | null {
  const refs: PageCitation[] = []
  for (const item of inner.split(/[,;]/)) {
    const m = item.trim().match(REF)
    if (!m) return null
    const page = Number(m[1])
    const end = m[2] ? Number(m[2]) : undefined
    if (page < 1 || page > pageCount) return null
    if (end !== undefined && (end < page || end > pageCount)) return null
    refs.push({ page, end })
  }
  return refs.length ? refs : null
}
