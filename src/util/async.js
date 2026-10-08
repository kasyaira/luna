// Luna — async utilities: sleep, timeout, retry with backoff, simple concurrency limiter
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`Timeout after ${ms}ms: ${label}`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timed = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timed]).finally(() => clearTimeout(timer));
}

/** Retry with exponential backoff. `fn` receives attempt number (0-based). */
export async function retry(fn, { retries = 2, baseMs = 800, maxMs = 15_000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const wait = Math.min(maxMs, baseMs * 2 ** attempt);
      if (onRetry) onRetry(err, attempt + 1, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** Map over items with limited concurrency (parallel but polite). */
export async function pMap(items, mapper, { concurrency = 6, stopOnError = false } = {}) {
  const results = new Array(items.length);
  let next = 0;
  let firstError = null;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (firstError && stopOnError) return;
      try {
        results[i] = await mapper(items[i], i);
      } catch (err) {
        if (stopOnError) { firstError ??= err; return; }
        results[i] = { __error: err };
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  if (firstError) throw firstError;
  return results;
}

export function errMessage(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

export function abridge(text, max = 500) {
  const s = String(text);
  if (s.length <= max) return s;
  return s.slice(0, Math.floor(max * 0.6)) + `\n…[${s.length - max} more chars]…\n` + s.slice(-Math.floor(max * 0.35));
}
