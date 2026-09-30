import type { Book } from '../api'
import type { StatusState } from '../ui'

export const STATUS: Record<Book['status'], { label: string; state: StatusState; progress?: number }> = {
  queued: { label: 'Queued', state: 'idle' },
  extracting: { label: 'Extracting text', state: 'progress', progress: 0.4 },
  embedding: { label: 'Indexing', state: 'progress', progress: 0.75 },
  ready: { label: 'Ready', state: 'done' },
  failed: { label: 'Failed', state: 'error' },
}

// Reading only needs the PDF; a failed book is usually one pdf.js can't open either.
export const isReadable = (book: Book) => book.status !== 'failed'

export const readerUrl = (book: Book) => `/books/${book.id}`

/** "Page 12 of 300", or "300 pages" before the book has been opened. */
export function progressLabel(book: Book): string | null {
  if (!book.page_count) return null
  return book.last_read_page
    ? `Page ${book.last_read_page} of ${book.page_count}`
    : `${book.page_count} pages`
}
