import { Fragment } from 'react'
import { PageRef } from '../ui'
import { splitCitations } from './citations'

type Props = {
  text: string
  labels: string[] | null
  pageCount: number
  onGo: (page: number) => void
}

/** Model-written text with its page citations turned into links to the page. */
export default function CitedText({ text, labels, pageCount, onGo }: Props) {
  return (
    <>
      {splitCitations(text, pageCount).map((part, i) =>
        typeof part === 'string' ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <span key={i} className="cite">
            {part.refs.map((r, j) => (
              <Fragment key={j}>
                {j > 0 && ' '}
                <PageRef page={r.page} end={r.end} labels={labels} onGo={onGo} />
              </Fragment>
            ))}
          </span>
        ),
      )}
    </>
  )
}
