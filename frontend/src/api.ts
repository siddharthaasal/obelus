export type Health = {
  status: 'ok' | 'degraded'
  db: 'ok' | 'error'
  pgvector: string | null
}

export type BookStatus = 'queued' | 'extracting' | 'embedding' | 'ready' | 'failed'

export type Book = {
  id: number
  title: string
  author: string | null
  file_name: string
  file_size: number
  page_count: number | null
  status: BookStatus
  error: string | null
  needs_ocr_pages: number
  last_read_page: number | null
  created_at: string
  updated_at: string
  ingested_at: string | null
}

export type RemovedLine = { text: string; reason: 'header' | 'footer' | 'page_number' }

export type Page = {
  page_number: number
  label: string | null
  raw_text: string
  clean_text: string
  footnotes: string
  removed_lines: RemovedLine[]
  needs_ocr: boolean
  is_ocr: boolean
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    // FastAPI sends a string, or a list of validation errors.
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) return body.detail.map((d: { msg: string }) => d.msg).join('; ')
  } catch {
    // not JSON
  }
  return `${res.status} ${res.statusText}`
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health')
  // A 503 still carries a Health body describing what's down.
  if (!res.ok && res.status !== 503) throw new ApiError(res.status, res.statusText)
  return (await res.json()) as Health
}

export const listBooks = () => request<Book[]>('/books')
export const getBook = (id: number) => request<Book>(`/books/${id}`)
export const updateBook = (id: number, changes: { title?: string; author?: string | null }) =>
  request<Book>(`/books/${id}`, json('PATCH', changes))
export const deleteBook = (id: number) => request<void>(`/books/${id}`, { method: 'DELETE' })
export const reprocessBook = (id: number) =>
  request<Book>(`/books/${id}/reprocess`, { method: 'POST' })

export function uploadBook(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<{ book: Book; duplicate: boolean }>('/books', { method: 'POST', body: form })
}

export const bookFileUrl = (id: number) => `/api/books/${id}/file`

/** Save the reading position. `keepalive` lets the request finish while the page unloads. */
export const savePosition = (id: number, page: number, { keepalive = false } = {}) =>
  request<void>(`/books/${id}/position`, { ...json('PUT', { page }), keepalive })

export const getPage = (bookId: number, n: number) => request<Page>(`/books/${bookId}/pages/${n}`)
export const pageImageUrl = (bookId: number, n: number, dpi = 110) =>
  `/api/books/${bookId}/pages/${n}/image?dpi=${dpi}`

export const getLibraryInfo = () => request<{ library_dir: string }>('/library')
export const scanLibrary = () =>
  request<{ added: number; duplicates: number }>('/library/scan', { method: 'POST' })

export const isBusy = (b: Book) => b.status === 'queued' || b.status === 'extracting'

// AI: selection actions (lookups). Answer shapes mirror backend/app/ai/schemas.py.

export type AiStatus = { configured: boolean; model_fast: string; model_deep: string; problem: string | null }

export type LookupKind = 'define' | 'who' | 'explain'
export type PageNote = { page: number; note: string }

export type DefineAnswer = {
  term: string
  in_context: string
  general: string | null
  across_book: string | null
  key_pages: PageNote[]
}
export type WhoAnswer = {
  name: string
  relation_label: string
  bio: string
  relation: string
  here: string
  key_pages: PageNote[]
}
export type ExplainAnswer = {
  restatement: string
  key_terms: { term: string; meaning: string }[]
  in_argument: string
  related_pages: PageNote[]
}

type LookupBase = {
  id: number
  book_id: number
  page_number: number
  query_text: string
  context_text: string
  char_start: number | null
  char_end: number | null
  model: string
  /** How the book reached the model: cached whole, sent whole, or excerpts of a long book. */
  context_mode: 'cached' | 'inline' | 'excerpt'
  created_at: string
}
export type Lookup =
  | (LookupBase & { kind: 'define'; response: DefineAnswer })
  | (LookupBase & { kind: 'who'; response: WhoAnswer })
  | (LookupBase & { kind: 'explain'; response: ExplainAnswer })

