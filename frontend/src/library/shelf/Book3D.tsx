import { type CSSProperties, useState } from 'react'
import type { Book } from '../../api'
import { cx } from '../../ui'
import { TypesetCover } from '../BookCover'
import { type CoverLook, coverUrl, largeCoverUrl } from '../cover'
import { DEPTH } from './geometry'

type Props = {
  book: Book
  look: CoverLook | null | undefined
  width: number
  height: number
  /** The pulled-out book: all six faces, and a sharper cover once it has loaded. */
  full?: boolean
  className?: string
  style?: CSSProperties
  onClick?: () => void
}

/**
 * A book as a CSS 3D box the size of its spine: the spine faces you, the front cover is on its
 * right, the back cover on its left, and the page block runs behind. The spine takes its colour
 * from the cover's left edge.
 */
export default function Book3D({ book, look, width, height, full, className, style, onClick }: Props) {
  const vars = {
    '--w': `${width}px`,
    '--h': `${height}px`,
    '--depth': `${DEPTH}px`,
    '--spine': look?.spine,
    '--accent': look?.accent ?? undefined,
  } as CSSProperties

  return (
    <span
      className={cx(
        'book3d',
        look && 'has-look',
        look?.dark && 'is-dark',
        look?.accent && 'has-accent',
        className,
      )}
      style={{ ...vars, ...style }}
      onClick={onClick}
    >
      <span className="book3d-spine">
        <span className="book3d-spine-title">{book.title}</span>
        {width >= 40 && book.author && <span className="book3d-spine-author">{book.author}</span>}
      </span>
      <span className="book3d-face book3d-cover">
        {look === null ? (
          <TypesetCover book={book} className="book3d-typeset" />
        ) : full ? (
          <LargeCover book={book} />
        ) : (
          <img src={coverUrl(book)} alt="" loading="lazy" decoding="async" draggable={false} />
        )}
      </span>
      <span className="book3d-face book3d-back" />
      <span className="book3d-face book3d-top" />
      {full && (
        <>
          <span className="book3d-face book3d-bottom" />
          <span className="book3d-face book3d-fore" />
        </>
      )}
    </span>
  )
}

/** The shelf's small cover straight away, with the sharp one laid over it when it arrives. */
function LargeCover({ book }: { book: Book }) {
  const [sharp, setSharp] = useState(false)
  return (
    <>
      <img src={coverUrl(book)} alt="" draggable={false} />
      <img
        className={cx('book3d-cover-sharp', sharp && 'is-loaded')}
        src={largeCoverUrl(book)}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={() => setSharp(true)}
      />
    </>
  )
}
