import { ArrowUp, History, MessageSquare, RotateCw, Square, SquarePen, Trash2 } from 'lucide-react'
import { type FormEvent, memo, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AiStatus, ChatMessage, ConversationSummary } from '../api'
import { Button, cx, Dialog, EmptyState, Kbd, Note, PageRef, StatusIcon, Textarea } from '../ui'
import Markdown from './Markdown'
import type { Chat, LiveAnswer } from './useChat'
import './chat.css'

type Props = {
  chat: Chat
  ai: AiStatus | null
  /** Where the reader is: sent with each question. */
  page: number
  section: string | null
  labels: string[] | null
  pageCount: number
  onGo: (page: number) => void
  /** Changes when the reader asks for the message box (the C shortcut). */
  focusKey: number
}

type Cite = Pick<Props, 'labels' | 'pageCount' | 'onGo'>

// A book's first answer can wait on Gemini reading the whole book.
const SLOW_MS = 8000
// Closer than this to the bottom, new text keeps the view pinned there.
const STICK_PX = 48
const SUGGESTIONS = ['Summarize the page I’m on', 'What is this chapter arguing?', 'Which terms here should I know?']

/** Chat about the open book: one conversation at a time, or the list of them. */
export default function ChatPanel({ chat, ai, page, section, labels, pageCount, onGo, focusKey }: Props) {
  const { thread, view } = chat
  const input = useRef<HTMLTextAreaElement>(null)
  const cite = useMemo(() => ({ labels, pageCount, onGo }), [labels, pageCount, onGo])

  useEffect(() => {
    if (focusKey) requestAnimationFrame(() => input.current?.focus())
  }, [focusKey])

  const startNew = () => {
    chat.startNew()
    requestAnimationFrame(() => input.current?.focus())
  }
  const isNew = thread.id === null && thread.draft === null

  return (
    <div className="chat">
      <div className="chat-bar">
        <Button
          variant="ghost"
          size="sm"
          icon={History}
          aria-label="All chats"
          title="All chats"
          aria-pressed={view === 'list'}
          onClick={view === 'list' ? chat.showThread : chat.showList}
        />
        <span className="chat-bar-title" title={view === 'thread' ? thread.title : undefined}>
          {view === 'list' ? 'Chats about this book' : thread.title || 'New chat'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={SquarePen}
          aria-label="New chat"
          title="New chat"
          disabled={view === 'thread' && isNew}
          onClick={startNew}
        />
      </div>

      {view === 'list' ? (
        <ChatList
          conversations={chat.conversations}
          currentId={thread.id}
          onOpen={(id) => (id === thread.id ? chat.showThread() : void chat.open(id))}
          onRemove={chat.remove}
        />
      ) : (
        <>
          <ThreadView chat={chat} ai={ai} cite={cite} onSuggest={(text) => chat.send(page, section, text)} />
          <Composer chat={chat} inputRef={input} page={page} section={section} labels={labels} />
        </>
      )}
    </div>
  )
}

function ThreadView({
  chat,
  ai,
  cite,
  onSuggest,
}: {
  chat: Chat
  ai: AiStatus | null
  cite: Cite
  onSuggest: (text: string) => void
}) {
  const { thread, loading, loadError, busy } = chat
  const { messages, draft, answer } = thread
  const root = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)

  // Follow the answer down as it's written, unless the reader has scrolled up to read.
  useEffect(() => {
    const scroller = root.current?.closest('.reader-side-body')
    if (!scroller) return
    const onScroll = () => {
      stuck.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_PX
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    if (draft) stuck.current = true // a new question always brings the view down
  }, [draft])
  useLayoutEffect(() => {
    const scroller = root.current?.closest('.reader-side-body')
    if (scroller && stuck.current) scroller.scrollTop = scroller.scrollHeight
  }, [messages, draft, answer?.text, answer?.state])

  if (loadError) {
    return (
      <div className="chat-thread chat-message-box">
        <Note tone="error">Couldn’t load this chat: {loadError}</Note>
      </div>
    )
  }
  if (loading) return <div className="chat-thread" ref={root} />

  const last = messages.at(-1)
  // A new answer to the last question shows in place of the old one while it's written.
  const replacing = answer !== null && answer.state !== 'error' && !draft && last?.role === 'assistant'
  const shown = replacing ? messages.slice(0, -1) : messages
  const lastAnswerId = last?.role === 'assistant' ? last.id : null
  const unanswered = !busy && !answer && !draft && last?.role === 'user'

  if (shown.length === 0 && !draft) {
    return (
      <div className="chat-thread" ref={root}>
        <EmptyState icon={MessageSquare} title="Ask about this book">
          <p>
            Questions go to Gemini with the book and the page you’re on, so “here” and “this chapter” work. Answers cite
            their pages. Press <Kbd>C</Kbd> to start typing.
          </p>
          {ai && !ai.configured ? (
            <div className="chat-setup">
              <Note tone="error">{ai.problem}</Note>
            </div>
          ) : (
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <Button key={s} size="sm" onClick={() => onSuggest(s)}>
                  {s}
                </Button>
              ))}
            </div>
          )}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="chat-thread" ref={root}>
      <ol className="chat-messages">
        {shown.map((m) =>
          m.role === 'user' ? (
            <Question key={m.id} content={m.content} page={m.page_number} section={m.section} cite={cite} />
          ) : (
            <Answer
              key={m.id}
              message={m}
              cite={cite}
              onAgain={m.id === lastAnswerId && !busy ? chat.answerLast : undefined}
            />
          ),
        )}
        {draft && <Question content={draft.content} page={draft.page} section={draft.section ?? null} cite={cite} />}
        {answer && <Live answer={answer} cite={cite} onRetry={chat.answerLast} />}
        {unanswered && (
          <li className="chat-status">
            <p>This question hasn’t been answered.</p>
            <Button size="sm" onClick={chat.answerLast}>
              Answer it
            </Button>
          </li>
        )}
      </ol>
    </div>
  )
}

