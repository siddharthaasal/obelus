import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './ui/styles.css'
import App from './App.tsx'
import DebugPage from './debug/DebugPage.tsx'
import DesignPage from './design/DesignPage.tsx'
import LibraryPage from './library/LibraryPage.tsx'
import LazyReader from './reader/LazyReader.tsx'
import { IconDefaults } from './ui'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconDefaults>
      <BrowserRouter>
        <Routes>
          <Route path="books/:bookId" element={<LazyReader />} />
          <Route element={<App />}>
            <Route index element={<LibraryPage />} />
            <Route path="books/:bookId/debug/:page?" element={<DebugPage />} />
            <Route path="design" element={<DesignPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </IconDefaults>
  </StrictMode>,
)
