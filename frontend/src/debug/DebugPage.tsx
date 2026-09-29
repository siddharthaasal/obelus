import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
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
import { Badge, Button, Card, cx, Input, Kbd, Note, PageHeader, Switch } from '../ui'
import './debug.css'

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
    return <main className="page">{error && <Note tone="error">{error}</Note>}</main>
  }

  const paragraphs = page?.clean_text ? page.clean_text.split('\n\n') : []
  const notes = page?.footnotes ? page.footnotes.split('\n\n') : []

  return (
    <main className="page page-wide debug">
      <PageHeader
        eyebrow={
          <>
            <Link to="/">Library</Link>
            <ChevronRight size={12} aria-hidden />
            <span>Inspect text</span>
          </>
        }
        title={book.title}
        actions={
          <>
            <Switch label="Page image" checked={showImage} onChange={toggleImage} />
            <Button icon={RotateCw} onClick={reprocess} disabled={busy}>
              {busy ? 'Reprocessing…' : 'Reprocess book'}
            </Button>
          </>
        }
      />

      <div className="debug-toolbar">
        <nav className="pager" aria-label="Pages">
          <Button
            size="sm"
            icon={ChevronLeft}
            onClick={() => go(n - 1)}
            disabled={n <= 1}
            aria-label="Previous page"
            title="Previous page (← or K)"
          />
          <PageInput key={n} value={n} max={total} onGo={go} />
          <span className="pager-of tabular">of {total}</span>
          <Button
            size="sm"
            icon={ChevronRight}
            onClick={() => go(n + 1)}
            disabled={n >= total}
            aria-label="Next page"
            title="Next page (→ or J)"
          />
          <span className="pager-keys" aria-hidden="true">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </span>
        </nav>
        {page && (
          <p className="debug-stats tabular">
            {page.label && page.label !== String(n) && <span>Printed page {page.label}</span>}
            <span>
              {page.raw_text.length.toLocaleString()} raw → {page.clean_text.length.toLocaleString()}{' '}
              clean chars
            </span>
            <span>
              {paragraphs.length} paragraph{paragraphs.length === 1 ? '' : 's'}
            </span>
            <span>
              {notes.length} footnote block{notes.length === 1 ? '' : 's'}
            </span>
            <span>{page.removed_lines.length} removed</span>
            {page.needs_ocr && <Badge tone="teal">Needs OCR</Badge>}
          </p>
        )}
      </div>
      {error && <Note tone="error">{error}</Note>}

      <div className={cx('debug-cols', showImage && 'with-image')}>
        {showImage && (
          <Column title="Page">
            <img
              key={`${bookId}-${n}`}
              className="page-image"
              src={pageImageUrl(bookId, n)}
              alt={`Page ${n}`}
            />
          </Column>
        )}
        <Column title="Raw text">
          <pre className="raw">{page?.raw_text}</pre>
        </Column>
        <Column title="Clean text">
          <div className="clean prose">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {notes.length > 0 && (
            <>
              <h3 className="debug-subhead">Footnotes</h3>
              <div className="clean notes">
                {notes.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </>
          )}
          {page && page.removed_lines.length > 0 && (
            <>
              <h3 className="debug-subhead">Removed</h3>
              <ul className="removed">
                {page.removed_lines.map((r, i) => (
                  <li key={i}>
                    <Badge>{REASON_LABEL[r.reason] ?? r.reason}</Badge>
                    <span className="removed-text text-mono">{r.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Column>
      </div>
    </main>
  )
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" padded={false} className="debug-col">
      <h2 className="debug-col-title">{title}</h2>
      <div className="debug-col-body">{children}</div>
    </Card>
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
    <Input
      compact
      mono
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
