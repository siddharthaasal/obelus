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

export const getPage = (bookId: number, n: number) => request<Page>(`/books/${bookId}/pages/${n}`)
export const pageImageUrl = (bookId: number, n: number, dpi = 110) =>
  `/api/books/${bookId}/pages/${n}/image?dpi=${dpi}`

export const getLibraryInfo = () => request<{ library_dir: string }>('/library')
export const scanLibrary = () =>
  request<{ added: number; duplicates: number }>('/library/scan', { method: 'POST' })

export const isBusy = (b: Book) => b.status === 'queued' || b.status === 'extracting'
