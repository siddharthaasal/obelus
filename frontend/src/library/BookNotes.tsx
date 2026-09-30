import type { Book } from '../api'
import { Note } from '../ui'

/** What went wrong with a book, or what it still needs. */
export default function BookNotes({ book }: { book: Book }) {
  return (
    <>
      {book.error && <Note tone={book.status === 'failed' ? 'error' : 'info'}>{book.error}</Note>}
      {book.status === 'ready' && book.needs_ocr_pages > 0 && (
        <Note>
          {book.needs_ocr_pages} page{book.needs_ocr_pages > 1 ? 's have' : ' has'} no usable text and
          will need OCR.
        </Note>
      )}
    </>
  )
}
