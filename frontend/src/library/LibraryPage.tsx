import { BookOpen, FolderSync, LayoutGrid, LibraryBig, List, Plus, Upload } from 'lucide-react'
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
import { readPref, writePref } from '../prefs'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  type SegmentOption,
  SegmentedControl,
  StatusIcon,
  Toasts,
  useToasts,
} from '../ui'
import type { BookHandlers } from './BookActions'
import BookGrid from './BookGrid'
import BookRow from './BookRow'
import Shelf from './shelf/Shelf'
import './library.css'

const POLL_BUSY_MS = 1500
// The backend scans the library folder every 10s; this picks up what it finds.
const POLL_IDLE_MS = 5000
// Long enough for a new book to finish sliding onto the shelf.
const ARRIVING_MS = 1400

type View = 'list' | 'grid' | 'shelf'
const VIEWS: SegmentOption<View>[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'shelf', label: 'Shelf', icon: LibraryBig },
]
const VIEW_PREF = 'obelus.libraryView'
const savedView = (): View => {
  const v = readPref(VIEW_PREF)
  return v === 'grid' || v === 'shelf' ? v : 'list'
}

export default function LibraryPage() {
  const [books, setBooks] = useState<Book[] | null>(null)
  const [libraryDir, setLibraryDir] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [view, setView] = useState(savedView)
  const arriving = useArrivals(books)
  const { toasts, show: say, dismiss } = useToasts()
  const fileInput = useRef<HTMLInputElement>(null)

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

  const handlers = (book: Book): BookHandlers => ({
    onReprocess: () => act(() => reprocessBook(book.id), "Couldn't reprocess"),
    onRemove: () => act(() => deleteBook(book.id), `Couldn't remove “${book.title}”`),
    onSaved: refresh,
  })

  function chooseView(v: View) {
    setView(v)
    writePref(VIEW_PREF, v)
  }

  return (
    <main className="page library">
      <PageHeader
        title="Library"
        accessory={
          books && books.length > 0 && (
            <Badge className="tabular">
              {books.length} {books.length === 1 ? 'book' : 'books'}
            </Badge>
          )
        }
        description={
          <>
            Drop PDFs anywhere on this page
            {libraryDir && (
              <>
                , or copy them into <code>{libraryDir}</code>
              </>
            )}
            .
          </>
        }
        actions={
          <>
            <SegmentedControl label="View" options={VIEWS} value={view} onChange={chooseView} iconOnly />
            <Button icon={FolderSync} onClick={rescan} title="Look for PDFs added to the library folder">
              Rescan folder
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => fileInput.current?.click()}>
              Add PDFs
            </Button>
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
          </>
        }
      />

      {books === null ? null : books.length === 0 && uploading === 0 ? (
        <Card padded={false} className="library-list">
          <EmptyState icon={BookOpen} title="Your library is empty">
            <p>Add a PDF to get started. Try the messiest one you own first.</p>
          </EmptyState>
        </Card>
      ) : view === 'shelf' ? (
        <Shelf books={books} uploading={uploading} arriving={arriving} handlers={handlers} />
      ) : view === 'grid' ? (
        <BookGrid books={books} uploading={uploading} handlers={handlers} />
      ) : (
        <Card as="ul" padded={false} className="library-list">
          {uploading > 0 && (
            <li className="book-row book-row-pending">
              <StatusIcon state="progress" progress={0.25} />
              <span>
                Adding {uploading} file{uploading > 1 ? 's' : ''}…
              </span>
            </li>
          )}
          {books.map((book) => (
            <BookRow key={book.id} book={book} {...handlers(book)} />
          ))}
        </Card>
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-target">
            <Upload size={20} aria-hidden />
            Drop PDFs to add them
          </div>
        </div>
      )}
    </main>
  )
}

/** The newest book to appear since the page loaded, for a moment after it does. */
function useArrivals(books: Book[] | null) {
  const known = useRef<Set<number> | null>(null)
  const timer = useRef<number>(undefined)
  const [arriving, setArriving] = useState<number | null>(null)

  useEffect(() => {
    if (!books) return
    const seen = known.current
    known.current = new Set(books.map((b) => b.id))
    // The first load is the library as it was, not new arrivals.
    const fresh = seen && books.find((b) => !seen.has(b.id))
    if (!fresh) return
    setArriving(fresh.id)
    // Not cleared when the list refreshes: that happens every couple of seconds while books
    // are being processed.
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setArriving(null), ARRIVING_MS)
  }, [books])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return arriving
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
