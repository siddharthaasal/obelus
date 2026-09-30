import { BookOpen } from 'lucide-react'
import { Link } from 'react-router'
import type { Book } from '../api'
import { Badge, ButtonLink, StatusIcon } from '../ui'
import BookActions, { type BookHandlers } from './BookActions'
import BookNotes from './BookNotes'
import { isReadable, progressLabel, readerUrl, STATUS } from './status'

export default function BookRow({ book, ...handlers }: { book: Book } & BookHandlers) {
  const status = STATUS[book.status]
  const readable = isReadable(book)
  const progress = progressLabel(book)

  return (
    <li className="book-row">
      <StatusIcon state={status.state} progress={status.progress} label={status.label} />
      <div className="book-main">
        <div className="book-title-row">
          <h2 className="book-title">
            {readable ? <Link to={readerUrl(book)}>{book.title}</Link> : book.title}
          </h2>
          {book.status !== 'ready' && (
            <Badge tone={book.status === 'failed' ? 'red' : 'neutral'}>{status.label}</Badge>
          )}
        </div>
        <p className="book-meta">
          {book.author && <span className="book-author">{book.author}</span>}
          {progress && <span className="tabular">{progress}</span>}
          <span className="book-file text-mono" title={book.file_name}>
            {book.file_name}
          </span>
        </p>
        <BookNotes book={book} />
      </div>

      <div className="book-actions">
        {readable && (
          <ButtonLink to={readerUrl(book)} variant="ghost" size="sm" icon={BookOpen}>
            {book.last_read_page ? 'Continue' : 'Read'}
          </ButtonLink>
        )}
        <BookActions book={book} {...handlers} />
      </div>
    </li>
  )
}
