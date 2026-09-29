import { Highlighter, type LucideIcon, MessageSquare, Search, X } from 'lucide-react'
import { useState } from 'react'
import { readPref, writePref } from '../prefs'
import { Badge, Button, EmptyState, type SegmentOption, SegmentedControl } from '../ui'

type Tab = 'lookups' | 'chat' | 'highlights'

const TABS: SegmentOption<Tab>[] = [
  { value: 'lookups', label: 'Lookups', icon: Search },
  { value: 'chat', label: 'Chat', icon: MessageSquare },
  { value: 'highlights', label: 'Highlights', icon: Highlighter },
]

// What each tab will hold. They're empty until selection actions, chat, and highlights land.
const PLACEHOLDER: Record<Tab, { icon: LucideIcon; title: string; body: string }> = {
  lookups: {
    icon: Search,
    title: 'Lookups',
    body: 'Select a term, a name, or a passage to get its meaning in this book, who the person is, or a plain explanation, with page citations.',
  },
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

const TAB_PREF = 'obelus.reader.tab'

export default function SidePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = readPref(TAB_PREF)
    return TABS.some((t) => t.value === saved) ? (saved as Tab) : 'lookups'
  })
  const placeholder = PLACEHOLDER[tab]

  return (
    <aside className="reader-side reader-panel" aria-label="Side panel">
      <div className="reader-side-head">
        <SegmentedControl
          label="Panel"
          options={TABS}
          value={tab}
          onChange={(next) => {
            setTab(next)
            writePref(TAB_PREF, next)
          }}
        />
        <Button variant="ghost" size="sm" icon={X} aria-label="Close panel" title="Close (])" onClick={onClose} />
      </div>
      <div className="reader-side-body">
        <EmptyState icon={placeholder.icon} title={placeholder.title} actions={<Badge>Not built yet</Badge>}>
          <p>{placeholder.body}</p>
        </EmptyState>
      </div>
    </aside>
  )
}
