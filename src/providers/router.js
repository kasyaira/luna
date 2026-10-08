// Luna — provider router: auto-selection, failover chains, circuit breaker,
// local (Ollama / LM Studio) detection, JSON-protocol fallback.
import { PROVIDERS, PROVIDER_BY_ID, autoOrder } from './registry.js';
import { chatOnce, chatStream, probe } from './openai-compat.js';
import { retry, sleep, errMessage, withTimeout } from '../util/async.js';
import { log } from '../util/log.js';

const state = {
  circuit: new Map(),   // providerId → { fails, openedAt, cooldownUntil }
  lastGood: null,
  localDetected: new Map(), // providerId → true
  jsonOnly: new Set(),  // providers that failed with tools → use JSON protocol
  stats: { calls: 0, providerSwitches: 0, failures: 0, toolCalls: 0 },
};

function breakerKey(id) { return `breaker:${id}`; }

function circuitOpen(id) {
  const c = state.circuit.get(breakerKey(id));
  return !!c && c.openUntil > Date.now();
}

function recordFailure(id, cfg) {
  const key = breakerKey(id);
  const c = state.circuit.get(key) || { fails: 0, openUntil: 0 };
  c.fails += 1;
  if (c.fails >= (cfg.circuitThreshold || 3)) {
    c.openUntil = Date.now() + (cfg.circuitCooldownMs || 90_000);
    log.warn('router', `circuit OPEN for ${id} until ${new Date(c.openUntil).toISOString()}`);
  }
  state.circuit.set(key, c);
}

function recordSuccess(id) {
  state.circuit.delete(breakerKey(id));
  state.lastGood = id;
}

export async function detectLocal(cfg) {
  const locals = PROVIDERS.filter((p) => p.kind === 'local' && p.autoDetect);
  await Promise.all(locals.map(async (p) => {
    if (state.localDetected.has(p.id)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.autoDetect.timeoutMs);
    try {
      await fetch(p.autoDetect.url, { signal: controller.signal });
      state.localDetected.set(p.id, true);
      log.info('router', `local runtime detected: ${p.label}`);
    } catch { /* not running — fine */ }
    finally { clearTimeout(timer); }
  }));
  return [...state.localDetected.keys()];
}

export function isLocalAvailable(id) {
  return state.localDetected.has(id);
}

/** Ordered candidate chain for the current config. */
export function candidateChain(cfg) {
  const pref = cfg.provider || 'auto';
  if (pref && pref !== 'auto') {
    const def = PROVIDER_BY_ID[pref];
    if (!def) throw new Error(`Unknown provider "${pref}". See: luna providers`);
    const key = cfg.apiKeys?.[pref] || (pref === 'custom' ? cfg.apiKey : undefined);
    const needsKey = def.kind === 'keyed' || (pref === 'custom' && cfg.baseUrl && !cfg.baseUrl.includes('localhost'));
    if (needsKey && !key) {
      // configured but unkeyed → still try, but append fallbacks behind it
      return [pref, ...autoOrder(cfg.apiKeys || {}, cfg).filter((x) => x !== pref)];
    }
    return [pref, ...autoOrder(cfg.apiKeys || {}, cfg).filter((x) => x !== pref)];
  }
  const chain = autoOrder(cfg.apiKeys || {}, cfg).filter((id) => {
    const def = PROVIDER_BY_ID[id];
    if (def.kind === 'local') return isLocalAvailable(id); // only if actually running
    if (def.kind === 'custom') return !!cfg.baseUrl;
    return true;
  });
  // always keep the keyless provider as the ultimate safety net
  if (!chain.includes('pollinations')) chain.push('pollinations');
  return chain;
}

/**
 * Main entry: try providers in chain order with retries & circuit breaking.
 * opts: { messages, tools, stream, onDelta, temperature, maxTokens, signal }
 */
