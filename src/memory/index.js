// Luna — MemoryManager: five parallel memory banks + consolidation.
import { STORES, newId, bankDef } from './store.js';
import { retrieve, formatRecalls } from './retrieve.js';
import { log } from '../util/log.js';
import { tokenize } from './retrieve.js';

export class MemoryManager {
  constructor(cfg) {
    this.cfg = cfg;
    this.consolidateCounter = 0;
  }

  /** Write a record. Multiple banks can be written in parallel via Promise.all. */
  async save(bank, content, { tags = [], importance, id } = {}) {
    const def = bankDef(bank);
    if (!def) return { ok: false, error: `unknown bank "${bank}" (use: ${Object.keys(STORES).join(', ')})` };
    const rec = {
      id: id || newId(),
      ts: Date.now(),
      bank,
      content: String(content).slice(0, 8000),
      tags: tags.map(String).slice(0, 10),
      importance: typeof importance === 'number' ? importance : def.defaultImportance,
    };
    const res = STORES[bank].append(rec);
    log.debug('memory', `save[${bank}] id=${rec.id} tags=${rec.tags.join(',')}`);
    return res;
  }

  /** Parallel recall across banks. */
  async recall(query, { banks, k } = {}) {
    const topK = k || this.cfg.recallTopK || 6;
    return retrieve(query, { banks, k: topK });
  }

  async recallFormatted(query, { banks, k } = {}) {
    const hits = await this.recall(query, { banks, k });
    return { text: formatRecalls(hits), hits };
  }

  /** Auto-log a conversation turn into episodic memory. */
  async logTurn({ user, assistant, toolsUsed }) {
    const content = toolsUsed?.length
      ? `User: ${ab(user)}\nLuna: ${ab(assistant)}\nTools: ${toolsUsed.join(', ')}`
      : `User: ${ab(user)}\nLuna: ${ab(assistant)}`;
    await this.save('episodic', content, { tags: ['turn'], importance: 0.3 });
  }

  /** Log an error→resolution pair into procedural memory (self-healing knowledge). */
  async logError(context, error, resolution) {
    await this.save('procedural',
      `ERROR CONTEXT: ${ab(context, 300)}\nERROR: ${ab(error, 300)}\n${resolution ? 'FIX: ' + ab(resolution, 300) : 'FIX: (pending)'}`,
      { tags: ['error', 'self-healing'], importance: 0.75 });
  }

  async forget(idOrQuery) {
    // by id across banks, in parallel
    const results = await Promise.all(Object.entries(STORES).map(async ([bankId, store]) => {
      const removed = store.remove(idOrQuery);
      return { bank: bankId, removed };
    }));
    const total = results.reduce((s, r) => s + r.removed, 0);
    if (total === 0 && typeof idOrQuery === 'string' && idOrQuery.length > 3) {
      // fuzzy: remove by content match
      const toks = new Set(tokenize(idOrQuery));
      const pred = (r) => {
        const rt = tokenize(r.content);
        const overlap = rt.filter((t) => toks.has(t)).length;
        return toks.size > 0 && overlap >= Math.max(2, Math.ceil(toks.size * 0.6));
      };
      const results2 = await Promise.all(Object.entries(STORES).map(async ([bankId, store]) => {
        const removed = store.remove(pred);
        return { bank: bankId, removed };
      }));
      return { removed: results2.reduce((s, r) => s + r.removed, 0), by: results2 };
    }
    return { removed: total, by: results };
  }

  stats() {
    const banks = {};
    let total = 0;
    for (const [id, store] of Object.entries(STORES)) {
      const n = store.size();
      banks[id] = n;
      total += n;
    }
    return { total, banks };
  }

  async list(bank, { limit = 20, offset = 0 } = {}) {
    if (!STORES[bank]) return { ok: false, error: `unknown bank "${bank}"` };
    const recs = STORES[bank].load();
    return { ok: true, total: recs.length, records: recs.slice(-offset - limit, recs.length - offset || undefined).reverse() };
  }

  /**
   * Consolidation — "smart memory": distill the noisy episodic turns into
   * durable semantic facts + procedural notes. Runs every N turns.
   * Returns null when nothing to do; heuristic (no LLM needed).
   */
  async consolidate({ force = false } = {}) {
    this.consolidateCounter++;
    const every = this.cfg.consolidateEveryTurns || 6;
    if (!force && this.consolidateCounter % every !== 0) return null;

    const episodic = STORES.episodic.load();
    const semantic = STORES.semantic.load();
    if (episodic.length < every) return null;

    const facts = [];
    const seen = new Set(semantic.map((r) => normalizeKey(r.content)));

    for (const rec of episodic) {
      // pull out preference / fact-like statements the user made
      const m = String(rec.content).match(/User: (.{2,200}?)(?:\n|$)/);
      if (!m) continue;
      const line = m[1].trim();
      const isFact = /\b(my name is|i am|i prefer|i like|i hate|i use|i work|ingat|remember|namaku|aku|saya)\b/i.test(line);
      const isPreference = /\b(prefer|like|favorite|always|never|use|habis|suka|biasa)\b/i.test(line);
      if (isFact || isPreference) {
        const key = normalizeKey(line);
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push(line);
      }
      if (facts.length >= 5) break;
    }

    const saved = [];
    for (const f of facts) {
      await this.save('semantic', f, { tags: ['distilled', 'user-profile'], importance: 0.8 });
      saved.push(f);
    }

    // working memory reset: session scratchpad ages out
    const working = STORES.working.load();
    if (working.length > 50) {
      STORES.working.rewrite(working.slice(-25));
    }

    return { distilled: saved.length, facts: saved };
  }
}

function ab(text, n = 700) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function normalizeKey(s) {
  return tokenize(s).slice(0, 12).sort().join('|');
}

export const memoryBanks = () => Object.keys(STORES);
