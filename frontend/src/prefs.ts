// Per-browser UI preferences in localStorage. Storage can be unavailable (private windows,
// blocked site data), so reads fall back and writes fail quietly.

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // the preference just won't persist
  }
}

export const readFlag = (key: string, fallback: boolean) => {
  const v = readPref(key)
  return v === null ? fallback : v === '1'
}

export const writeFlag = (key: string, value: boolean) => writePref(key, value ? '1' : '0')
