import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Minus,
  MoveHorizontal,
  PanelRight,
  Plus,
  ScanText,
  TableOfContents,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  type AiStatus,
  ApiError,
  type Book,
  bookFileUrl,
  getAiStatus,
  getBook,
  type LookupKind,
  prepareBookContext,
  savePosition,
} from '../api'
import ChatPanel from '../panels/ChatPanel'
import LookupsPanel from '../panels/LookupsPanel'
import { useChat } from '../panels/useChat'
import { useLookups } from '../panels/useLookups'
import { readFlag, readPref, writeFlag, writePref } from '../prefs'
import {
  Button,
  ButtonLink,
  EmptyState,
  Logo,
  PageInput,
  StatusIcon,
  ThemeSwitcher,
} from '../ui'
import Contents from './Contents'
import { currentItem, flatten } from './outline'
import { type DocumentInfo, PdfReader, type ScaleValue } from './pdf'
import { actionsFor, displayQuery, type ReaderSelection, trackSelection } from './selection'
import SelectionPopover from './SelectionPopover'
import SidePanel, { type Tab } from './SidePanel'
import './reader.css'

const SAVE_DELAY_MS = 1000
const CONTENTS_PREF = 'obelus.reader.contents'
const PANEL_PREF = 'obelus.reader.panel'
const TAB_PREF = 'obelus.reader.tab'
const scalePref = (bookId: number) => `obelus.reader.scale.${bookId}`
const LOOKUP_KEYS: Record<string, LookupKind> = { d: 'define', w: 'who', e: 'explain' }