export type LookupRequest = {
  kind: LookupKind
  page: number
  /** The selection as the text layer has it; the backend anchors it in the extracted text. */
  text: string
  before?: string
  after?: string
  /** Ask again instead of returning a saved answer. */
  refresh?: boolean
}

export const getAiStatus = () => request<AiStatus>('/ai')
/** Create or reuse the book's Gemini cache for lookups or chat, so the first request doesn't wait. */
export const prepareBookContext = (bookId: number, purpose: 'lookups' | 'chat' = 'lookups') =>
  request<{ mode: string }>(`/books/${bookId}/context?purpose=${purpose}`, { method: 'POST' })
export const listLookups = (bookId: number) => request<Lookup[]>(`/books/${bookId}/lookups`)
export const createLookup = (bookId: number, body: LookupRequest) =>
  request<Lookup>(`/books/${bookId}/lookups`, json('POST', body))
export const deleteLookup = (bookId: number, id: number) =>
  request<void>(`/books/${bookId}/lookups/${id}`, { method: 'DELETE' })

// AI: book chat. Shapes mirror backend/app/api/chat.py; events, backend/app/ai/replies.py.

export type ConversationSummary = {
  id: number
  book_id: number
  title: string
  message_count: number
  /** An answer is being written right now; follow it with followReply. */
  answering: boolean
  created_at: string
  updated_at: string
}

export type ChatMessage = {
  id: number
  conversation_id: number
  role: 'user' | 'assistant'
  content: string
  /** Questions: the page the reader was on, and its section in the table of contents. */
  page_number: number | null
  section: string | null
  citations: { book_id: number; page: number; end?: number }[]
  /** stopped: the reader stopped it partway. truncated: the model ended early. */
  status: 'complete' | 'stopped' | 'truncated'
  model: string | null
  context_mode: 'cached' | 'inline' | 'excerpt' | null
  created_at: string
}

export type Conversation = ConversationSummary & { messages: ChatMessage[] }

export type Question = { content: string; page: number; section?: string | null }

/** What a chat stream sends: the saved question (when one was asked), the answer in pieces, then its end. */
export type ChatEvent =
  | { event: 'user'; conversation: ConversationSummary; message: ChatMessage }
  | { event: 'delta'; text: string }
  | { event: 'done'; message: ChatMessage | null }
  | { event: 'error'; detail: string; status: number }

const chatPath = (bookId: number, id?: number) => `/books/${bookId}/conversations${id === undefined ? '' : `/${id}`}`

export const listConversations = (bookId: number) => request<ConversationSummary[]>(chatPath(bookId))
export const getConversation = (bookId: number, id: number) => request<Conversation>(chatPath(bookId, id))
export const deleteConversation = (bookId: number, id: number) =>
  request<void>(chatPath(bookId, id), { method: 'DELETE' })
export const stopReply = (bookId: number, id: number) =>
  request<void>(`${chatPath(bookId, id)}/stop`, { method: 'POST' })

/** Ask a question: in a new chat without `id`. */
export const askQuestion = (bookId: number, id: number | null, question: Question, signal?: AbortSignal) =>
  events(id === null ? chatPath(bookId) : `${chatPath(bookId, id)}/messages`, { ...json('POST', question), signal })
/** Answer the chat's last question again. */
export const answerAgain = (bookId: number, id: number, signal?: AbortSignal) =>
  events(`${chatPath(bookId, id)}/reply`, { method: 'POST', signal })
/** Follow the answer being written, from its start. */
export const followReply = (bookId: number, id: number, signal?: AbortSignal) =>
  events(`${chatPath(bookId, id)}/reply`, { signal })

/**
 * A server-sent event stream. These are POSTs, which EventSource can't make, so this reads the
 * stream itself. An error before the stream starts throws ApiError, like any request.
 */
async function* events(path: string, init: RequestInit): AsyncGenerator<ChatEvent> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok || !res.body) throw new ApiError(res.status, await errorMessage(res))
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += value.replace(/\r\n/g, '\n')
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = parseEvent(block)
        if (event) yield event
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

function parseEvent(block: string): ChatEvent | null {
  let name = ''
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue // a keepalive comment
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }
  if (!name || data.length === 0) return null
  return { event: name, ...JSON.parse(data.join('\n')) } as ChatEvent
}
