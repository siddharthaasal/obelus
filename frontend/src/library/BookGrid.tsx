import { Link } from 'react-router'
import type { Book } from '../api'
import { Badge, StatusIcon } from '../ui'
import BookActions, { type BookHandlers } from './BookActions'
import BookCover from './BookCover'
import { isReadable, progressLabel, readerUrl, STATUS } from './status'

type Props = {
  books: Book[]
  uploading: number
  handlers: (book: Book) => BookHandlers
}

/** Covers in a grid. The cover opens the book; the other actions appear on hover. */
export default function BookGrid({ books, uploading, handlers }: Props) {
  return (
    <ul className="book-grid">
      {uploading > 0 && (
        <li className="book-card book-card-pending">
          <span className="cover">
            <span className="cover-placeholder">
              <StatusIcon state="progress" progress={0.25} />
            </span>
          </span>
          <p className="book-card-meta">
            Adding {uploading} file{uploading > 1 ? 's' : ''}…
          </p>
        </li>
      )}
      {books.map((book) => (
        <BookCard key={book.id} book={book} {...handlers(book)} />
      ))}
    </ul>
  )
}

function BookCard({ book, ...handlers }: { book: Book } & BookHandlers) {
  const status = STATUS[book.status]
  const progress = progressLabel(book)
  const cover = <BookCover key={book.id} book={book} />

  return (
    <li className="book-card">
      <div className="book-card-cover">
        {isReadable(book) ? (
          <Link to={readerUrl(book)} tabIndex={-1} aria-hidden>
            {cover}
          </Link>
        ) : (
          cover
        )}
        <div className="book-card-actions">
          <BookActions book={book} {...handlers} />
        </div>
      </div>
      <div className="book-card-body">
        <h2 className="book-card-title" title={book.title}>
          {isReadable(book) ? <Link to={readerUrl(book)}>{book.title}</Link> : book.title}
        </h2>
        {book.author && (
          <p className="book-card-meta" title={book.author}>
            {book.author}
          </p>
        )}
        {book.status === 'ready' ? (
          progress && <p className="book-card-meta tabular">{progress}</p>
        ) : (
          <p className="book-card-status">
            <StatusIcon state={status.state} progress={status.progress} />
            {book.status === 'failed' ? <Badge tone="red">{status.label}</Badge> : status.label}
          </p>
        )}
      </div>
    </li>
  )
}
