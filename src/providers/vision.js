// Luna — vision router: sends images to vision-capable models with
// keyless-first failover. This is what gives Luna her "eyes".
//
// Candidate order (privacy + resilience):
//   1. local runtimes (Ollama / LM Studio with a vision model) — private, offline
//   2. keyless remote (Kilo gateway: dots-studio/dots-3-note-preview:free)  ← verified live
//   3. keyless remote (Pollinations vision models — discovered dynamically, future-proof)
//   4. keyed providers with vision models (gemini / groq / mistral / openrouter / aimlapi)
//
// All candidates speak the OpenAI multimodal dialect:
//   content: [{type:'text'},{type:'image_url', image_url:{url:'data:...'}}]
import { PROVIDERS, PROVIDER_BY_ID } from './registry.js';
import { chatOnce } from './openai-compat.js';
import { log } from '../util/log.js';
import { errMessage } from '../util/async.js';

/** Model-name heuristics for local multimodal models (ollama/lmstudio). */
export const VISION_NAME_RE =
  /(llava|moondream|minicpm-?v|vision|pixtral|bakllava|qwen[^ ]*vl|vl-?flash|gemma|llama-?4|glm-?4\.?\d*v|omni|internvl|granite.*vision)/i;

const CACHE_TTL = 5 * 60_000;
const cache = {
  pollinations: { at: 0, models: [] },
  ollama: { at: 0, models: [] },
  lmstudio: { at: 0, models: [] },
};

/** Error signatures meaning "this endpoint/model cannot take images". */
function imageUnsupported(msg) {
  return /image input|input_modalit|multimodal|image_url|vision.*(not|unsupport)|does not support/i.test(msg);
}

// ---------- dynamic discovery ----------

/** Pollinations: vision-capable models on the anonymous tier (GET /models, vision:true). */
export async function pollinationsVisionModels() {
  const c = cache.pollinations;
  if (Date.now() - c.at < CACHE_TTL) return c.models;
  try {
    const res = await fetch('https://text.pollinations.ai/models', { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const list = await res.json();
      c.models = (Array.isArray(list) ? list : [])
        .filter((m) => m?.vision === true || (m?.input_modalities || []).includes('image'))
        .map((m) => m.name);
    }
  } catch { /* offline → keep cached/empty */ }
  c.at = Date.now();
  return c.models;
}

/** Ollama: installed models matching the vision heuristics (GET /api/tags). */
export async function ollamaVisionModels() {
  const c = cache.ollama;
  if (Date.now() - c.at < CACHE_TTL) return c.models;
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const j = await res.json();
      c.models = (j.models || []).map((m) => m.name).filter((n) => VISION_NAME_RE.test(n));
    }
  } catch { /* not running */ }
  c.at = Date.now();
  return c.models;
}

/** LM Studio: loaded models matching the vision heuristics (GET /v1/models). */
export async function lmstudioVisionModels() {
  const c = cache.lmstudio;
  if (Date.now() - c.at < CACHE_TTL) return c.models;
  try {
    const res = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const j = await res.json();
      c.models = (j.data || []).map((m) => m.id).filter((n) => VISION_NAME_RE.test(n));
    }
  } catch { /* not running */ }
  c.at = Date.now();
  return c.models;
}

/**
 * Ordered vision candidates for the current config.
 * @returns {Promise<Array<{id:string, label:string, model:string, kind:string}>>}
 */
