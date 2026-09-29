import { useCallback, useRef, useState } from 'react'

export type ToastTone = 'info' | 'error'
export type ToastItem = { id: number; tone: ToastTone; text: string }

const INFO_TIMEOUT_MS = 6000

/** Toast state for one page. Info toasts dismiss themselves; errors stay until dismissed. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const show = useCallback(
    (tone: ToastTone, text: string) => {
      const id = nextId.current++
      setToasts((t) => [...t, { id, tone, text }])
      if (tone === 'info') setTimeout(() => dismiss(id), INFO_TIMEOUT_MS)
    },
    [dismiss],
  )

  return { toasts, show, dismiss }
}
