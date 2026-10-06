import { useCallback, useEffect, useState } from 'react'
import {
  createHighlight,
  deleteHighlight,
  type Highlight,
  type HighlightColor,
  type HighlightRequest,
  listHighlights,
  updateHighlight,
} from '../api'
import { readPref, writePref } from '../prefs'

export type Highlights = ReturnType<typeof useHighlights>

const COLOR_PREF = 'obelus.highlight.color'
const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink']

/**
 * The book's highlights in reading order, and the actions on them. `focused` is the one the
 * panel brings into view (just made, or clicked on the page); `editing` has its note open.
 */
export function useHighlights(bookId: number) {
  const [items, setItems] = useState<Highlight[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  // New highlights take the colour last chosen.
  const [color, setColor] = useState<HighlightColor>(() => {
    const saved = readPref(COLOR_PREF) as HighlightColor | null
    return saved && COLORS.includes(saved) ? saved : 'yellow'
  })

  useEffect(() => {
    let stale = false
    listHighlights(bookId)
      .then((list) => !stale && setItems(list))
      .catch((e: Error) => !stale && setLoadError(e.message))
    return () => {
      stale = true
    }
  }, [bookId])

  const put = useCallback((h: Highlight) => {
    setItems((list) => sorted([...(list ?? []).filter((x) => x.id !== h.id), h]))
  }, [])

  /** Highlight a passage, and with `withNote`, open its note to type in. */
  const create = useCallback(
    async (request: Omit<HighlightRequest, 'color'>, { withNote = false } = {}) => {
      const h = await createHighlight(bookId, { ...request, color })
      put(h)
      setFocused(h.id)
      if (withNote) setEditing(h.id)
      return h
    },
    [bookId, color, put],
  )

  const update = useCallback(
    async (h: Highlight, changes: { color?: HighlightColor; note?: string }) => {
      if (changes.color) {
        setColor(changes.color)
        writePref(COLOR_PREF, changes.color)
      }
      put({ ...h, ...changes }) // shown straight away, put back if the save fails
      try {
        put(await updateHighlight(bookId, h.id, changes))
      } catch (e) {
        put(h)
        throw e
      }
    },
    [bookId, put],
  )

  const remove = useCallback(
    async (h: Highlight) => {
      setItems((list) => list && list.filter((x) => x.id !== h.id))
      try {
        await deleteHighlight(bookId, h.id)
      } catch (e) {
        put(h)
        throw e
      }
    },
    [bookId, put],
  )

  const focus = useCallback((id: number | null) => {
    setFocused(id)
  }, [])

  return { items, loadError, focused, focus, editing, setEditing, color, create, update, remove }
}

/** Reading order, as the backend sorts them: page, place on the page, then age. */
function sorted(list: Highlight[]): Highlight[] {
  const place = (h: Highlight) => h.char_start ?? Number.POSITIVE_INFINITY
  return list.toSorted(
    (a, b) =>
      a.page_number - b.page_number || place(a) - place(b) || a.created_at.localeCompare(b.created_at) || a.id - b.id,
  )
}
