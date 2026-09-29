import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ApiError,
  type Book,
  getBook,
  getPage,
  isBusy,
  type Page,
  pageImageUrl,
  reprocessBook,
} from '../api'

const REASON_LABEL: Record<string, string> = {
  header: 'running header',
  footer: 'running footer',
  page_number: 'page number',
}
const IMAGE_PREF = 'obelus.debug.showImage'

/** Raw and cleaned text side by side, for tuning cleanup rules against real PDFs. */
export default function DebugPage() {
  const params = useParams()
  const bookId = Number(params.bookId)
  const n = Math.max(1, Number(params.page) || 1)
  const navigate = useNavigate()

  const [book, setBook] = useState<Book | null>(null)
  const [page, setPage] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showImage, setShowImage] = useState(() => readPref(IMAGE_PREF, true))

  const loadBook = useCallback(
    () =>
      getBook(bookId)
        .then(setBook)
        .catch((e: Error) => setError(e.message)),
    [bookId],
  )

  useEffect(() => {
    loadBook()
  }, [loadBook])

  // While a reprocess runs, poll until the book is ready, then reload the page.
  const busy = book ? isBusy(book) : false
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(loadBook, 1500)
    return () => clearInterval(timer)
  }, [busy, loadBook])

  useEffect(() => {
    if (!book || isBusy(book)) return
    let stale = false
    getPage(bookId, n)
      .then((p) => {
        if (stale) return
        setPage(p)
        setError(null)
      })
      .catch((e: Error) => {
        if (stale) return
        setPage(null)
        setError(e instanceof ApiError && e.status === 404 ? 'This page has no extracted text.' : e.message)
      })
    return () => {
      stale = true
    }
  }, [book, bookId, n])

  const total = book?.page_count ?? 1
  const go = useCallback(
    (target: number) => {
      const clamped = Math.min(Math.max(1, target), total)
      if (clamped !== n) navigate(`/books/${bookId}/debug/${clamped}`, { replace: true })
    },
    [bookId, n, navigate, total],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft' || e.key === 'k') go(n - 1)
      if (e.key === 'ArrowRight' || e.key === 'j') go(n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, n])

  function toggleImage() {
    setShowImage((v) => {
      writePref(IMAGE_PREF, !v)
      return !v
    })
  }

  async function reprocess() {
    if (!book) return
    try {
      setBook(await reprocessBook(book.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!book) {
    return <main className="page">{error ? <p className="book-error">{error}</p> : null}</main>
  }

  const paragraphs = page?.clean_text ? page.clean_text.split('\n\n') : []
  const notes = page?.footnotes ? page.footnotes.split('\n\n') : []

  return (
    <main className="page debug">
      <div className="debug-head">
        <div>
          <Link to="/" className="back">
            ← Library
          </Link>
          <h1>{book.title}</h1>
        </div>
        <nav className="pager" aria-label="Pages">
          <button type="button" onClick={() => go(n - 1)} disabled={n <= 1} aria-label="Previous page">
            ‹
          </button>
          <PageInput key={n} value={n} max={total} onGo={go} />
          <span className="of">of {total}</span>
          <button type="button" onClick={() => go(n + 1)} disabled={n >= total} aria-label="Next page">
            ›
          </button>
        </nav>
        <div className="actions">
          <label className="toggle">
            <input type="checkbox" checked={showImage} onChange={toggleImage} /> Page image
          </label>
          <button type="button" onClick={reprocess} disabled={busy}>
            {busy ? 'Reprocessing…' : 'Reprocess book'}
          </button>
        </div>
      </div>

      {page && (
        <p className="debug-stats">
          {page.label && page.label !== String(n) && <>Printed page {page.label} · </>}
          {page.raw_text.length.toLocaleString()} raw → {page.clean_text.length.toLocaleString()} clean
          chars · {paragraphs.length} paragraph{paragraphs.length === 1 ? '' : 's'} ·{' '}
          {notes.length} footnote block{notes.length === 1 ? '' : 's'} · {page.removed_lines.length} removed
          {page.needs_ocr && <span className="flag">needs OCR</span>}
        </p>
      )}
      {error && <p className="book-error">{error}</p>}

      <div className={`debug-cols ${showImage ? 'with-image' : ''}`}>
        {showImage && (
          <section className="col">
            <h3>Page</h3>
            <img
              key={`${bookId}-${n}`}
              className="page-image"
              src={pageImageUrl(bookId, n)}
              alt={`Page ${n}`}
            />
          </section>
        )}
        <section className="col">
          <h3>Raw text</h3>
          <pre className="raw">{page?.raw_text}</pre>
        </section>
        <section className="col">
          <h3>Clean text</h3>
          <div className="clean">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {notes.length > 0 && (
            <>
              <h3>Footnotes</h3>
              <div className="clean notes">
                {notes.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </>
          )}
          {page && page.removed_lines.length > 0 && (
            <>
              <h3>Removed</h3>
              <ul className="removed">
                {page.removed_lines.map((r, i) => (
                  <li key={i}>
                    <span className="reason">{REASON_LABEL[r.reason] ?? r.reason}</span>
                    <span className="text">{r.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function PageInput({ value, max, onGo }: { value: number; max: number; onGo: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const commit = () => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed) && parsed >= 1) onGo(Math.round(parsed))
    else setDraft(String(value))
  }
  return (
    <input
      className="page-input"
      inputMode="numeric"
      aria-label="Page number"
      value={draft}
      size={String(max).length + 1}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // storage unavailable; the toggle just won't persist
  }
}
