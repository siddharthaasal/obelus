import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  answerAgain,
  ApiError,
  askQuestion,
  type ChatEvent,
  type ChatMessage,
  type ConversationSummary,
  deleteConversation,
  followReply,
  getConversation,
  listConversations,
  type Question,
  stopReply,
} from '../api'

/** The answer to the last question while it's written, or why it couldn't be. */
export type LiveAnswer = {
  text: string
  state: 'waiting' | 'writing' | 'stopping' | 'error'
  error?: string
}

/** The open chat. `id` is null for a new one, until its first question is saved. */
export type Thread = {
  id: number | null
  title: string
  messages: ChatMessage[]
  /** A question on its way to being saved. */
  draft: Question | null
  answer: LiveAnswer | null
}

export type Chat = ReturnType<typeof useChat>

const NEW: Thread = { id: null, title: '', messages: [], draft: null, answer: null }
const LOST = 'Lost the connection while the answer was written. It may still arrive: reopen the chat to check.'

/**
 * The open book's chats: the open one, the list, and the actions on them. Lives in the reader
 * rather than the panel, so switching tabs doesn't lose a question being typed or answered.
 */
export function useChat(bookId: number) {
  const [thread, setThread] = useState<Thread>(NEW)
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  /** Why the last question couldn't be sent; it's back in the input. */
  const [notice, setNotice] = useState<string | null>(null)
  /** The open chat, or the list of them. */
  const [view, setView] = useState<'thread' | 'list'>('thread')

  const current = useRef(thread)
  useLayoutEffect(() => {
    current.current = thread
  })
  // Bumped whenever another chat opens, so a stream still arriving for the last one is ignored.
  const epoch = useRef(0)
  const stream = useRef<AbortController | null>(null)

  const leave = useCallback(() => {
    epoch.current++
    stream.current?.abort()
    stream.current = null
  }, [])

  /**
   * Read a chat stream into the thread. `onUnsent` handles an error before anything arrived
   * (the request was turned down); later errors show on the answer.
   */
  const follow = useCallback(
    async (start: (signal: AbortSignal) => AsyncGenerator<ChatEvent>, onUnsent: (e: Error) => void) => {
      stream.current?.abort()
      const controller = new AbortController()
      stream.current = controller
      const mine = epoch.current
      const live = () => epoch.current === mine && !controller.signal.aborted
      let heard = false
      let ended = false
      try {
        for await (const event of start(controller.signal)) {
          if (!live()) return
          heard = true
          ended = event.event === 'done' || event.event === 'error'
          setThread((t) => apply(t, event))
        }
        if (live() && !ended) setThread((t) => ({ ...t, answer: { text: '', state: 'error', error: LOST } }))
      } catch (e) {
        if (!live()) return
        if (heard) setThread((t) => ({ ...t, answer: { text: '', state: 'error', error: LOST } }))
        else onUnsent(e as Error)
      } finally {
        if (stream.current === controller) stream.current = null
      }
    },
    [],
  )

  const open = useCallback(
    async function open(id: number) {
      leave()
      setView('thread')
      const mine = epoch.current
      setLoading(true)
      setLoadError(null)
      setNotice(null)
      try {
        const c = await getConversation(bookId, id)
        if (epoch.current !== mine) return
        const answer: LiveAnswer | null = c.answering ? { text: '', state: 'waiting' } : null
        setThread({ id: c.id, title: c.title, messages: c.messages, draft: null, answer })
        setLoading(false)
        // Written from another tab, or before the reader left: pick it up where it is.
        if (c.answering) {
          follow(
            (signal) => followReply(bookId, c.id, signal),
            (e) => {
              if (e instanceof ApiError && e.status === 404) void open(c.id) // it finished in between
              else setThread((th) => ({ ...th, answer: { text: '', state: 'error', error: e.message } }))
            },
          )
        }
      } catch (e) {
        if (epoch.current !== mine) return
        setLoadError((e as Error).message)
        setLoading(false)
      }
    },
    [bookId, follow, leave],
  )

  const refreshList = useCallback(() => {
    listConversations(bookId)
      .then(setConversations)
      .catch(() => {})
  }, [bookId])

  // Open the most recent chat, so the conversation carries on where it was left.
  useEffect(() => {
    leave()
    const mine = epoch.current
    listConversations(bookId)
      .then((list) => {
        if (epoch.current !== mine) return
        setConversations(list)
        if (list.length) {
          void open(list[0].id)
        } else {
          setThread(NEW)
          setLoading(false)
        }
      })
      .catch((e: Error) => {
        if (epoch.current !== mine) return
        setLoadError(e.message)
        setLoading(false)
      })
    return leave
  }, [bookId, leave, open])

  const showList = useCallback(() => {
    refreshList()
    setView('list')
  }, [refreshList])
  const showThread = useCallback(() => setView('thread'), [])

  const clear = useCallback(() => {
    leave()
    setThread(NEW)
    setLoading(false)
    setLoadError(null)
    setNotice(null)
  }, [leave])

  const startNew = useCallback(() => {
    clear()
    setView('thread')
  }, [clear])

  const busy = thread.draft !== null || (thread.answer !== null && thread.answer.state !== 'error')

  /** Ask a question (the input's, unless given) from where the reader is. */
  const send = useCallback(
    (page: number, section: string | null, text?: string) => {
      const t = current.current
      const content = (text ?? input).trim()
      const answering = t.draft !== null || (t.answer !== null && t.answer.state !== 'error')
      if (!content || answering) return
      const question: Question = { content, page, section }
      if (text === undefined) setInput('')
      setNotice(null)
      setThread((th) => ({ ...th, draft: question, answer: { text: '', state: 'waiting' } }))
      follow(
        (signal) => askQuestion(bookId, t.id, question, signal),
        (e) => {
          // Not sent: put the question back, to edit or send again.
          setThread((th) => ({ ...th, draft: null, answer: null }))
          setInput((v) => v || content)
          setNotice(e.message)
        },
      )
    },
    [bookId, follow, input],
  )

  /** Answer the last question again: after an error or a stop, or for a different answer. */
  const answerLast = useCallback(() => {
    const t = current.current
    if (t.id === null) return
    setThread((th) => ({ ...th, answer: { text: '', state: 'waiting' } }))
    follow(
      (signal) => answerAgain(bookId, t.id!, signal),
      (e) => setThread((th) => ({ ...th, answer: { text: '', state: 'error', error: e.message } })),
    )
  }, [bookId, follow])

  const stop = useCallback(() => {
    const t = current.current
    if (t.id === null || !t.answer) return
    setThread((th) => (th.answer ? { ...th, answer: { ...th.answer, state: 'stopping' } } : th))
    // The stream ends with what was kept.
    stopReply(bookId, t.id).catch(() => {})
  }, [bookId])

  const remove = useCallback(
    async (id: number) => {
      await deleteConversation(bookId, id)
      setConversations((cs) => cs && cs.filter((c) => c.id !== id))
      // The list stays open; the chat behind it becomes a new one.
      if (current.current.id === id) clear()
    },
    [bookId, clear],
  )

  return {
    thread,
    conversations,
    loading,
    loadError,
    busy,
    input,
    setInput,
    notice,
    view,
    showList,
    showThread,
    open,
    startNew,
    send,
    answerLast,
    stop,
    remove,
  }
}

function apply(t: Thread, event: ChatEvent): Thread {
  switch (event.event) {
    case 'user':
      return {
        ...t,
        id: event.conversation.id,
        title: event.conversation.title,
        messages: [...t.messages, event.message],
        draft: null,
      }
    case 'delta': {
      const text = (t.answer?.text ?? '') + event.text
      return { ...t, answer: { text, state: t.answer?.state === 'stopping' ? 'stopping' : 'writing' } }
    }
    case 'done': {
      if (!event.message) return { ...t, answer: null } // stopped before it wrote anything
      // A new answer to the last question replaces the one before it.
      const last = t.messages.findLastIndex((m) => m.role === 'user')
      return { ...t, messages: [...t.messages.slice(0, last + 1), event.message], answer: null }
    }
    case 'error':
      return { ...t, answer: { text: '', state: 'error', error: event.detail } }
  }
}