function Question({
  content,
  page,
  section,
  cite,
}: {
  content: string
  page: number | null
  section: string | null
  cite: Cite
}) {
  return (
    <li className="chat-question">
      <p className="chat-question-text">{content}</p>
      {page !== null && (
        <p className="chat-question-place">
          <PageRef page={page} labels={cite.labels} onGo={cite.onGo} />
          {section && <span title={section}>{section}</span>}
        </p>
      )}
    </li>
  )
}

const Answer = memo(function Answer({
  message,
  cite,
  onAgain,
}: {
  message: ChatMessage
  cite: Cite
  onAgain?: () => void
}) {
  return (
    <li className="chat-answer">
      <Markdown text={message.content} {...cite} />
      {message.status === 'stopped' && <Note>Stopped before the end.</Note>}
      {message.status === 'truncated' && <Note>The model stopped before finishing. Ask again for a full answer.</Note>}
      {message.context_mode === 'excerpt' && (
        <Note>This book is too long to send whole, so this answer draws on excerpts from it.</Note>
      )}
      <div className="chat-answer-foot">
        <span className="text-mono">{message.model}</span>
        {onAgain && (
          <Button variant="ghost" size="sm" icon={RotateCw} aria-label="Ask again" title="Ask again" onClick={onAgain} />
        )}
      </div>
    </li>
  )
})

function Live({ answer, cite, onRetry }: { answer: LiveAnswer; cite: Cite; onRetry: () => void }) {
  if (answer.state === 'error') {
    return (
      <li className="chat-status">
        <Note tone="error">{answer.error}</Note>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </li>
    )
  }
  if (!answer.text) return <Waiting stopping={answer.state === 'stopping'} />
  return (
    <li className="chat-answer is-live" aria-busy="true">
      <Markdown text={answer.text} {...cite} />
    </li>
  )
}