export async function visionCandidates(cfg = {}) {
  const out = [];

  // 1. local runtimes (private first)
  const [ollamaVis, lmsVis] = await Promise.all([ollamaVisionModels(), lmstudioVisionModels()]);
  for (const model of ollamaVis) out.push({ id: 'ollama', label: 'Ollama (local, private)', model, kind: 'local' });
  for (const model of lmsVis) out.push({ id: 'lmstudio', label: 'LM Studio (local, private)', model, kind: 'local' });

  // 2. keyless remote — Kilo gateway (verified: dots-studio/dots-3-note-preview:free)
  const kilo = PROVIDER_BY_ID.kilo;
  if (kilo) for (const model of kilo.visionModels || []) {
    out.push({ id: 'kilo', label: 'Kilo Gateway (anonymous, keyless)', model, kind: 'keyless' });
  }

  // 3. keyless remote — Pollinations (dynamic; empty today, future-proof)
  for (const model of await pollinationsVisionModels()) {
    out.push({ id: 'pollinations', label: 'Pollinations (anonymous, keyless)', model, kind: 'keyless' });
  }

  // 4. keyed providers with known vision models
  for (const def of PROVIDERS) {
    if (def.kind !== 'keyed') continue;
    const key = cfg.apiKeys?.[def.id];
    if (!key) continue;
    for (const model of def.visionModels || []) {
      out.push({ id: def.id, label: def.label, model, kind: 'keyed' });
    }
  }
  return out;
}

// ---------- the call ----------

function buildMessages({ prompt, system, dataUrl }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: prompt || 'Describe this image precisely: objects, people, text, layout.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  });
  return messages;
}

/**
 * Describe/analyze one image with a vision model. Tries candidates in order.
 * @param {object} opts { imageBase64 | dataUrl, mimeType='image/jpeg', prompt, system, maxTokens }
 * @returns {Promise<{description:string, provider:string, model:string} | {error:string, tried:string[]}>}
 */
export async function describeImage(cfg, opts = {}) {
  const { imageBase64, dataUrl, mimeType = 'image/jpeg', prompt, system, maxTokens } = opts;
  const url = dataUrl || `data:${mimeType};base64,${imageBase64}`;
  if (!url || url.length < 64) return { error: 'no image data provided' };

  const candidates = await visionCandidates(cfg);
  if (!candidates.length) {
    return {
      error: 'no vision-capable model available',
      hint: 'Keyless vision is built in (Kilo gateway — needs internet). For private/offline eyes, install Ollama + a vision model:\n'
        + '  curl -fsSL https://ollama.com/install.sh | sh && ollama pull moondream\n'
        + 'Or add a free key: luna providers  (gemini/groq are free-tier and vision-capable).',
    };
  }

  const messages = buildMessages({ prompt, system, dataUrl: url });
  const tried = [];
  for (const cand of candidates) {
    const def = PROVIDER_BY_ID[cand.id];
    if (!def) continue;
    // force this provider's vision model
    const effective = { ...cfg, providerId: def.id, model: cand.model, provider: def.id };
    try {
      const res = await chatOnce(def, effective, {
        messages,
        temperature: 0.2,
        maxTokens: maxTokens || 700,
      });
      const text = (res.content || '').trim();
      if (text) {
        log.info('vision', `described via ${cand.id}/${cand.model} (${text.length} chars)`);
        return { description: text, provider: def.label, model: cand.model };
      }
      tried.push(`${cand.id}/${cand.model}: empty response`);
    } catch (err) {
      const msg = errMessage(err).slice(0, 200);
      tried.push(`${cand.id}/${cand.model}: ${msg}`);
      log.debug('vision', `candidate failed: ${msg}`);
      if (imageUnsupported(msg)) continue;      // try next model/endpoint
      if (err?.authFailed || err?.status === 404) continue; // wrong route for images / not signed in
      continue;                                  // any failure → next candidate
    }
  }
  return { error: 'all vision candidates failed', tried };
}

/** Cheap capability report (no tokens spent) — used by doctor / self.sensors. */
export async function visionStatus(cfg = {}) {
  const candidates = await visionCandidates(cfg);
  return {
    available: candidates.length > 0,
    candidates: candidates.map((c) => `${c.id}/${c.model} (${c.kind})`),
    keyless: candidates.filter((c) => c.kind === 'keyless').length > 0,
    local: candidates.filter((c) => c.kind === 'local').map((c) => c.model),
  };
}
