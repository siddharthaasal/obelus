import type { ReactNode } from 'react'
import './Kbd.css'

/** A key in a keyboard shortcut hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}
