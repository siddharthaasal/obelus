import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import App from './App.tsx'
import DebugPage from './debug/DebugPage.tsx'
import LibraryPage from './library/LibraryPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<LibraryPage />} />
          <Route path="books/:bookId/debug/:page?" element={<DebugPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
