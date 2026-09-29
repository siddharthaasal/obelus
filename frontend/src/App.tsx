import { useEffect, useState } from 'react'
import { getHealth, type Health } from './api'

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; message: string }

function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    getHealth()
      .then((health) => setState({ kind: 'ok', health }))
      .catch((err: unknown) =>
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
  }, [])

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '20vh 16px 0' }}>
      <h1 style={{ fontWeight: 400, fontSize: '2.5rem', margin: 0 }}>Obelus</h1>
      <p style={{ color: 'var(--muted)', marginTop: 4 }}>A reading companion for dense books.</p>
      <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>
        {state.kind === 'loading' && 'Checking backend…'}
        {state.kind === 'ok' && (
          <span style={{ color: state.health.status === 'ok' ? 'var(--ok)' : 'var(--bad)' }}>
            backend {state.health.status} · db {state.health.db} · pgvector{' '}
            {state.health.pgvector ?? 'missing'}
          </span>
        )}
        {state.kind === 'error' && (
          <span style={{ color: 'var(--bad)' }}>backend unreachable: {state.message}</span>
        )}
      </p>
    </main>
  )
}

export default App