function Waiting({ stopping }: { stopping: boolean }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [])
  const text = stopping
    ? 'Stopping…'
    : slow
      ? 'Still thinking. A book’s first answer takes longer while Gemini reads it.'
      : 'Thinking…'
  return (
    <li className="chat-status chat-waiting" role="status">
      <StatusIcon state="progress" progress={0.3} />
      {text}
    </li>
  )
}

function Composer({
  chat,
  inputRef,
  page,
  section,
  labels,
}: {
  chat: Chat
  inputRef: RefObject<HTMLTextAreaElement | null>
  page: number
  section: string | null
  labels: string[] | null
}) {
  const { input, setInput, busy, notice, thread } = chat
  const canStop = thread.id !== null && thread.answer !== null && thread.answer.state !== 'stopping'
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    chat.send(page, section)
  }

  return (
    <form className="chat-composer" onSubmit={submit}>
      {notice && <Note tone="error">{notice}</Note>}
      <div className="chat-composer-row">
        <Textarea
          ref={inputRef}
          autoGrow
          rows={1}
          value={input}
          placeholder="Ask about this book"
          aria-label="Message"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
            // Hand the keys back to the reader.
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
        />
        {busy ? (
          <Button icon={Square} aria-label="Stop" title="Stop" disabled={!canStop} onClick={chat.stop} />
        ) : (
          <Button type="submit" icon={ArrowUp} aria-label="Send" title="Send (Enter)" disabled={!input.trim()} />
        )}
      </div>
      <p className="chat-hint">
        Sent with <PageRef page={page} labels={labels} />
        {section && <span className="chat-hint-section">{section}</span>}
      </p>
    </form>
  )
}

function ChatList({
  conversations,
  currentId,
  onOpen,
  onRemove,
}: {
  conversations: ConversationSummary[] | null
  currentId: number | null
  onOpen: (id: number) => void
  onRemove: (id: number) => Promise<void>
}) {
  const [confirming, setConfirming] = useState<ConversationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (conversations === null) return null
  if (conversations.length === 0) {
    return (
      <EmptyState icon={History} title="No chats yet">
        <p>Chats about this book are kept here, the most recent first.</p>
      </EmptyState>
    )
  }
  return (
    <>
      <ul className="chat-list">
        {conversations.map((c) => (
          <li key={c.id} className={cx('chat-list-row', c.id === currentId && 'is-current')}>
            <button type="button" className="chat-list-open" onClick={() => onOpen(c.id)}>
              <span className="chat-list-title">{c.title || 'Untitled chat'}</span>
              <span className="chat-list-meta">
                {c.message_count} {c.message_count === 1 ? 'message' : 'messages'} · {ago(c.updated_at)}
                {c.answering && ' · answering'}
              </span>
            </button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label="Delete chat"
              title="Delete chat"
              onClick={() => setConfirming(c)}
            />
          </li>
        ))}
      </ul>
      <Dialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null)
          setError(null)
        }}
        title="Delete this chat?"
        description={`“${confirming?.title}” and its answers are deleted. This can’t be undone.`}
        footer={
          <>
            <Button onClick={() => setConfirming(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() =>
                confirming &&
                onRemove(confirming.id)
                  .then(() => setConfirming(null))
                  .catch((e: Error) => setError(e.message))
              }
            >
              Delete chat
            </Button>
          </>
        }
      >
        {error && <Note tone="error">{error}</Note>}
      </Dialog>
    </>
  )
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "5 minutes ago", "yesterday", or a date for anything older than a week. */
function ago(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const minutes = seconds / 60
  const hours = minutes / 60
  const days = hours / 24
  if (Math.abs(minutes) < 1) return 'just now'
  if (Math.abs(hours) < 1) return RELATIVE.format(Math.round(minutes), 'minute')
  if (Math.abs(days) < 1) return RELATIVE.format(Math.round(hours), 'hour')
  if (Math.abs(days) < 7) return RELATIVE.format(Math.round(days), 'day')
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
