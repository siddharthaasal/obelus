import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Kbd,
  Note,
  PageHeader,
  SegmentedControl,
  StatusIcon,
  Switch,
  Toasts,
  useToasts,
} from '../ui'
import './design.css'

const PALETTE = [
  'void',
  'carbon',
  'obsidian',
  'graphite',
  'smoke',
  'ash',
  'fog',
  'mist',
  'bone',
  'paper',
  'acid-lime',
  'pulse-green',
  'coral-red',
  'signal-teal',
  'iris-violet',
  'lavender',
  'porcelain',
  'lagoon',
]

const SEMANTIC: [token: string, use: string][] = [
  ['--bg-canvas', 'Page background'],
  ['--bg-surface', 'Cards, lists, top bar'],
  ['--bg-raised', 'Dialogs, toasts, menus'],
  ['--bg-control', 'Inputs, secondary buttons'],
  ['--fg-primary', 'Headings'],
  ['--fg-strong', 'Row titles, emphasis'],
  ['--fg-body', 'Body copy, button text'],
  ['--fg-muted', 'Metadata, labels'],
  ['--fg-faint', 'Placeholders, separators'],
  ['--border-subtle', 'Hairlines, card edges'],
  ['--border-strong', 'Hover edges, section rules'],
  ['--accent', 'The one primary action'],
  ['--status-done', 'Ready, success'],
  ['--status-danger', 'Failed, destructive'],
  ['--status-progress', 'Working, informational'],
]

const TYPE: [className: string, name: string, spec: string][] = [
  ['text-heading', 'Heading', '48 / 510 / 1.0 / -0.022em'],
  ['text-heading-sm', 'Heading small', '32 / 400 / 1.13 / -0.022em'],
  ['text-title', 'Title', '24 / 510 / 1.33 / -0.012em · page titles'],
  ['text-emphasis', 'Emphasis', '20 / 590 / 1.33 / -0.012em'],
  ['text-body', 'Body', '16 / 400 / 1.5'],
  ['text-body-sm', 'Body small', '15 / 400 / 1.6 / -0.011em · prose'],
  ['text-ui', 'UI', '14 / 400 / 1.5 / -0.01em · default'],
  ['text-caption', 'Caption', '13 / 400 / 1.4 · metadata'],
  ['text-label', 'Label', '12 / 400 / 1.4 · badges, column heads'],
  ['text-micro', 'Micro', '10 / 510 / 1.5'],
]

const SPACING = [4, 8, 12, 16, 24, 32, 48, 64, 96]