export async function chat(cfg, opts) {
  state.stats.calls++;
  const chain = candidateChain(cfg);
  const errors = [];

  for (const id of chain) {
    if (circuitOpen(id) && id !== cfg.provider) continue; // skip tripped breakers (unless explicitly chosen)
    const def = PROVIDER_BY_ID[id];
    const key = cfg.apiKeys?.[id] || (id === 'custom' ? cfg.apiKey : undefined);
    if (def.kind === 'keyed' && !key && id !== cfg.provider) continue;

    try {
      const result = await withTimeout(
        attemptProvider(def, cfg, opts, id),
        (cfg.requestTimeoutMs || 120_000) * 2,
        `provider ${id}`
      );
      recordSuccess(id);
      if (state.lastGood && state.lastGood !== id) state.stats.providerSwitches++;
      return result;
    } catch (err) {
      recordFailure(id, cfg);
      state.stats.failures++;
      const msg = errMessage(err);
      log.warn('router', `${id} failed: ${msg.slice(0, 200)}`);

      // Auth failure with explicit provider is a hard stop (don't leak into other identities)
      if (err.authFailed && id === cfg.provider && id !== 'auto') {
        throw new Error(`Provider "${id}" rejected the API key (401/403). Fix or clear: luna config set provider auto`);
      }
      // Tool-unsupported → remember, retry same provider in JSON mode
      if (msg.includes('tool') && (msg.includes('400') || msg.includes('unsupported') || msg.includes('not support'))) {
        state.jsonOnly.add(id);
        try {
          const result = await attemptProvider(def, cfg, { ...opts, tools: undefined }, id);
          recordSuccess(id);
          return result;
        } catch (err2) {
          errors.push(`${id} (json-mode): ${errMessage(err2).slice(0, 140)}`);
          continue;
        }
      }
      errors.push(`${id}: ${msg.slice(0, 140)}`);
    }
  }
  const anyBudget = errors.some((e) => /402|budget/i.test(e));
  const budgetHint = anyBudget
    ? `\nThe keyless (anonymous) budget for this IP is exhausted right now — it replenishes on its own, or:\n  · wait a few minutes and retry\n  · add a FREE key (2 min): luna providers  (groq / gemini / openrouter are free-tier)\n  · run a local model: ollama serve`
    : '';
  throw new Error(
    `All providers failed.\n  - ` + errors.slice(0, 8).join('\n  - ') +
    budgetHint +
    `\nTry: luna health  |  set a key (see luna providers)  |  run Ollama locally`
  );
}

async function attemptProvider(def, cfg, opts, id) {
  const useJson = state.jsonOnly.has(id) || cfg.forceJsonProtocol;
  const effective = useJson ? { ...opts, tools: undefined } : opts;

  return retry(async (attempt) => {
    try {
      if (opts.stream && def.supportsStream !== false) {
        return await chatStream(def, cfg, effective, opts.onDelta);
      }
      return await chatOnce(def, cfg, effective);
    } catch (err) {
      // 429 → honor Retry-After-ish pause
      if (err.rateLimited) await sleep(1500 * (attempt + 1));
      throw err;
    }
  }, { retries: cfg.retries ?? 2, baseMs: 900, onRetry: (e, n, ms) => {
    // 402 budget errors won't recover by retrying the same provider — bail fast
    if (e?.budget || e?.status === 402) throw e;
    log.debug('router', `retry ${n} for ${id} in ${ms}ms: ${errMessage(e).slice(0, 100)}`);
  }});
}

/** True when the error means "this provider/keyless tier is out of budget" (402). */
export function isBudgetError(err) {
  return !!err?.budget || /\b402\b|budget/i.test(errMessage(err));
}

/** Parallel health probe across every configured/available provider. */
export async function health(cfg) {
  await detectLocal(cfg);
  const ids = PROVIDERS.map((p) => p.id).filter((id) => {
    const def = PROVIDER_BY_ID[id];
    if (def.kind === 'keyed') return !!cfg.apiKeys?.[id];
    if (def.kind === 'custom') return !!cfg.baseUrl;
    if (def.kind === 'local') return isLocalAvailable(id);
    return true;
  });
  const results = await Promise.all(ids.map((id) => probe(PROVIDER_BY_ID[id], cfg)));
  return results.map((r) => ({
    ...r,
    label: PROVIDER_BY_ID[r.id].label,
    kind: PROVIDER_BY_ID[r.id].kind,
    defaultModel: PROVIDER_BY_ID[r.id].defaultModel,
  }));
}

export function providerInfo(id) { return PROVIDER_BY_ID[id]; }
export function allProviders() { return PROVIDERS; }
export function routerState() {
  return {
    ...state.stats,
    lastGood: state.lastGood,
    localDetected: [...state.localDetected.keys()],
    jsonOnlyProviders: [...state.jsonOnly],
    openCircuits: [...state.circuit.entries()]
      .filter(([, c]) => c.openUntil > Date.now())
      .map(([k]) => k.replace('breaker:', '')),
  };
}
export function forceJsonFor(id) { state.jsonOnly.add(id); }
