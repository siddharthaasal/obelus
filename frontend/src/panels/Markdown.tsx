import { type ReactNode, useMemo } from 'react'
import CitedText from './CitedText'
import { parseBlocks } from './blocks'
import './markdown.css'

type Props = {
  text: string
  labels: string[] | null
  pageCount: number
  onGo: (page: number) => void
}

// **strong**, __strong__, *em*, _em_ (not inside a word), and `code`.
const INLINE =
  /\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])|`([^`]+)`/g

/**
 * A chat answer: the Markdown subset the model writes, with its page citations as links.
 * Rendered as React elements, never as HTML, so the model can't inject markup.
 */
export default function Markdown({ text, labels, pageCount, onGo }: Props) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  const inline = (t: string) => <Inline text={t} cite={(s) => <CitedText text={s} labels={labels} pageCount={pageCount} onGo={onGo} />} />

  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') return <p key={i} className="md-heading">{inline(b.text)}</p>
        if (b.kind === 'quote') return <blockquote key={i}>{inline(b.text)}</blockquote>
        if (b.kind === 'paragraph') return <p key={i}>{inline(b.text)}</p>
        const items = b.items.map((item, j) => <li key={j}>{inline(item)}</li>)
        return b.ordered ? (
          <ol key={i} start={b.start === 1 ? undefined : b.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        )
      })}
    </div>
  )
}

function Inline({ text, cite }: { text: string; cite: (text: string) => ReactNode }): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parts.push(<span key={last}>{cite(text.slice(last, m.index))}</span>)
    const [, strong, strongAlt, em, emAlt, code] = m
    const inner = strong ?? strongAlt ?? em ?? emAlt
    if (code !== undefined) parts.push(<code key={m.index}>{code}</code>)
    else if (strong !== undefined || strongAlt !== undefined)
      parts.push(
        <strong key={m.index}>
          <Inline text={inner!} cite={cite} />
        </strong>,
      )
    else
      parts.push(
        <em key={m.index}>
          <Inline text={inner!} cite={cite} />
        </em>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={last}>{cite(text.slice(last))}</span>)
  return parts
}
