import { lazy, Suspense } from 'react'

// pdf.js is large; load the reader only when a book is opened.
const ReaderPage = lazy(() => import('./ReaderPage'))

export default function LazyReader() {
  return (
    <Suspense fallback={null}>
      <ReaderPage />
    </Suspense>
  )
}
