import { Highlighter, type LucideIcon, MessageSquare, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, Button, EmptyState, type SegmentOption, SegmentedControl } from '../ui'

export type Tab = 'lookups' | 'chat' | 'highlights'

const TABS: SegmentOption<Tab>[] = [
  { value: 'lookups', label: 'Lookups', icon: Search },
  { value: 'chat', label: 'Chat', icon: MessageSquare },
  { value: 'highlights', label: 'Highlights', icon: Highlighter },
]

// What the tabs that aren't built yet will hold.
const PLACEHOLDER: Record<Exclude<Tab, 'lookups'>, { icon: LucideIcon; title: string; body: string }> = {
  chat: {
    icon: MessageSquare,
    title: 'Chat',
    body: 'Ask about this book. Answers cite the pages they draw on, and each citation jumps there.',
  },
  highlights: {
    icon: Highlighter,
    title: 'Highlights',
    body: 'Highlighted passages and your notes collect here in page order, ready to export.',
  },
}

type Props = {
  tab: Tab
  onTabChange: (tab: Tab) => void
  onClose: () => void
  lookups: ReactNode
}

export default function SidePanel({ tab, onTabChange, onClose, lookups }: Props) {
  const placeholder = tab === 'lookups' ? null : PLACEHOLDER[tab]
  return (
    <aside className="reader-side reader-panel" aria-label="Side panel">
      <div className="reader-side-head">
        <SegmentedControl label="Panel" options={TABS} value={tab} onChange={onTabChange} />
        <Button variant="ghost" size="sm" icon={X} aria-label="Close panel" title="Close (])" onClick={onClose} />
      </div>
      <div className="reader-side-body">
        {placeholder ? (
          <EmptyState icon={placeholder.icon} title={placeholder.title} actions={<Badge>Not built yet</Badge>}>
            <p>{placeholder.body}</p>
          </EmptyState>
        ) : (
          lookups
        )}
      </div>
    </aside>
  )
}
