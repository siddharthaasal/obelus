import { useEffect, useState } from 'react'
import { type Book, pageImageUrl } from '../api'

// A book's cover is its first page. The grid, the shelf, and the spine colour all load the small
// rendering, so the browser fetches it once; the pulled-out book swaps in the large one.
export const coverUrl = (book: Pick<Book, 'id'>) => pageImageUrl(book.id, 1, 60)
export const largeCoverUrl = (book: Pick<Book, 'id'>) => pageImageUrl(book.id, 1, 120)

export type CoverLook = {
  /** Width over height of the first page. */
  aspect: number
  /** Average colour down the cover's left edge, which wraps around onto the spine. */
  spine: string
  /** The spine is dark enough for light lettering. */
  dark: boolean
  /** The cover's most saturated colour, for the bands at the head and foot of the spine. */
  accent: string | null
}

const SAMPLE_WIDTH = 60
/** How much of the cover's left side wraps onto the spine. */
const EDGE = 0.06
const ACCENT_MIN_SATURATION = 0.35

const looks = new Map<number, Promise<CoverLook | null>>()

function readLook(src: string): Promise<CoverLook | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onerror = () => resolve(null)
    img.onload = () => {
      const aspect = img.naturalWidth / img.naturalHeight
      const width = SAMPLE_WIDTH
      const height = Math.max(1, Math.round(width / aspect))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, width, height)
      const { data } = ctx.getImageData(0, 0, width, height)
      const edge = Math.max(2, Math.round(width * EDGE))
      let [r, g, b, n] = [0, 0, 0, 0]
      let accent: [number, number, number] | null = null
      let best = ACCENT_MIN_SATURATION
      for (let i = 0; i < data.length; i += 4) {
        const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]]
        if ((i / 4) % width < edge) {
          r += pr
          g += pg
          b += pb
          n++
        }
        const max = Math.max(pr, pg, pb)
        const min = Math.min(pr, pg, pb)
        const light = (max + min) / 510
        // Mid-tones only: near-black and near-white read as saturated in HSL but aren't.
        if (light < 0.2 || light > 0.8) continue
        const saturation = (max - min) / (255 - Math.abs(max + min - 255))
        if (saturation > best) {
          best = saturation
          accent = [pr, pg, pb]
        }
      }
      ;[r, g, b] = [r / n, g / n, b / n].map(Math.round)
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      resolve({
        aspect,
        spine: `rgb(${r} ${g} ${b})`,
        dark: luminance < 0.55,
        accent: accent && `rgb(${accent.join(' ')})`,
      })
    }
    img.src = src
  })
}

/** The cover's shape and spine colour: undefined while loading, null if it can't be rendered. */
export function useCoverLook(id: number): CoverLook | null | undefined {
  const [look, setLook] = useState<{ id: number; value: CoverLook | null }>()

  useEffect(() => {
    let current = true
    let pending = looks.get(id)
    if (!pending) {
      pending = readLook(coverUrl({ id }))
      looks.set(id, pending)
    }
    pending.then((value) => {
      // Try again next time: the backend may just have been unreachable.
      if (!value) looks.delete(id)
      if (current) setLook({ id, value })
    })
    return () => {
      current = false
    }
  }, [id])

  return look?.id === id ? look.value : undefined
}
