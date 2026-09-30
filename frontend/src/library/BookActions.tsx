import { Pencil, RotateCw, ScanText, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { type Book, updateBook } from '../api'
import { Button, ButtonLink, Dialog, Field, Input, Note } from '../ui'

export type BookHandlers = {
  onReprocess: () => void
  /** Called once the user has confirmed. */
  onRemove: () => void
  onSaved: () => void
}

/**
 * A book's secondary actions as ghost icon buttons (inspect, edit, reprocess, remove), with
 * their dialogs. Every library view uses these, so they behave the same in each.
 */
export default function BookActions({ book, onReprocess, onRemove, onSaved }: { book: Book } & BookHandlers) {
  const [dialog, setDialog] = useState<'edit' | 'remove' | null>(null)
  const close = () => setDialog(null)

  return (
    <>
      {book.status === 'ready' && (
        <ButtonLink
          to={`/books/${book.id}/debug/${book.last_read_page ?? 1}`}
          variant="ghost"
          size="sm"
          icon={ScanText}
          aria-label="Inspect text"
          title="Inspect extracted text"
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={Pencil}
        aria-label="Edit title and author"
        title="Edit title and author"
        onClick={() => setDialog('edit')}
      />
      {(book.status === 'ready' || book.status === 'failed') && (
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCw}
          aria-label="Reprocess"
          title="Extract and clean the text again"
          onClick={onReprocess}
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={Trash2}
        aria-label="Remove"
        title="Remove from library"
        onClick={() => setDialog('remove')}
      />

      {dialog === 'edit' && (
        <EditDialog
          book={book}
          onClose={close}
          onSaved={() => {
            close()
            onSaved()
          }}
        />
      )}
      <Dialog
        open={dialog === 'remove'}
        onClose={close}
        title={`Remove “${book.title}”?`}
        description="Its PDF moves to the trash folder in your data directory."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                close()
                onRemove()
              }}
            >
              Remove book
            </Button>
          </>
        }
      />
    </>
  )
}

/** Mounted only while editing, so the fields start from the current values each time. */
function EditDialog({ book, onClose, onSaved }: { book: Book; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateBook(book.id, { title, author: author.trim() || null })
      onSaved()
    } catch (err) {
      setError(`Couldn't save: ${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      onSubmit={save}
      title="Edit book"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !title.trim()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label="Author">
        <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Field>
      {error && <Note tone="error">{error}</Note>}
    </Dialog>
  )
}
