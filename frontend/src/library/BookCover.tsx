import { useState } from 'react'
import type { Book } from '../api'
import { cx } from '../ui'
import { coverUrl } from './cover'

/**
 * The first page as a cover, standing on the bottom edge of a 2:3 box so a row of covers lines
 * up whatever their page sizes. A book whose page can't be rendered gets a typeset cover.
 * Key it by book id: the loaded state belongs to one image.
 */
export default function BookCover({ book, className }: { book: Book; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')

  return (
    <span className={cx('cover', className)}>
      {state === 'failed' ? (
        <TypesetCover book={book} />
      ) : (
        <img
          className={cx('cover-image', state === 'loading' && 'is-loading')}
          src={coverUrl(book)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
      {state === 'loading' && <span className="cover-placeholder" aria-hidden />}
    </span>
  )
}

/** Title and author set on a plain board, for books without a usable first page. */
export function TypesetCover({ book, className }: { book: Book; className?: string }) {
  return (
    <span className={cx('cover-typeset', className)} aria-hidden>
      <span className="cover-typeset-title">{book.title}</span>
      {book.author && <span className="cover-typeset-author">{book.author}</span>}
    </span>
  )
}
