import { ChevronRight, RotateCw, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { Lookup, PageNote } from '../api'
import { Badge, Button, cx, Note, PageRef, StatusIcon } from '../ui'
import CitedText from './CitedText'
import { stripCitations } from './citations'
import { KINDS } from './kinds'
import type { LookupCard as Card } from './useLookups'

type Props = {
  card: Card
  labels: string[] | null
  pageCount: number
  onGo: (page: number) => void
  onToggle: () => void
  onRetry: () => void
  onRegenerate: () => void
  onRemove: () => void
}

// A book's first lookup can wait on Gemini reading the whole book into its cache.
const SLOW_MS = 5000

export default function LookupCard({ card, labels, pageCount, onGo, onToggle, onRetry, onRegenerate, onRemove }: Props) {
  const { lookup, status, expanded } = card
  const kind = KINDS[card.request.kind]
  const Icon = kind.icon
  const cite = (text: string) => <CitedText text={text} labels={labels} pageCount={pageCount} onGo={onGo} />

  return (
    <li className={cx('lookup', expanded && 'is-open')}>
      <div className="lookup-head">
        <button type="button" className="lookup-toggle" aria-expanded={expanded} onClick={onToggle}>
          <ChevronRight size={12} className="lookup-chevron" aria-hidden />
          <Icon size={14} className="lookup-icon" aria-hidden />
          <span className="lookup-kind">{kind.label}</span>
          <span className={cx('lookup-title', card.request.kind === 'explain' && 'is-passage')}>
            {title(card)}
          </span>
        </button>
        <PageRef page={card.request.page} labels={labels} onGo={onGo} />
        <span className="lookup-actions">
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCw}
            aria-label="Ask again"
            title="Ask again"
            disabled={status === 'pending'}
            onClick={lookup ? onRegenerate : onRetry}
          />
          <Button variant="ghost" size="sm" icon={Trash2} aria-label="Remove" title="Remove" onClick={onRemove} />
        </span>
      </div>

      {status === 'pending' && <Pending />}
      {status === 'error' && (
        <div className="lookup-status">
          <Note tone="error">{card.error}</Note>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {status !== 'pending' && lookup && (expanded ? <Answer lookup={lookup} cite={cite} labels={labels} onGo={onGo} /> : <p className="lookup-preview">{preview(lookup)}</p>)}
    </li>
  )
}

function Answer({
  lookup,
  cite,
  labels,
  onGo,
}: {
  lookup: Lookup
  cite: (text: string) => ReactNode
  labels: string[] | null
  onGo: (page: number) => void
}) {
  const pages = (title: string, items: PageNote[]) =>
    items.length > 0 && (
      <Section title={title}>
        <ul className="lookup-pages">
          {items.map((p) => (
            <li key={p.page}>
              <PageRef page={p.page} labels={labels} onGo={onGo} />
              <span>{p.note}</span>
            </li>
          ))}
        </ul>
      </Section>
    )

  return (
    <div className="lookup-body">
      {lookup.kind === 'define' && (
        <>
          <Section title="In this book">{cite(lookup.response.in_context)}</Section>
          {lookup.response.general && <Section title="Generally">{cite(lookup.response.general)}</Section>}
          {lookup.response.across_book && <Section title="Across the book">{cite(lookup.response.across_book)}</Section>}
          {pages('Key pages', lookup.response.key_pages)}
        </>
      )}
      {lookup.kind === 'who' && (
        <>
          <Section title="Background">{lookup.response.bio}</Section>
          <Section
            title={
              <>
                To the author
                {lookup.response.relation_label && <Badge tone="violet">{lookup.response.relation_label}</Badge>}
              </>
            }
          >
            {cite(lookup.response.relation)}
          </Section>
          <Section title="Here">{cite(lookup.response.here)}</Section>
          {pages('Other pages', lookup.response.key_pages)}
        </>
      )}
      {lookup.kind === 'explain' && (
        <>
          <blockquote className="lookup-quote">{lookup.query_text}</blockquote>
          <Section title="In plain terms">{cite(lookup.response.restatement)}</Section>
          {lookup.response.key_terms.length > 0 && (
            <Section title="Key terms">
              <dl className="lookup-terms">
                {lookup.response.key_terms.map((t) => (
                  <div key={t.term}>
                    <dt>{t.term}</dt>
                    <dd>{cite(t.meaning)}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          <Section title="In the argument">{cite(lookup.response.in_argument)}</Section>
          {pages('Related pages', lookup.response.related_pages)}
        </>
      )}
      {lookup.context_mode === 'excerpt' && (
        <Note>This book is too long to send whole, so this answer draws on excerpts from it.</Note>
      )}
      <p className="lookup-meta text-mono">{lookup.model}</p>
    </div>
  )
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="lookup-section">
      <h3 className="lookup-section-title">{title}</h3>
      <div className="lookup-text">{children}</div>
    </section>
  )
}

function Pending() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <p className="lookup-status" role="status">
      <StatusIcon state="progress" progress={0.3} />
      {slow ? 'Still working. A book’s first lookup takes longer while Gemini reads it.' : 'Looking it up…'}
    </p>
  )
}

function title(card: Card): string {
  const { lookup } = card
  if (lookup?.kind === 'define') return lookup.response.term || lookup.query_text
  if (lookup?.kind === 'who') return lookup.response.name || lookup.query_text
  return lookup?.query_text ?? card.query
}

function preview(lookup: Lookup): string {
  if (lookup.kind === 'define') return stripCitations(lookup.response.in_context)
  if (lookup.kind === 'who') return lookup.response.bio
  return stripCitations(lookup.response.restatement)
}
