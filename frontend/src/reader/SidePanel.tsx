import { Highlighter, MessageSquare, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, type SegmentOption, SegmentedControl } from '../ui'

export type Tab = 'lookups' | 'chat' | 'highlights'

const TABS: SegmentOption<Tab>[] = [
  { value: 'lookups', label: 'Lookups', icon: Search },
  { value: 'chat', label: 'Chat', icon: MessageSquare },
  { value: 'highlights', label: 'Highlights', icon: Highlighter },
]

type Props = {
  tab: Tab
  onTabChange: (tab: Tab) => void
  onClose: () => void
  /** Each tab's content. */
  panels: Record<Tab, ReactNode>
}

export default function SidePanel({ tab, onTabChange, onClose, panels }: Props) {
  return (
    <aside className="reader-side reader-panel" aria-label="Side panel">
      <div className="reader-side-head">
        <SegmentedControl label="Panel" options={TABS} value={tab} onChange={onTabChange} />
        <Button variant="ghost" size="sm" icon={X} aria-label="Close panel" title="Close (])" onClick={onClose} />
      </div>
      <div className="reader-side-body">{panels[tab]}</div>
    </aside>
  )
}
