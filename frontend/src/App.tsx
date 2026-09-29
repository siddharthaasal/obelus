import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'
import { getHealth, type Health } from './api'
import { cx, Logo, ThemeSwitcher } from './ui'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="topbar-brand" aria-label="Obelus library">
          <Logo />
        </Link>
        <div className="topbar-end">
          <HealthIndicator />
          <ThemeSwitcher />
        </div>
      </header>
      <Outlet />
    </div>
  )
}

function HealthIndicator() {
  const [health, setHealth] = useState<Health | 'unreachable' | null>(null)

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth('unreachable'))
  }, [])

  if (health === null) return null
  const ok = health !== 'unreachable' && health.status === 'ok'
  const detail =
    health === 'unreachable'
      ? 'Backend unreachable'
      : `db ${health.db} · pgvector ${health.pgvector ?? 'missing'}`
  return (
    <span className={cx('health', !ok && 'health-bad')} title={detail}>
      <span className="health-dot" aria-hidden="true" />
      {ok ? 'Connected' : detail}
    </span>
  )
}

export default App
