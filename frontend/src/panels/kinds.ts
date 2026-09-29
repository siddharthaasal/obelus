import { BookA, type LucideIcon, TextQuote, UserRound } from 'lucide-react'
import type { LookupKind } from '../api'

/** The selection actions: their names, reader shortcuts, and icons. */
export const KINDS: Record<LookupKind, { label: string; key: string; icon: LucideIcon }> = {
  define: { label: 'Define', key: 'D', icon: BookA },
  who: { label: 'Who', key: 'W', icon: UserRound },
  explain: { label: 'Explain', key: 'E', icon: TextQuote },
}
