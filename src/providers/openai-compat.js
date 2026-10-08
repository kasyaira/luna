// Luna — generic OpenAI-compatible chat adapter.
// Handles: request build, SSE streaming, tool-call accumulation,
// error normalization, and the "reasoning" field emitted by gpt-oss models.
import { log } from '../util/log.js';
import { errMessage } from '../util/async.js';

export class ProviderHttpError extends Error {
  constructor(status, body, providerId) {
    super(`HTTP ${status} from ${providerId}: ${errMessage(body)}`.slice(0, 400));
    this.name = 'ProviderHttpError';
    this.status = status;
    this.body = body;
    this.providerId = providerId;
    this.rateLimited = status === 429;
    this.authFailed = status === 401 || status === 403;
    this.budget = status === 402; // anonymous/keyless budget exhausted
  }
}

function endpoint(def, cfg) {
  const base = (def.id === 'custom' ? (cfg.baseUrl || def.baseUrl) : def.baseUrl) || '';
  const chatPath = def.chatPath || '/chat/completions';
  return base.replace(/\/$/, '') + chatPath;
}

function pickModel(def, cfg) {
  if (cfg.model && cfg.model !== 'auto' && cfg.providerId === def.id) return cfg.model;
  return def.defaultModel || 'auto';
}

export function buildRequest(def, cfg, { messages, tools, stream, temperature, maxTokens }) {
  const key = cfg.apiKeys?.[def.id] || (def.id === 'custom' ? cfg.apiKey : undefined);
  const url = endpoint(def, cfg);
  const body = {
    model: pickModel(def, cfg),
    messages,
    stream: !!stream,
  };
  if (temperature != null) body.temperature = temperature;
  if (maxTokens) body.max_tokens = maxTokens;
  if (tools?.length && def.supportsTools !== false && !cfg.forceJsonProtocol) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (def.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/kasyaira/luna';
    headers['X-Title'] = 'Luna Agent';
  }
  if (def.id === 'pollinations' && !key) {
    // polite anonymous identification
    headers['User-Agent'] = 'LunaAgent/1.0 (+https://github.com/kasyaira/luna)';
  }
  return { url, headers, body };
}

/** Non-streaming call. Returns normalized completion. */
export async function chatOnce(def, cfg, opts) {
  const req = buildRequest(def, cfg, { ...opts, stream: false });
  const res = await fetchReq(def, cfg, req);
  return normalize(def, cfg, res);
}

/**
 * Streaming call. Consumes SSE, invokes onDelta({content?, reasoning?}),
 * returns the same normalized completion as chatOnce.
 */
export async function chatStream(def, cfg, opts, onDelta) {
  const req = buildRequest(def, cfg, { ...opts, stream: true });
  const res = await fetchReq(def, cfg, req, true);

  const acc = { content: '', reasoning: '', toolCalls: [] };
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning) {
        acc.reasoning += delta.reasoning;
        onDelta?.({ reasoning: delta.reasoning });
      }
      if (delta.content) {
        acc.content += delta.content;
        onDelta?.({ content: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          acc.toolCalls[i] ??= { id: tc.id || `call_${i}`, type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) acc.toolCalls[i].id = tc.id;
          if (tc.function?.name) acc.toolCalls[i].function.name += tc.function.name;
          if (tc.function?.arguments) acc.toolCalls[i].function.arguments += tc.function.arguments;
        }
      }
    }
  }
  return finalize(def, cfg, acc);
}

async function fetchReq(def, cfg, req, isStream = false) {
  const timeout = cfg.requestTimeoutMs || 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderHttpError(res.status, text, def.id);
    }
    if (isStream) return res;
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ProviderHttpError(408, `timeout after ${timeout}ms`, def.id);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize non-streaming response. */
function normalize(def, cfg, json) {
  const choice = json?.choices?.[0];
  const msg = choice?.message || {};
  const acc = {
    content: typeof msg.content === 'string' ? msg.content : '',
    reasoning: typeof msg.reasoning === 'string' ? msg.reasoning : '',
    toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls.map((tc, i) => ({
      id: tc.id || `call_${i}`,
      type: 'function',
      function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' },
    })) : [],
  };
  return finalize(def, cfg, acc, json);
}

function finalize(def, cfg, acc, raw) {
  const calls = (acc.toolCalls || []).filter((tc) => tc.function?.name);
  return {
    content: acc.content || '',
    reasoning: acc.reasoning || '',
    toolCalls: calls.length ? calls : undefined,
    finish: raw?.choices?.[0]?.finish_reason || (calls.length ? 'tool_calls' : 'stop'),
    usage: raw?.usage || null,
    provider: def.label || def.id,
    providerId: def.id,
    model: raw?.model || pickModel(def, cfg),
    userTier: raw?.user_tier,
  };
}

/** Quick reachability probe used by `luna health` (cheap GET, no tokens spent). */
export async function probe(def, cfg, { timeoutMs = 4000 } = {}) {
  const base = (def.id === 'custom' ? cfg.baseUrl : def.baseUrl) || '';
  const key = cfg.apiKeys?.[def.id] || (def.id === 'custom' ? cfg.apiKey : undefined);
  const url = base.replace(/\/$/, '') + (def.modelsPath || '/models');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(url, { headers, signal: controller.signal });
    return { id: def.id, ok: res.ok, status: res.status };
  } catch (err) {
    return { id: def.id, ok: false, status: errMessage(err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}
