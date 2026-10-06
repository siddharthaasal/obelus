# Design system

Obelus follows [Linear's design system](Linear%20DESIGN.md): a near-black canvas, paper-white
type, hairline borders instead of shadows, low font weights, compact spacing, and one acid-lime
accent reserved for the primary action. The product's content (book pages, extracted text, AI
answers) is the only visual texture. Everything else stays quiet.

- **Tokens:** `frontend/src/ui/tokens.css`
- **Base styles and type classes:** `frontend/src/ui/base.css`
- **Components:** `frontend/src/ui/`, imported from `../ui`
- **Live reference:** open `/design` in the running app to see every token and component.

Build new UI from these pieces. If a page needs something the system doesn't have, add it to
`ui/` (see [Adding to the system](#adding-to-the-system)) rather than styling it one-off.

## Principles

1. **The canvas recedes.** Surfaces step toward the light as they rise: `void` to `carbon` to
   `obsidian` in dark, `porcelain` to white in light. Elevation comes from those steps and a
   1px or 0.5px hairline, not from drop shadows.
2. **One lime action per view.** `--accent` (#e4f222) marks the single most important action on
   a screen: *Add PDFs* in the library, *Save* in a dialog. Everything else is neutral.
3. **Text is grey.** Body copy uses the white-to-grey scale only. Colour belongs to status
   glyphs, badges, and tags, never to sentences.
4. **Light type.** Weights are 400, 510, and 590. Never bold (700+). Headings are tight
   (-0.012em to -0.022em).
5. **Compact.** 4px grid, 32px controls, 8px gaps between elements, 24px card padding.
6. **Few radii.** 6px for controls, 12px for cards and dialogs, pill for switches. Badges and
   keys use 4px. Nothing is rounder than 12px except a pill.

## Where Obelus differs from the reference

The reference describes Linear's marketing site. Obelus is an app, so a few things are adapted:

- **Sizes.** Linear's marketing body text is 16px. Its product UI is 13–14px, and so is ours:
  chrome defaults to 14px (`.text-ui`), metadata to 13px, labels to 12px. Prose we render
  (clean text, lookups, chat) uses 15px at 1.6 line height, capped at 68 characters.
- **Fonts.** Inter comes from the `inter-ui` package (official Inter 4.1). Fontsource's build
  strips the `cv01`, `ss03`, and `zero` features the system depends on. JetBrains Mono stands in
  for Berkeley Mono, which is commercial. Both are bundled, so nothing loads from the network.
- **Status colours.** The reference calls green and red "supporting accents, not status
  colours". An ingestion app needs status, so they're mapped to semantic tokens: green for
  done, red for failed or destructive, teal for in progress and information.
- **Destructive actions** get a `danger` button: a red tint, not a filled red, so lime stays
  the only filled colour.
- **Switches are monochrome.** When on, the track is mist, not lime.
- **A light theme.** Linear's reference is dark only; Obelus adds light. See [Themes](#themes).
- **Book pages stay white** in both themes. Rendered PDF pages sit inside a hairline frame,
  like Linear's product screenshots.

## Themes

There are two themes, dark (Linear's) and light, and the top bar has a switcher: Match system,
Light, or Dark. The choice is saved in `localStorage` under `obelus.theme`, and a small script
in `index.html` applies it before first paint so there's no flash.

- **How it works.** Every semantic colour is written once in `tokens.css` as
  `light-dark(<light>, <dark>)`. The browser picks a value based on the root's `color-scheme`,
  which follows the system unless `<html data-theme="light|dark">` pins it. Nothing else
  switches on the theme, so components never need a theme check.
- **Light reuses the ramp.** Light is the same grey ramp, inverted: text runs `void`, `obsidian`,
  `smoke`, `ash`, `fog`; borders are `bone` and `mist`; cards are white on a `porcelain` canvas.
  The only new primitives are `porcelain` (#f7f8f8, the canvas) and `lagoon` (#0a8fa0), a
  deeper signal teal that keeps status icons above 3:1 contrast on white.
- **Lime stays lime.** It's nearly as light as white, so on a light canvas the primary button
  gets a faint dark edge (`--accent-edge`) and darkens on hover instead of lightening.
- **Tinted text shifts toward contrast.** Badge and danger text mix their hue with
  `--tone-shift`, which is black in light and white in dark.
- **Overlays** in light get a soft drop shadow instead of dark's inner highlight.

Check new UI in both themes. `/design` shows every component in whichever theme is active.

## Tokens

Primitives (`--color-void`, `--color-fog`, ...) are Linear's palette under its own names. Only
`tokens.css` refers to them. Everything else uses semantic tokens:

| Token | Use |
| --- | --- |
| `--bg-canvas` | Page background |
| `--bg-surface` | Cards, lists, the top bar |
| `--bg-raised` | Dialogs, toasts, menus |
| `--bg-control` | Inputs and secondary buttons (white in light) |
| `--bg-subtle` / `--bg-tint` | Row hover and faint fills / badge, key, and segmented-control fills |
| `--bg-hover` / `--bg-active` | Hover and pressed states on neutral controls |
| `--fg-primary` | Headings |
| `--fg-strong` | Row titles, emphasis |
| `--fg-body` | Body copy, button labels |
| `--fg-muted` | Metadata, labels, secondary text |
| `--fg-faint` | Placeholders, separators, file names. Too low-contrast for anything essential |
| `--border-subtle` | Hairlines, dividers, card edges |
| `--border-strong` | Hover edges, section rules |
| `--border-input` / `--border-focus` | Input edges / focused input edge and focus ring |
| `--accent` | The one primary action |
| `--status-done`, `--status-danger`, `--status-progress`, `--status-info`, `--status-idle` | Status glyphs, badges, note icons |
| `--tag-violet`, `--tag-lavender` | Category tags (authors, topics) |
| `--highlight-yellow`, `-green`, `-blue`, `-pink` | Highlighter inks on book pages (with `mix-blend-mode: multiply`) and their swatches. The same in both themes, since pages stay white |

Spacing is `--spacing-4` through `--spacing-128`. Radii are `--radius-badge`, `--radius-control`,
`--radius-card`, and `--radius-pill`. Use `--hairline` for dividers: it's 1px, or 0.5px on
high-density screens.

Page and component CSS never contains a hex or `rgb()` colour, and never calls `light-dark()`
itself. If the token you need doesn't exist, add a semantic token to `tokens.css` with both
values.

## Type

Apply the composite classes from `base.css`, or use the size tokens with the matching weight and
tracking.

| Class | Size / weight / line height / tracking | Use |
| --- | --- | --- |
| `.text-title` | 24 / 510 / 1.33 / -0.012em | Page titles |
| `.text-emphasis` | 20 / 590 / 1.33 / -0.012em | Section leads |
| `.text-body` | 16 / 400 / 1.5 | Rare in chrome |
| `.text-body-sm`, `.prose` | 15 / 400 / 1.6 / -0.011em | Book text, AI answers, row titles |
| `.text-ui` | 14 / 400 / 1.5 / -0.01em | The default |
| `.text-caption` | 13 / 400 / 1.4 | Metadata, descriptions, buttons |
| `.text-label` | 12 / 400 / 1.4 | Badges, column heads, small buttons |
| `.text-mono` | 12 / 400 | File names, paths, page numbers, IDs, shortcuts |

The larger sizes (`.text-heading-sm`, `.text-heading`, `.text-display`) exist but belong to
marketing-style pages, not the app. Mono is never used for headings or prose.

## Components

| Component | Use it for |
| --- | --- |
| `Button`, `ButtonLink` | Actions. Variants: `primary` (one per view), `secondary` (default, outlined), `ghost` (toolbars, row actions), `danger` (confirming destruction). Sizes `md` (32px) and `sm` (26px). An icon with no label makes it square: give it `aria-label` and `title`. |
| `Badge` | Inline metadata: a count, a status word, a tag. Tones: `neutral`, `green`, `red`, `teal`, `violet`, `lavender`. |
| `StatusIcon` | Linear-style status glyph: `idle` (dashed ring), `progress` (filling pie), `done`, `error`. Pass `label` unless visible text says the same thing. |
| `Card` | A carbon surface with a hairline edge. `padded={false}` for lists whose rows bring their own padding; `as="ul"` for lists. |
| `PageHeader` | The top of every page: optional breadcrumb, title, an accessory such as a count badge, description, actions. |
| `Field`, `Input`, `Textarea`, `Switch` | Forms. `Input compact mono` for toolbar inputs like the page number. `Textarea autoGrow` grows with its text up to 200px, then scrolls. `Switch` is for settings that apply immediately. |
| `PageInput` | The page number field in the reader and debug view: shows the current page, Enter goes, Escape cancels. |
| `PageRef` | A page citation, "p. 37" or "pp. 12–14". Shows the printed page number when the PDF has labels and jumps to the PDF page. |
| `Swatches` | A choice of colour, applied immediately: a highlight's ink. Native radios; the chosen one gets a grey ring, since the colours carry no state. |
| `SegmentedControl` | One of a few options, applied immediately: panel tabs, search modes, the theme. Native radios underneath; `iconOnly` turns labels into tooltips. |
| `ThemeSwitcher`, `useTheme` | The top bar's theme control and the hook behind it. |
| `Dialog` | Modal on the native `<dialog>`. Use it for confirmations and short forms. Pass `onSubmit` to make the panel a form. Footer order is Cancel, then the committing action. |
| `Note` | One line of inline status next to what it describes. The icon carries the tone (`info` or `error`); the text stays grey. |
| `Toasts` + `useToasts` | Reports on actions ("Added 3 books"). Info toasts dismiss themselves after 6s; errors stay until dismissed. |
| `EmptyState` | What a list shows when there's nothing in it: an icon, what's missing, how to add it. |
| `Kbd` | A key in a shortcut hint. |
| `Logo` | The obelus (÷) glyph and wordmark. |

Icons are [Lucide](https://lucide.dev/icons) line icons. `IconDefaults` in `main.tsx` sets them
to 16px with a 1.5px stroke. Pass `size={14}` inside small buttons and notes, and `size={20}`
in empty states. Icons are always a single grey, unless they carry status.

## Patterns

- **Lists** are a `Card as="ul"` with rows separated by hairlines. A row has a status glyph, a
  title in `--fg-strong`, one line of `·`-separated metadata in `--fg-muted`, and ghost row
  actions on the right. Long technical strings (file names) go in mono, truncate with an
  ellipsis, and get a `title` with the full value.
- **Confirmations** use a `Dialog` with a `danger` button named for the action ("Remove book").
  Say what will happen, including where things go ("Its PDF moves to the trash folder").
- **Messages:** use a `Note` when the message is about something on screen (a failed book, pages
  needing OCR). Use a toast when it reports the result of an action.
- **Citations** in AI answers are `PageRef`s set inline in the text (`panels/CitedText.tsx`
  turns the model's `[p. N]` into them). Clicking one jumps the reader to the page and briefly
  lights up its frame.
- **Highlights** are drawn on the page below the text, in multiply, so they read like ink.
  In the panel, a passage carries its ink as a 3px left edge; the text itself stays grey.
- **Chat answers** are Markdown, rendered by `panels/Markdown.tsx` as React elements (never
  HTML): paragraphs, lists, quotes, and emphasis, with citations inline. Bold is 590, like
  every other weight ceiling. Questions sit in a tinted block with the page they were asked
  from; answers are plain prose on the panel.
- **Keyboard shortcuts** appear in button `title` text ("Next page (→ or J)") and, where there's
  room, as `Kbd` hints next to the control. Shortcuts are single keys, ignored while typing in a
  field. `[` and `]` toggle left and right panels, as in Linear.
- **Toggles** are ghost buttons with `aria-pressed`; pressed shows the active fill. Use them for
  panels that open and modes that are on, like Contents or Fit to width.
- **Full-window views** (the reader) replace the top bar with their own 48px toolbar: the logo
  glyph links home, the view's controls sit in the middle and on the right, and side columns use
  `--bg-surface` with a hairline edge. Below 900px wide, side columns float over the content.
- **Focus** is a 1.5px mist outline offset by 2px. Never remove it without a replacement.
- **Motion** is short (120–180ms) and never decorative. `prefers-reduced-motion` turns it off.
  The shelf is the one exception (below).
- **Library views** are List, Grid, and Shelf, picked with an icon-only `SegmentedControl` in the
  header and remembered per browser. All three share `library/BookActions.tsx`, so a book's
  actions and dialogs are the same everywhere. Grid covers are the first page, standing on the
  bottom edge of a 2:3 box so a row lines up whatever the page sizes.
- **The shelf** (`library/shelf/`) treats books as objects. Spines are CSS 3D boxes coloured
  from the cover's left edge, with head and foot bands in the cover's most saturated colour, and
  the `--book-*` tokens light and shade them. Its motion is physical and slower than the rest of
  the app: a hovered book slides out (560ms), a clicked one leaves the shelf and turns to show its
  cover (900ms), and a new one glides into place (1100ms), all on `--ease-glide`. Nothing
  bounces. Keep this motion on the shelf; don't bring it into chrome.

## Don't

- Use lime for anything but the primary action: not links, not decoration, not selected
  states.
- Use font weights of 700 or above, or gradients on buttons, cards, or text.
- Use drop shadows to lift cards off the canvas. The only shadows are the lime button's,
  overlays (dialogs, toasts), the white page image, and the books on the shelf.
- Use radii above 12px, or colour a paragraph.
- Style a page with a one-off button, input, or badge. Use or extend the component.

## Adding to the system

1. Put the component in `frontend/src/ui/Name.tsx`, with its styles in `Name.css` next to it,
   imported from the component. Class names are unprefixed and specific (`.dialog-footer`, not
   `.footer`).
2. Style it only with semantic tokens. If you need a new one, add it to `tokens.css` under the
   right group, with a light and a dark value. Check it in both themes.
3. Export it from `ui/index.ts`, and add an example to `/design` (`src/design/DesignPage.tsx`).
4. If it sets a rule others should follow, add a line to this file.
