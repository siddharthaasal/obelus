export type Health = {
  status: 'ok' | 'degraded'
  db: 'ok' | 'error'
  pgvector: string | null
}

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health')
  // A 503 still carries a Health body describing what's down.
  if (!res.ok && res.status !== 503) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return (await res.json()) as Health
}