/** Live reference for the design system. Not linked from the app; open /design. */
export default function DesignPage() {
  const { toasts, show, dismiss } = useToasts()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [switchOn, setSwitchOn] = useState(true)
  const [tab, setTab] = useState<'lookups' | 'chat' | 'highlights'>('lookups')
  const hex = readTokens(PALETTE.map((name) => `--color-${name}`))

  return (
    <main className="page design">
      <PageHeader
        title="Design system"
        description={
          <>
            Obelus follows Linear&rsquo;s design system. Rules and rationale are in <code>DESIGN.md</code>;
            components live in <code>frontend/src/ui</code>. Switch the theme in the top bar to check
            both.
          </>
        }
      />

      <Section
        title="Palette"
        note="Primitives. Only tokens.css refers to these. Porcelain and lagoon are Obelus additions for the light theme."
      >
        <div className="swatches">
          {PALETTE.map((name) => (
            <div key={name} className="swatch">
              <span className="swatch-chip" style={{ background: `var(--color-${name})` }} />
              <span className="swatch-name">{name}</span>
              <span className="swatch-hex text-mono">{hex[`--color-${name}`]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Semantic tokens" note="What components and pages use, shown in the current theme.">
        <Card as="ul" padded={false} className="token-list">
          {SEMANTIC.map(([token, use]) => (
            <li key={token}>
              <span className="swatch-chip small" style={{ background: `var(${token})` }} />
              <code>{token}</code>
              <span className="text-muted">{use}</span>
            </li>
          ))}
        </Card>
      </Section>

      <Section title="Type" note="Inter Variable with cv01, ss03 and zero. Weights 400, 510, 590; never bold.">
        <div className="type-list">
          {TYPE.map(([className, name, spec]) => (
            <div key={className} className="type-row">
              <span className="type-meta">
                <span>{name}</span>
                <span className="text-mono text-faint">{spec}</span>
              </span>
              <span className={className}>Being and Time, 1927</span>
            </div>
          ))}
          <div className="type-row">
            <span className="type-meta">
              <span>Mono</span>
              <span className="text-mono text-faint">12 / 400 · IDs, paths, shortcuts</span>
            </span>
            <span className="text-mono text-label">being-and-time.pdf · p. 0042</span>
          </div>
        </div>
      </Section>

      <Section title="Spacing and radii" note="4px grid. Radii: 4 badges, 6 controls, 12 cards, pill.">
        <div className="spacing-row">
          {SPACING.map((n) => (
            <div key={n} className="spacing-item">
              <span className="spacing-bar" style={{ width: n }} />
              <span className="text-mono text-faint">{n}</span>
            </div>
          ))}
        </div>
        <div className="radius-row">
          {[
            ['badge', '4'],
            ['control', '6'],
            ['card', '12'],
            ['pill', '9999'],
          ].map(([name, value]) => (
            <div key={name} className="radius-item" style={{ borderRadius: `var(--radius-${name})` }}>
              <span>{name}</span>
              <span className="text-mono text-faint">{value}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons" note="One primary per view. Icon-only buttons need aria-label and title.">
        <div className="demo-row">
          <Button variant="primary" icon={Plus}>
            Add PDFs
          </Button>
          <Button icon={RotateCw}>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Remove book</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="demo-row">
          <Button size="sm">Small</Button>
          <Button size="sm" variant="ghost" icon={Pencil}>
            Small ghost
          </Button>
          <Button size="sm" icon={ChevronLeft} aria-label="Previous" title="Previous" />
          <Button size="sm" icon={ChevronRight} aria-label="Next" title="Next" />
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" title="Remove" />
        </div>
      </Section>

      <Section title="Status and badges" note="Chroma belongs to status glyphs and tags, never to body text.">
        <div className="demo-row">
          <span className="demo-status">
            <StatusIcon state="idle" /> Queued
          </span>
          <span className="demo-status">
            <StatusIcon state="progress" progress={0.4} /> Extracting
          </span>
          <span className="demo-status">
            <StatusIcon state="done" /> Ready
          </span>
          <span className="demo-status">
            <StatusIcon state="error" /> Failed
          </span>
        </div>
        <div className="demo-row">
          <Badge>Neutral</Badge>
          <Badge tone="green">Ready</Badge>
          <Badge tone="red">Failed</Badge>
          <Badge tone="teal">Needs OCR</Badge>
          <Badge tone="violet">Kant</Badge>
          <Badge tone="lavender">Hegel</Badge>
          <span className="demo-keys">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </div>
      </Section>

      <Section title="Forms">
        <div className="form-demo">
          <Field label="Title">
            <Input defaultValue="Phenomenology of Spirit" />
          </Field>
          <Field label="Author" hint="Leave blank if unknown.">
            <Input placeholder="G. W. F. Hegel" />
          </Field>
          <div className="demo-row">
            <Input compact mono defaultValue="42" size={4} className="demo-compact" aria-label="Page" />
            <Switch label="Page image" checked={switchOn} onChange={() => setSwitchOn((v) => !v)} />
          </div>
          <div className="demo-row">
            <SegmentedControl
              label="Panel"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'lookups', label: 'Lookups', icon: Search },
                { value: 'chat', label: 'Chat', icon: MessageSquare },
                { value: 'highlights', label: 'Highlights', icon: NotebookPen },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title="Feedback" note="Notes sit inline with what they describe; toasts report on actions.">
        <div className="feedback-demo">
          <Note>2 pages have no usable text and will need OCR.</Note>
          <Note tone="error">PDF is encrypted and cannot be read.</Note>
        </div>
        <div className="demo-row">
          <Button onClick={() => show('info', 'Added 3 books, skipped 1 duplicate.')}>Info toast</Button>
          <Button onClick={() => show('error', "Couldn't add scan.pdf: file is empty.")}>Error toast</Button>
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        </div>
      </Section>

      <Section title="Surfaces">
        <div className="surface-demo">
          <Card>
            <p className="surface-title">Card</p>
            <p className="text-muted text-caption">Carbon surface, 12px radius, inset hairline, 24px padding.</p>
          </Card>
          <Card padded={false}>
            <EmptyState icon={BookOpen} title="Nothing here yet">
              <p>Empty states name what&rsquo;s missing and how to add it.</p>
            </EmptyState>
          </Card>
        </div>
      </Section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Remove “Critique of Pure Reason”?"
        description="Its PDF moves to the trash folder in your data directory."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setDialogOpen(false)}>
              Remove book
            </Button>
          </>
        }
      />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </main>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="design-section">
      <div className="design-section-head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  )
}

function readTokens(names: string[]): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim()]))
}
