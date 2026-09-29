import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { type Book, updateBook } from '../api'

const STATUS_LABEL: Record<Book['status'], string> = {
  queued: 'Queued',
  extracting: 'Extracting text',
  embedding: 'Indexing',
  ready: 'Ready',
  failed: 'Failed',
}

type Props = {
  book: Book
  onReprocess: () => void
  onRemove: () => void
  onSaved: () => void
  onError: (message: string) => void
}

export default function BookRow({ book, onReprocess, onRemove, onSaved, onError }: Props) {
  const [editing, setEditing] = useState(false)

  return (
    <li className="book">
      {editing ? (
        <EditForm
          book={book}
          onDone={() => {
            setEditing(false)
            onSaved()
          }}
          onCancel={() => setEditing(false)}
          onError={onError}
        />
      ) : (
        <div className="book-main">
          <h2 className="book-title">{book.title}</h2>
          <p className="book-meta">
            {[book.author, book.page_count && `${book.page_count} pages`, book.file_name]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {book.error && <p className={`book-error ${book.status}`}>{book.error}</p>}
          {book.status === 'ready' && book.needs_ocr_pages > 0 && (
            <p className="book-note">
              {book.needs_ocr_pages} page{book.needs_ocr_pages > 1 ? 's have' : ' has'} no usable
              text and will need OCR.
            </p>
          )}
        </div>
      )}
      <div className="book-side">
        <span className={`status ${book.status}`}>{STATUS_LABEL[book.status]}</span>
        {!editing && (
          <div className="book-actions">
            {book.status === 'ready' && <Link to={`/books/${book.id}/debug/1`}>Inspect text</Link>}
            <button type="button" className="link" onClick={() => setEditing(true)}>
              Edit
            </button>
            {(book.status === 'ready' || book.status === 'failed') && (
              <button type="button" className="link" onClick={onReprocess}>
                Reprocess
              </button>
            )}
            <button type="button" className="link danger" onClick={onRemove}>
              Remove
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

function EditForm({
  book,
  onDone,
  onCancel,
  onError,
}: {
  book: Book
  onDone: () => void
  onCancel: () => void
  onError: (message: string) => void
}) {
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author ?? '')
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateBook(book.id, { title, author: author.trim() || null })
      onDone()
    } catch (err) {
      onError(`Couldn't save: ${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <form
      className="book-main edit"
      onSubmit={save}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </label>
      <label>
        Author
        <input value={author} onChange={(e) => setAuthor(e.target.value)} />
      </label>
      <div className="edit-actions">
        <button type="submit" className="primary" disabled={saving || !title.trim()}>
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