export default function ReaderPage() {
  const bookId = Number(useParams().bookId)
  const [searchParams, setSearchParams] = useSearchParams()
  // A link can ask for a page (?page=12). Read it once; it's dropped from the URL below so a
  // reload resumes from the saved position instead.
  const [requestedPage] = useState(() => Number(searchParams.get('page')) || null)
  const [book, setBook] = useState<Book | null>(null)
  const [error, setError] = useState<{ kind: 'missing' | 'book' | 'pdf'; message: string } | null>(null)
  const [info, setInfo] = useState<DocumentInfo | null>(null)
  // null until pdf.js has scrolled to the starting page.
  const [page, setPage] = useState<number | null>(null)
  const [scale, setScale] = useState<{ percent: number; value: ScaleValue }>({ percent: 100, value: 'auto' })
  const [contentsOpen, setContentsOpen] = useState(() => readFlag(CONTENTS_PREF, false))
  const [panelOpen, setPanelOpen] = useState(() => readFlag(PANEL_PREF, window.innerWidth >= 1200))
  const [tab, setTab] = useState<Tab>(savedTab)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [selection, setSelection] = useState<ReaderSelection | null>(null)
  const outline = useMemo(() => flatten(info?.outline ?? []), [info])
  const lookups = useLookups(bookId)
  const { run: requestLookup } = lookups
  const chat = useChat(bookId)
  const { showThread: showChat } = chat
  // Bumped to put the cursor in the chat's message box.
  const [chatFocus, setChatFocus] = useState(0)

  const host = useRef<HTMLDivElement>(null)
  const reader = useRef<PdfReader | null>(null)
  const pageInput = useRef<HTMLInputElement>(null)
  // The page on screen (0 until known) and the last one saved, for the save on leave.
  const position = useRef({ page: 0, saved: 0 })
  // The selection, for keyboard shortcuts.
  const selected = useRef<ReaderSelection | null>(null)

  useEffect(() => {
    getBook(bookId)
      .then(setBook)
      .catch((e: Error) =>
        setError(
          e instanceof ApiError && e.status === 404
            ? { kind: 'missing', message: 'This book isn’t in your library.' }
            : { kind: 'book', message: e.message },
        ),
      )
  }, [bookId])

  useEffect(() => {
    if (searchParams.has('page')) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    getAiStatus()
      .then(setAi)
      .catch(() => {})
  }, [])

  // Get the book into Gemini's cache while the reader settles in, so the first lookup is quick.
  useEffect(() => {
    if (book?.status === 'ready' && ai?.configured) prepareBookContext(book.id).catch(() => {})
  }, [book, ai])

  // The same for chat's model, once the chat is opened.
  const chatShown = panelOpen && tab === 'chat'
  const chatWarmed = useRef<number | null>(null)
  useEffect(() => {
    if (!chatShown || book?.status !== 'ready' || !ai?.configured || chatWarmed.current === book.id) return
    chatWarmed.current = book.id
    if (ai.model_deep !== ai.model_fast) prepareBookContext(book.id, 'chat').catch(() => {})
  }, [chatShown, book, ai])

  // Open the PDF once the book is known: at the requested page, else where you left off.
  useEffect(() => {
    if (!book || !host.current) return
    const start = requestedPage && requestedPage >= 1 ? requestedPage : (book.last_read_page ?? 1)
    position.current = { page: 0, saved: book.last_read_page ?? 0 }

    const r = new PdfReader(host.current, {
      onReady: setInfo,
      onPage: (n) => {
        position.current.page = n
        setPage(n)
      },
      onScale: (s, value) => {
        setScale({ percent: Math.round(s * 100), value })
        writePref(scalePref(book.id), String(value))
      },
      onError: (e) => setError({ kind: 'pdf', message: e.message }),
    })
    reader.current = r
    r.open(bookFileUrl(book.id), { page: start, scale: parseScale(readPref(scalePref(book.id))) })
    r.container.focus({ preventScroll: true })
    const stopTracking = trackSelection(r.container, (s) => {
      selected.current = s
      setSelection(s)
    })
    return () => {
      stopTracking()
      r.destroy()
      reader.current = null
    }
  }, [book, requestedPage])

  // Save the position a moment after the page settles, and whatever's pending on leaving.
  useEffect(() => {
    if (!book || page === null || page === position.current.saved) return
    const timer = setTimeout(() => {
      savePosition(book.id, page)
        .then(() => {
          position.current.saved = page
        })
        .catch(() => {})
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [book, page])

  useEffect(() => {
    const flush = () => {
      const { page: current, saved } = position.current
      if (current >= 1 && current !== saved) {
        position.current.saved = current
        savePosition(bookId, current, { keepalive: true }).catch(() => {})
      }
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [bookId])

  const toggleContents = useCallback(
    () =>
      setContentsOpen((v) => {
        writeFlag(CONTENTS_PREF, !v)
        return !v
      }),
    [],
  )
  const togglePanel = useCallback(
    () =>
      setPanelOpen((v) => {
        writeFlag(PANEL_PREF, !v)
        return !v
      }),
    [],
  )
  const changeTab = useCallback((next: Tab) => {
    setTab(next)
    writePref(TAB_PREF, next)
  }, [])

  const clearSelection = useCallback(() => {
    document.getSelection()?.removeAllRanges()
    selected.current = null
    setSelection(null)
  }, [])

  /** Look up the selection, and show the answer in the panel. */
  const lookUp = useCallback(
    (kind: LookupKind) => {
      const s = selected.current
      if (!s || !actionsFor(s).includes(kind)) return
      requestLookup({ kind, page: s.page, text: s.raw, before: s.before, after: s.after }, displayQuery(kind, s))
      changeTab('lookups')
      setPanelOpen(true)
      writeFlag(PANEL_PREF, true)
      clearSelection()
    },
    [requestLookup, changeTab, clearSelection],
  )

  /** Open the chat with the cursor in its message box. */
  const startTyping = useCallback(() => {
    changeTab('chat')
    setPanelOpen(true)
    writeFlag(PANEL_PREF, true)
    showChat()
    setChatFocus((n) => n + 1)
  }, [changeTab, showChat])

  // Citations jump to their page and mark it, so the eye can find where it landed.
  const goToCited = useCallback((n: number) => {
    reader.current?.goToPage(n)
    reader.current?.flashPage(n)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const r = reader.current
      if (!r || isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const zoomIn = e.key === '=' || e.key === '+'
      if (mod && (zoomIn || e.key === '-' || e.key === '0')) {
        // Zoom the book, not the whole app.
        e.preventDefault()
        if (zoomIn) r.zoom(1)
        else if (e.key === '-') r.zoom(-1)
        else r.setScale('auto')
        return
      }
      if (mod || e.altKey) return
      if (e.key === 'Escape' && selected.current) {
        clearSelection()
        return
      }
      const lookupKind = LOOKUP_KEYS[e.key.toLowerCase()]
      if (lookupKind && selected.current) {
        e.preventDefault()
        lookUp(lookupKind)
        return
      }
      const actions: Record<string, () => void> = {
        j: () => r.nextPage(),
        k: () => r.previousPage(),
        '[': toggleContents,
        ']': togglePanel,
        c: startTyping,
        g: () => pageInput.current?.focus(),
        '=': () => r.zoom(1),
        '+': () => r.zoom(1),
        '-': () => r.zoom(-1),
        '0': () => r.setScale('auto'),
      }
      const action = actions[e.key]
      if (action) {
        e.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleContents, togglePanel, clearSelection, lookUp, startTyping])

  if (error && error.kind !== 'pdf') {
    return (
      <div className="reader reader-message">
        <EmptyState
          icon={FileWarning}
          title={error.kind === 'missing' ? 'Book not found' : 'Couldn’t load this book'}
          actions={<ButtonLink to="/">Back to library</ButtonLink>}
        >
          <p>{error.message}</p>
        </EmptyState>
      </div>
    )
  }

  const pageCount = info?.pageCount ?? book?.page_count ?? 1
  const shown = page ?? 1
  const label = info?.labels?.[shown - 1]
  const section = currentItem(outline, shown)?.title.trim() || null

  return (
    <div className="reader">
      <header className="reader-bar">
        <div className="reader-bar-start">
          <Link to="/" className="reader-home" aria-label="Library" title="Library">
            <Logo wordmark={false} />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            icon={TableOfContents}
            aria-label="Contents"
            title="Contents ([)"
            aria-pressed={contentsOpen}
            onClick={toggleContents}
          />
          {book && (
            <div className="reader-title" title={[book.title, book.author].filter(Boolean).join(' · ')}>
              <span className="reader-title-text">{book.title}</span>
              {book.author && <span className="reader-title-author">{book.author}</span>}
            </div>
          )}
        </div>

        <nav className="reader-pager" aria-label="Pages">
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronLeft}
            aria-label="Previous page"
            title="Previous page (K)"
            disabled={!info || shown <= 1}
            onClick={() => reader.current?.previousPage()}
          />
          <PageInput ref={pageInput} value={shown} max={pageCount} onGo={(n) => reader.current?.goToPage(n)} />
          <span className="reader-of tabular">of {pageCount}</span>
          {label && label !== String(shown) && (
            <span className="reader-label text-mono" title="Printed page number">
              p.&nbsp;{label}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronRight}
            aria-label="Next page"
            title="Next page (J)"
            disabled={!info || shown >= pageCount}
            onClick={() => reader.current?.nextPage()}
          />
        </nav>

        <div className="reader-bar-end">
          <div className="reader-zoom">
            <Button
              variant="ghost"
              size="sm"
              icon={Minus}
              aria-label="Zoom out"
              title="Zoom out (−)"
              disabled={!info}
              onClick={() => reader.current?.zoom(-1)}
            />
            <button
              type="button"
              className="reader-zoom-value tabular"
              title="Reset zoom (0)"
              disabled={!info}
              onClick={() => reader.current?.setScale('auto')}
            >
              {scale.percent}%
            </button>
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              aria-label="Zoom in"
              title="Zoom in (+)"
              disabled={!info}
              onClick={() => reader.current?.zoom(1)}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={MoveHorizontal}
            aria-label="Fit to width"
            title="Fit to width"
            aria-pressed={scale.value === 'page-width'}
            disabled={!info}
            onClick={() => reader.current?.setScale('page-width')}
          />
          <ButtonLink
            to={`/books/${bookId}/debug/${shown}`}
            variant="ghost"
            size="sm"
            icon={ScanText}
            aria-label="Inspect this page’s text"
            title="Inspect this page’s text"
          />
          <span className="reader-theme">
            <ThemeSwitcher />
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={PanelRight}
            aria-label="Side panel"
            title="Side panel (])"
            aria-pressed={panelOpen}
            onClick={togglePanel}
          />
        </div>
      </header>

      <div className="reader-body">
        {contentsOpen && (
          <Contents
            outline={info?.outline ?? null}
            labels={info?.labels ?? null}
            page={shown}
            onSelect={(item) => item.dest && reader.current?.goToDestination(item.dest)}
            onClose={toggleContents}
          />
        )}
        <main className="reader-stage">
          <div ref={host} className="reader-host" />
          {selection && <SelectionPopover selection={selection} onAction={lookUp} />}
          {error?.kind === 'pdf' ? (
            <div className="reader-overlay">
              <EmptyState
                icon={FileWarning}
                title="Couldn’t open this PDF"
                actions={<ButtonLink to="/">Back to library</ButtonLink>}
              >
                <p>{error.message}</p>
              </EmptyState>
            </div>
          ) : (
            !info && (
              <div className="reader-overlay reader-loading" role="status">
                <StatusIcon state="progress" progress={0.3} />
                Opening book…
              </div>
            )
          )}
        </main>
        {panelOpen && (
          <SidePanel
            tab={tab}
            onTabChange={changeTab}
            onClose={togglePanel}
            lookups={
              <LookupsPanel
                lookups={lookups}
                ai={ai}
                labels={info?.labels ?? null}
                pageCount={pageCount}
                onGo={goToCited}
              />
            }
            chat={
              <ChatPanel
                chat={chat}
                ai={ai}
                page={shown}
                section={section}
                labels={info?.labels ?? null}
                pageCount={pageCount}
                onGo={goToCited}
                focusKey={chatFocus}
              />
            }
          />
        )}
      </div>
    </div>
  )
}

function savedTab(): Tab {
  const saved = readPref(TAB_PREF)
  return saved === 'chat' || saved === 'highlights' ? saved : 'lookups'
}

function parseScale(saved: string | null): ScaleValue {
  if (saved === 'auto' || saved === 'page-width' || saved === 'page-fit') return saved
  const n = Number(saved)
  return saved && Number.isFinite(n) && n > 0 ? n : 'auto'
}

/** Key presses belong to the field being typed in, not to reader shortcuts. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true
  }
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type)
}
