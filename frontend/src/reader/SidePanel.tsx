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
const PLACEHOLDER: Record<Exclude<Tab, 'lookups' | 'chat'>, { icon: LucideIcon; title: string; body: string }> = {
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
  chat: ReactNode
}

export default function SidePanel({ tab, onTabChange, onClose, lookups, chat }: Props) {
  const placeholder = tab === 'highlights' ? PLACEHOLDER[tab] : null
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
        ) : tab === 'chat' ? (
          chat
        ) : (
          lookups
        )}
      </div>
    </aside>
  )
}
