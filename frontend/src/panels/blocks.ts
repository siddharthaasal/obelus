// The Markdown chat answers come in: paragraphs, lists, quotes, and headings (which the
// prompt asks the model to avoid, but it sometimes writes them anyway). Everything else is
// text. Inline marks are handled by Markdown.tsx.

export type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }

const ITEM = /^\s{0,3}(?:([-*+•])|(\d{1,3})[.)])\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/

/** Split Markdown into blocks. Lines within a block are joined with spaces. */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let quote: string[] = []
  let list: Extract<Block, { kind: 'list' }> | null = null
  // A blank line ends paragraphs and quotes; a list survives one if another item follows.
  let afterBlank = false

  const flushText = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    if (quote.length) blocks.push({ kind: 'quote', text: quote.join(' ') })
    paragraph = []
    quote = []
  }
  const flushAll = () => {
    flushText()
    if (list) blocks.push(list)
    list = null
  }

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim()) {
      flushText()
      afterBlank = true
      continue
    }
    if (RULE.test(line)) {
      flushAll()
      afterBlank = false
      continue
    }
    const item = line.match(ITEM)
    const heading = !item && line.match(HEADING)
    const quoted = !item && !heading && line.match(QUOTE)
    if (heading) {
      flushAll()
      blocks.push({ kind: 'heading', text: heading[1] })
    } else if (item) {
      flushText()
      const ordered = item[2] !== undefined
      if (list && list.ordered !== ordered) flushAll()
      list ??= { kind: 'list', ordered, start: ordered ? Number(item[2]) : 1, items: [] }
      list.items.push(item[3].trim())
    } else if (quoted) {
      if (list) flushAll()
      if (paragraph.length) flushText()
      quote.push(quoted[1].trim())
    } else if (list && (!afterBlank || /^\s/.test(line))) {
      // A continuation of the last item.
      list.items[list.items.length - 1] += ` ${line.trim()}`
    } else if (quote.length && !afterBlank) {
      quote.push(line.trim())
    } else {
      if (list) flushAll()
      paragraph.push(line.trim())
    }
    afterBlank = false
  }
  flushAll()
  return blocks
}
