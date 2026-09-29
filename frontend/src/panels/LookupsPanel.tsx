import { Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AiStatus } from '../api'
import { EmptyState, Kbd, Note } from '../ui'
import LookupCard from './LookupCard'
import type { Lookups } from './useLookups'
import './lookups.css'

type Props = {
  lookups: Lookups
  ai: AiStatus | null
  labels: string[] | null
  pageCount: number
  onGo: (page: number) => void
}

/** Lookup cards for the open book, newest first. */
export default function LookupsPanel({ lookups, ai, labels, pageCount, onGo }: Props) {
  const { cards, loadError } = lookups
  const list = useRef<HTMLOListElement>(null)
  const newest = cards?.[0]?.key

  // A new lookup lands at the top; bring it into view if the list was scrolled.
  useEffect(() => {
    list.current?.closest('.reader-side-body')?.scrollTo({ top: 0 })
  }, [newest])

  if (loadError) {
    return (
      <div className="lookups-message">
        <Note tone="error">Couldn’t load this book’s lookups: {loadError}</Note>
      </div>
    )
  }
  if (cards === null) return null
  if (cards.length === 0) {
    return (
      <EmptyState icon={Search} title="Lookups">
        <p>
          Select a term, a name, or a passage in the book, then press <Kbd>D</Kbd> to define it in this book’s
          sense, <Kbd>W</Kbd> to learn who it is, or <Kbd>E</Kbd> to have it explained. Answers cite their pages.
        </p>
        {ai && !ai.configured && (
          <div className="lookups-setup">
            <Note tone="error">{ai.problem}</Note>
          </div>
        )}
      </EmptyState>
    )
  }
  return (
    <ol ref={list} className="lookups">
      {cards.map((card) => (
        <LookupCard
          key={card.key}
          card={card}
          labels={labels}
          pageCount={pageCount}
          onGo={onGo}
          onToggle={() => lookups.toggle(card)}
          onRetry={() => lookups.retry(card)}
          onRegenerate={() => lookups.regenerate(card)}
          onRemove={() => lookups.remove(card)}
        />
      ))}
    </ol>
  )
}
