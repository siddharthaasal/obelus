import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Book,
  deleteBook,
  getLibraryInfo,
  isBusy,
  listBooks,
  reprocessBook,
  scanLibrary,
  uploadBook,
} from '../api'
import BookRow from './BookRow'

type Message = { id: number; kind: 'info' | 'error'; text: string }

const POLL_BUSY_MS = 1500
// The backend scans the library folder every 10s; this picks up what it finds.
const POLL_IDLE_MS = 5000

export default function LibraryPage() {
  const [books, setBooks] = useState<Book[] | null>(null)
  const [libraryDir, setLibraryDir] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [messages, setMessages] = useState<Message[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setMessages((m) => m.filter((x) => x.id !== id)), [])
  const say = useCallback(
    (kind: Message['kind'], text: string) => {
      const id = nextId.current++
      setMessages((m) => [...m, { id, kind, text }])
      if (kind === 'info') setTimeout(() => dismiss(id), 6000)
    },
    [dismiss],
  )

  const refresh = useCallback(
    () =>
      listBooks().then(setBooks, (e: Error) =>
        say('error', `Couldn't load the library: ${e.message}`),
      ),
    [say],
  )

  useEffect(() => {
    refresh()
    getLibraryInfo()
      .then((info) => setLibraryDir(info.library_dir))
      .catch(() => {})
  }, [refresh])

  const busy = books?.some(isBusy) ?? false
  useEffect(() => {
    const timer = setInterval(refresh, busy ? POLL_BUSY_MS : POLL_IDLE_MS)
    return () => clearInterval(timer)
  }, [busy, refresh])

  const addFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      if (pdfs.length < files.length) say('error', 'Only PDF files can be added.')
      setUploading((n) => n + pdfs.length)
      for (const file of pdfs) {
        try {
          const { duplicate, book } = await uploadBook(file)
          if (duplicate) say('info', `${file.name} is already in your library as “${book.title}”.`)
          await refresh()
        } catch (e) {
          say('error', `Couldn't add ${file.name}: ${(e as Error).message}`)
        } finally {
          setUploading((n) => n - 1)
        }
      }
    },
    [refresh, say],
  )

  const dragging = useFileDrop(addFiles)

  async function act(action: () => Promise<unknown>, failure: string) {
    try {
      await action()
    } catch (e) {
      say('error', `${failure}: ${(e as Error).message}`)
    }
    await refresh()
  }

  async function rescan() {
    try {
      const { added, duplicates } = await scanLibrary()
      const parts = [added ? `Added ${added}` : 'No new PDFs found']
      if (duplicates) parts.push(`skipped ${duplicates} duplicate${duplicates > 1 ? 's' : ''}`)
      say('info', `${parts.join(', ')}.`)
    } catch (e) {
      say('error', `Scan failed: ${(e as Error).message}`)
    }
    await refresh()
  }

  function remove(book: Book) {
    const ok = window.confirm(
      `Remove “${book.title}” from the library?\n\nIts PDF moves to the trash folder in your data directory.`,
    )
    if (ok) act(() => deleteBook(book.id), `Couldn't remove “${book.title}”`)
  }

  return (
    <main className="page library">
      <div className="library-head">
        <h1>Library</h1>
        <div className="actions">
          <button type="button" onClick={rescan} title="Look for PDFs added to the library folder">
            Rescan folder
          </button>
          <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
            Add PDFs
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <p className="hint">
        Drop PDFs anywhere on this page{libraryDir && <>, or copy them into <code>{libraryDir}</code></>}.
      </p>

      {messages.length > 0 && (
        <ul className="messages">
          {messages.map((m) => (
            <li key={m.id} className={m.kind}>
              <span>{m.text}</span>
              <button type="button" className="link" onClick={() => dismiss(m.id)} aria-label="Dismiss">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {uploading > 0 && (
        <p className="uploading">
          Adding {uploading} file{uploading > 1 ? 's' : ''}…
        </p>
      )}

      {books === null ? null : books.length === 0 && uploading === 0 ? (
        <div className="empty">
          <p>Your library is empty.</p>
          <p>Add a PDF to get started. Try the messiest one you own first.</p>
        </div>
      ) : (
        <ul className="books">
          {books.map((book) => (
            <BookRow
              key={book.id}
              book={book}
              onReprocess={() => act(() => reprocessBook(book.id), "Couldn't reprocess")}
              onRemove={() => remove(book)}
              onSaved={refresh}
              onError={(text) => say('error', text)}
            />
          ))}
        </ul>
      )}

      {dragging && <div className="drop-overlay">Drop PDFs to add them</div>}
    </main>
  )
}

/** Whole-window file drag and drop. Returns whether files are being dragged over. */
function useFileDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      onFiles(Array.from(e.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [onFiles])

  return dragging
}
