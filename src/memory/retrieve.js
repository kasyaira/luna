// Luna — smart retrieval: TF-IDF similarity + recency decay + importance.
// Runs across all banks IN PARALLEL (Promise.all) — the "parallel memory".
import { STORES, bankDef } from './store.js';

const STOPWORDS = new Set(('a an and are as at be by for from has have i in is it its of on or '
  + 'that the to was were will with you your me my we our they them he she it this these those '
  + 'do does did done not no yes if then than so such can could should would may might must'
  + 'dan yang di ke dari untuk dengan adalah itu ini tidak akan saya kamu').split(' '));

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?—–…«»“”‘’]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function idfMap(docsTokens) {
  const df = new Map();
  for (const tokens of docsTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = Math.max(1, docsTokens.length);
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(1 + N / (1 + d)) + 1);
  return idf;
}

function tf(tokens) {
  const tfm = new Map();
  for (const t of tokens) tfm.set(t, (tfm.get(t) || 0) + 1);
  return tfm;
}

function cosine(tfA, tfB, idf) {
  let dot = 0, magA = 0, magB = 0;
  for (const [t, a] of tfA) {
    const w = (a / (tfA.size || 1)) * (idf.get(t) ?? 1);
    magA += w * w;
    const b = tfB.get(t);
    if (b) dot += w * (b / (tfB.size || 1)) * (idf.get(t) ?? 1);
  }
  for (const [t, b] of tfB) {
    const w = (b / (tfB.size || 1)) * (idf.get(t) ?? 1);
    magB += w * w;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function recencyFactor(ts, halfLifeHours) {
  if (!halfLifeHours) return 1; // durable knowledge
  const hours = Math.max(0, (Date.now() - ts) / 3_600_000);
  return Math.pow(0.5, hours / halfLifeHours);
}

/**
 * Parallel retrieval across banks.
 * @returns array of {record, score, bank} sorted by score desc.
 */
export async function retrieve(query, { banks, k = 6, minScore = 0.05 } = {}) {
  const bankIds = (banks && banks.length ? banks : Object.keys(STORES)).filter((b) => STORES[b]);
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const perBank = await Promise.all(bankIds.map(async (bankId) => {
    const store = STORES[bankId];
    const recs = store.load();
    if (!recs.length) return [];

    const docsTokens = recs.map((r) => tokenize(r.content));
    const idf = idfMap(docsTokens.concat([queryTokens])); // include query terms
    const qtf = tf(queryTokens);

    const scored = recs.map((r, i) => {
      const sim = cosine(qtf, tf(docsTokens[i]), idf);
      const recency = recencyFactor(r.ts || 0, store.def.halfLifeHours);
      const imp = typeof r.importance === 'number' ? r.importance : bankDef(bankId).defaultImportance;
      // tag hits give a small lexical boost
      const tagHit = (r.tags || []).some((tag) =>
        queryTokens.some((q) => tag.toLowerCase().includes(q))) ? 0.12 : 0;
      return { record: r, bank: bankId, score: sim * 0.65 + recency * 0.18 + imp * 0.12 + tagHit };
    });
    return scored.filter((s) => s.score > minScore);
  }));

  return perBank.flat().sort((a, b) => b.score - a.score).slice(0, k);
}

/** Format recalls for the system prompt. */
export function formatRecalls(hits) {
  if (!hits.length) return '(no relevant memories surfaced)';
  return hits.map((h) => {
    const when = new Date(h.record.ts || Date.now()).toISOString().slice(0, 16).replace('T', ' ');
    const tags = (h.record.tags || []).slice(0, 4).join(',');
    const content = String(h.record.content || '').replace(/\s+/g, ' ').slice(0, 320);
    return `[${h.bank} ${when}${tags ? ' #' + tags : ''}] ${content} (relevance ${(h.score).toFixed(2)})`;
  }).join('\n');
}
