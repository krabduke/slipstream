/** Minimal fetch helpers with a weight budget, retries, and timeouts. */

export class WeightBudget {
  private used = 0
  private windowStart = Date.now()
  constructor(private readonly perMinute: number) {}

  async take(weight: number): Promise<void> {
    for (;;) {
      const now = Date.now()
      if (now - this.windowStart >= 60_000) {
        this.windowStart = now
        this.used = 0
      }
      if (this.used + weight <= this.perMinute) {
        this.used += weight
        return
      }
      await sleep(60_000 - (now - this.windowStart) + 50)
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, retries = 3, ...rest } = init
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal })
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${res.status} from ${new URL(url).host}`)
        await sleep(1000 * 2 ** attempt)
        continue
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`)
      return (await res.json()) as T
    } catch (e) {
      lastErr = e
      if (attempt < retries) await sleep(1000 * 2 ** attempt)
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Run `fn` over `items` with at most `n` in flight. Errors are collected, not thrown. */
export async function pool<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T) => Promise<R>,
): Promise<{ ok: R[]; failed: { item: T; error: string }[] }> {
  const ok: R[] = []
  const failed: { item: T; error: string }[] = []
  let i = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!
      try {
        ok.push(await fn(item))
      } catch (e) {
        failed.push({ item, error: e instanceof Error ? e.message : String(e) })
      }
    }
  })
  await Promise.all(workers)
  return { ok, failed }
}
