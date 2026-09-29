import { LucideProvider } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Icons are Lucide line icons: 16px, a 1.5px stroke at any size, in currentColor.
 * Wrap the app once; pass `size` on an icon only when a component calls for 14 or 20.
 */
export function IconDefaults({ children }: { children: ReactNode }) {
  return (
    <LucideProvider size={16} strokeWidth={1.5} absoluteStrokeWidth className="icon">
      {children}
    </LucideProvider>
  )
}
