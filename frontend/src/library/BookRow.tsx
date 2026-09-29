import { Pencil, RotateCw, ScanText, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { type Book, updateBook } from '../api'
import {
  Badge,
  Button,
  ButtonLink,
  Dialog,
  Field,
  Input,
  Note,
  StatusIcon,
  type StatusState,
} from '../ui'

const STATUS: Record<Book['status'], { label: string; state: StatusState; progress?: number }> = {
  queued: { label: 'Queued', state: 'idle' },
  extracting: { label: 'Extracting text', state: 'progress', progress: 0.4 },
  embedding: { label: 'Indexing', state: 'progress', progress: 0.75 },
  ready: { label: 'Ready', state: 'done' },
  failed: { label: 'Failed', state: 'error' },
}

type Props = {
  book: Book
  onReprocess: () => void
  /** Called once the user has confirmed. */
  onRemove: () => void
  onSaved: () => void
}

export default function BookRow({ book, onReprocess, onRemove, onSaved }: Props) {
  const [dialog, setDialog] = useState<'edit' | 'remove' | null>(null)
  const close = () => setDialog(null)
  const status = STATUS[book.status]

  return (
    <li className="book-row">
      <StatusIcon state={status.state} progress={status.progress} label={status.label} />
      <div className="book-main">
        <div className="book-title-row">
          <h2 className="book-title">{book.title}</h2>
          {book.status !== 'ready' && (
            <Badge tone={book.status === 'failed' ? 'red' : 'neutral'}>{status.label}</Badge>
          )}
        </div>
        <p className="book-meta">
          {book.author && <span className="book-author">{book.author}</span>}
          {book.page_count ? <span className="tabular">{book.page_count} pages</span> : null}
          <span className="book-file text-mono" title={book.file_name}>
            {book.file_name}
          </span>
        </p>
        {book.error && <Note tone={book.status === 'failed' ? 'error' : 'info'}>{book.error}</Note>}
        {book.status === 'ready' && book.needs_ocr_pages > 0 && (
          <Note>
            {book.needs_ocr_pages} page{book.needs_ocr_pages > 1 ? 's have' : ' has'} no usable text
            and will need OCR.
          </Note>
        )}
      </div>

      <div className="book-actions">
        {book.status === 'ready' && (
          <ButtonLink to={`/books/${book.id}/debug/1`} variant="ghost" size="sm" icon={ScanText}>
            Inspect text
          </ButtonLink>
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
      </div>

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
    </li>
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
