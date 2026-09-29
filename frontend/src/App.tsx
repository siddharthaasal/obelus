import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'
import { getHealth, type Health } from './api'

function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Obelus
        </Link>
        <HealthBadge />
      </header>
      <Outlet />
    </div>
  )
}

function HealthBadge() {
  const [health, setHealth] = useState<Health | 'unreachable' | null>(null)

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth('unreachable'))
  }, [])

  if (health === null) return null
  const ok = health !== 'unreachable' && health.status === 'ok'
  const title =
    health === 'unreachable'
      ? 'Backend unreachable'
      : `db ${health.db} · pgvector ${health.pgvector ?? 'missing'}`
  return (
    <span className={`health ${ok ? 'ok' : 'bad'}`} title={title}>
      {ok ? 'connected' : title}
    </span>
  )
}

export default App
