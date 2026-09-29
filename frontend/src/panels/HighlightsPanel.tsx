import { Download, Highlighter, NotebookPen, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type Highlight, type HighlightColor, notesUrl } from '../api'
import { Button, cx, Dialog, EmptyState, Kbd, Note, PageRef, type Swatch, Swatches, Textarea } from '../ui'
import type { Highlights } from './useHighlights'
import './highlights.css'

type Props = {
  bookId: number
  highlights: Highlights
  labels: string[] | null
  onGo: (page: number) => void
  /** Show a highlight on its page. */
  onReveal: (h: Highlight) => void
}

const COLORS: Swatch<HighlightColor>[] = [
  { value: 'yellow', label: 'Yellow', color: 'var(--highlight-yellow)' },
  { value: 'green', label: 'Green', color: 'var(--highlight-green)' },
  { value: 'blue', label: 'Blue', color: 'var(--highlight-blue)' },
  { value: 'pink', label: 'Pink', color: 'var(--highlight-pink)' },
]

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/** The book's highlights and notes, grouped by page in reading order. */
export default function HighlightsPanel({ bookId, highlights, labels, onGo, onReveal }: Props) {
  const { items, loadError } = highlights
  const [removing, setRemoving] = useState<Highlight | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = (p: Promise<unknown>) => {
    setError(null)
    p.catch((e: Error) => setError(e.message))
  }
  const remove = (h: Highlight) => (h.note ? setRemoving(h) : act(highlights.remove(h)))

  if (loadError) {
    return (
      <div className="highlights-message">
        <Note tone="error">Couldn’t load this book’s highlights: {loadError}</Note>
      </div>
    )
  }
  if (items === null) return null
  if (items.length === 0) {
    return (
      <EmptyState icon={Highlighter} title="Highlights">
        <p>
          Select a passage and press <Kbd>H</Kbd> to highlight it, or <Kbd>N</Kbd> to add a note. They collect here in
          page order, and Export notes saves them with your lookups as Markdown.
        </p>
      </EmptyState>
    )
  }

  const pages = new Map<number, Highlight[]>()
  for (const h of items) pages.set(h.page_number, [...(pages.get(h.page_number) ?? []), h])
  return (
    <div className="highlights">
      <div className="highlights-bar">
        <span className="highlights-count">
          {items.length} {items.length === 1 ? 'highlight' : 'highlights'}
        </span>
        <Button
          size="sm"
          icon={Download}
          title="Highlights, notes, and lookups as a Markdown file"
          onClick={() => download(notesUrl(bookId))}
        >
          Export notes
        </Button>
      </div>
      {error && (
        <div className="highlights-message">
          <Note tone="error">{error}</Note>
        </div>
      )}
      <ol className="highlight-pages">
        {[...pages].map(([page, list]) => (
          <li key={page}>
            <h3 className="highlight-page">
              <PageRef page={page} labels={labels} onGo={onGo} />
            </h3>
            <ul className="highlight-list">
              {list.map((h) => (
                <Item
                  key={h.id}
                  highlight={h}
                  focused={highlights.focused === h.id}
                  editing={highlights.editing === h.id}
                  onReveal={() => {
                    highlights.focus(h.id)
                    onReveal(h)
                  }}
                  onEdit={(open) => highlights.setEditing(open ? h.id : null)}
                  onColor={(color) => act(highlights.update(h, { color }))}
                  onNote={(note) => act(highlights.update(h, { note }))}
                  onRemove={() => remove(h)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this highlight?"
        description="Its note is removed with it. This can’t be undone."
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) act(highlights.remove(removing))
                setRemoving(null)
              }}
            >
              Remove highlight
            </Button>
          </>
        }
      />
    </div>
  )
}

type ItemProps = {
  highlight: Highlight
  focused: boolean
  editing: boolean
  onReveal: () => void
  onEdit: (open: boolean) => void
  onColor: (color: HighlightColor) => void
  onNote: (note: string) => void
  onRemove: () => void
}

function Item({ highlight: h, focused, editing, onReveal, onEdit, onColor, onNote, onRemove }: ItemProps) {
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  return (
    <li ref={row} className={cx('highlight-item', focused && 'is-focused')}>
      <button
        type="button"
        className={cx('highlight-quote', `ink-${h.color}`)}
        title="Show on the page"
        onClick={onReveal}
      >
        {h.selected_text}
      </button>
      {editing ? (
        <NoteEditor
          initial={h.note}
          onDone={(note) => {
            if (note !== h.note) onNote(note)
            onEdit(false)
          }}
          onCancel={() => onEdit(false)}
        />
      ) : (
        h.note && (
          <p className="highlight-note" onDoubleClick={() => onEdit(true)}>
            {h.note}
          </p>
        )
      )}
      <div className="highlight-actions">
        <Swatches label="Highlight colour" options={COLORS} value={h.color} onChange={onColor} />
        <span className="highlight-actions-end">
          {!editing && (
            <Button variant="ghost" size="sm" icon={NotebookPen} onClick={() => onEdit(true)}>
              {h.note ? 'Edit note' : 'Add note'}
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={Trash2} aria-label="Remove" title="Remove" onClick={onRemove} />
        </span>
      </div>
    </li>
  )
}

/** A note being written. Saved by clicking away or ⌘/Ctrl+Enter; Esc cancels. */
function NoteEditor({
  initial,
  onDone,
  onCancel,
}: {
  initial: string
  onDone: (note: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const input = useRef<HTMLTextAreaElement>(null)
  const closed = useRef(false)
  const finish = (save: boolean) => {
    if (closed.current) return
    closed.current = true
    if (save) onDone(text.trim())
    else onCancel()
  }

  useEffect(() => {
    const el = input.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <div className="highlight-editor">
      <Textarea
        ref={input}
        autoGrow
        rows={2}
        value={text}
        placeholder="Your note"
        aria-label="Note"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            finish(false)
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish(true)
        }}
      />
      <p className="highlight-editor-hint">
        <Kbd>{MOD}</Kbd>
        <Kbd>Enter</Kbd> or click away to save · <Kbd>Esc</Kbd> to cancel
      </p>
    </div>
  )
}

/** Save a file the server names with Content-Disposition. */
function download(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.append(a)
  a.click()
  a.remove()
}
