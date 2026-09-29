import { useCallback, useEffect, useRef, useState } from 'react'
import { createLookup, deleteLookup, listLookups, type Lookup, type LookupRequest } from '../api'

/** One card in the Lookups panel: a request in flight, one that failed, or an answer. */
export type LookupCard = {
  key: string
  expanded: boolean
  request: LookupRequest
  /** What the card is titled while there's no answer yet. */
  query: string
  lookup: Lookup | null
  status: 'pending' | 'error' | 'done'
  error?: string
}

export type Lookups = ReturnType<typeof useLookups>

/** The book's lookups, newest first, and the actions on them. */
export function useLookups(bookId: number) {
  const [cards, setCards] = useState<LookupCard[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const nextKey = useRef(0)

  useEffect(() => {
    let stale = false
    listLookups(bookId)
      .then((lookups) => {
        if (stale) return
        // Only the most recent starts open; the rest are one line each until clicked.
        setCards(lookups.map((lookup, i) => fromLookup(lookup, i === 0)))
      })
      .catch((e: Error) => !stale && setLoadError(e.message))
    return () => {
      stale = true
    }
  }, [bookId])

  const patch = useCallback((key: string, change: Partial<LookupCard>) => {
    setCards((cs) => cs && cs.map((c) => (c.key === key ? { ...c, ...change } : c)))
  }, [])

  const send = useCallback(
    (key: string, request: LookupRequest) => {
      createLookup(bookId, request)
        .then((lookup) => {
          setCards((cs) => {
            if (!cs?.some((c) => c.key === key)) return cs // removed while in flight
            // A saved answer may already have a card: this one replaces it.
            return cs
              .filter((c) => c.key === key || c.lookup?.id !== lookup.id)
              .map((c) => (c.key === key ? { ...c, lookup, status: 'done', error: undefined } : c))
          })
        })
        .catch((e: Error) => patch(key, { status: 'error', error: e.message }))
    },
    [bookId, patch],
  )

  /** Look up a selection: a new card at the top, open, with the others folded away. */
  const run = useCallback(
    (request: LookupRequest, query: string) => {
      const key = `new-${nextKey.current++}`
      const card: LookupCard = { key, expanded: true, request, query, lookup: null, status: 'pending' }
      setCards((cs) => [card, ...(cs ?? []).map((c) => ({ ...c, expanded: false }))])
      send(key, request)
    },
    [send],
  )

  const retry = useCallback(
    (card: LookupCard) => {
      patch(card.key, { status: 'pending', error: undefined })
      send(card.key, card.request)
    },
    [patch, send],
  )

  /** Ask again, replacing a saved answer. */
  const regenerate = useCallback(
    (card: LookupCard) => {
      const request = { ...card.request, refresh: true }
      patch(card.key, { status: 'pending', error: undefined, expanded: true, request })
      send(card.key, request)
    },
    [patch, send],
  )

  const remove = useCallback(
    (card: LookupCard) => {
      setCards((cs) => cs && cs.filter((c) => c.key !== card.key))
      if (card.lookup) deleteLookup(bookId, card.lookup.id).catch(() => {})
    },
    [bookId],
  )

  const toggle = useCallback(
    (card: LookupCard) => patch(card.key, { expanded: !card.expanded }),
    [patch],
  )

  return { cards, loadError, run, retry, regenerate, remove, toggle }
}

function fromLookup(lookup: Lookup, expanded: boolean): LookupCard {
  return {
    key: `lookup-${lookup.id}`,
    expanded,
    // Asking again re-anchors the saved wording on its page.
    request: { kind: lookup.kind, page: lookup.page_number, text: lookup.query_text },
    query: lookup.query_text,
    lookup,
    status: 'done',
  }
}
