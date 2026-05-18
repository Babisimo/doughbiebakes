// Best-effort, per-process sliding-window limiter. Serverless instances are
// ephemeral and not shared, so this is defense-in-depth only — never the sole
// guarantee. Degrades safely (an unknown key is just another bucket).
const hits = new Map<string, number[]>();

/** Records a hit for `key` and returns true if it now EXCEEDS `max` within
 * `windowMs`. (`max` hits allowed; the `max+1`-th returns true.) */
export function rateLimited(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

/** Test-only: clear all counters. */
export function __resetRateLimit(): void {
  hits.clear();
}
