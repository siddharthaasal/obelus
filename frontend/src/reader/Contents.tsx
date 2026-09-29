import { ChevronRight, TableOfContents, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, cx, EmptyState } from '../ui'
import type { OutlineItem } from './pdf'

type Props = {
  /** null while the document is loading. */
  outline: OutlineItem[] | null
  labels: string[] | null
  page: number
  onSelect: (item: OutlineItem) => void
  onClose: () => void
}

// Outlines this small start fully expanded; larger ones open only the path to the current section.
const EXPAND_ALL_UNDER = 40

/** The PDF's outline, with the section you're reading marked. */
export default function Contents({ outline, labels, page, onSelect, onClose }: Props) {
  const flat = useMemo(() => flatten(outline ?? []), [outline])
  const current = useMemo(() => currentItem(flat, page), [flat, page])

  return (
    <nav className="reader-side reader-contents" aria-label="Contents">
      <div className="reader-side-head">
        <h2 className="reader-side-title">Contents</h2>
        <Button variant="ghost" size="sm" icon={X} aria-label="Close contents" title="Close ([)" onClick={onClose} />
      </div>
      <div className="reader-side-body">
        {outline === null ? null : outline.length === 0 ? (
          <EmptyState icon={TableOfContents} title="No table of contents">
            <p>This PDF doesn&rsquo;t include an outline. Use the page field, or J and K, to move around.</p>
          </EmptyState>
        ) : (
          <ul className="toc">
            {outline.map((item, i) => (
              <Node
                key={i}
                item={item}
                depth={0}
                current={current}
                labels={labels}
                expandAll={flat.length < EXPAND_ALL_UNDER}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}

type NodeProps = {
  item: OutlineItem
  depth: number
  current: OutlineItem | null
  labels: string[] | null
  expandAll: boolean
  onSelect: (item: OutlineItem) => void
}

function Node({ item, depth, current, labels, expandAll, onSelect }: NodeProps) {
  const isCurrent = item === current
  const holdsCurrent = useMemo(() => current !== null && contains(item, current), [item, current])
  // Until toggled by hand, a branch is open when it holds the section you're reading.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? (expandAll || holdsCurrent)
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isCurrent) row.current?.scrollIntoView({ block: 'nearest' })
  }, [isCurrent])

  const hasChildren = item.items.length > 0
  const pageLabel = item.page === null ? null : (labels?.[item.page - 1] ?? String(item.page))

  return (
    <li>
      <div
        ref={row}
        className={cx('toc-row', isCurrent && 'is-current')}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={cx('toc-toggle', open && 'is-open')}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`}
            aria-expanded={open}
            onClick={() => setToggled(!open)}
          >
            <ChevronRight size={12} aria-hidden />
          </button>
        ) : (
          <span className="toc-toggle" aria-hidden="true" />
        )}
        <button
          type="button"
          className="toc-link"
          disabled={item.dest === null}
          aria-current={isCurrent ? 'location' : undefined}
          onClick={() => onSelect(item)}
        >
          <span className="toc-title">{item.title}</span>
          {pageLabel && <span className="toc-page text-mono">{pageLabel}</span>}
        </button>
      </div>
      {hasChildren && open && (
        <ul>
          {item.items.map((child, i) => (
            <Node
              key={i}
              item={child}
              depth={depth + 1}
              current={current}
              labels={labels}
              expandAll={expandAll}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function flatten(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => [item, ...flatten(item.items)])
}

/** The last entry, in reading order, that starts on or before `page`. */
function currentItem(flat: OutlineItem[], page: number): OutlineItem | null {
  let found: OutlineItem | null = null
  for (const item of flat) {
    if (item.page !== null && item.page <= page) found = item
  }
  return found
}

function contains(item: OutlineItem, target: OutlineItem): boolean {
  return item.items.some((child) => child === target || contains(child, target))
}
