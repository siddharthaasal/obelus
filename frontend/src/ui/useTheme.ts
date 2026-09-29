import { useCallback, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

// index.html reads the same key to apply the theme before first paint.
const STORAGE_KEY = 'obelus.theme'

function readTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(theme: ThemePreference) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // storage unavailable; the choice lasts until reload
  }
}

/** The saved theme preference. 'system' follows the OS; tokens.css does the rest. */
export function useTheme() {
  const [theme, setTheme] = useState(readTheme)
  const choose = useCallback((next: ThemePreference) => {
    applyTheme(next)
    setTheme(next)
  }, [])
  return [theme, choose] as const
}
