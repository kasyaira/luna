// Luna — JSONL memory store. One file per bank, append-only writes,
// in-memory index with lazy load, atomic-ish safe appends.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS, MEMORY_BANKS } from '../constants.js';
import { log } from '../util/log.js';

export function newId() {
  return crypto.randomUUID().slice(0, 13).replace(/-/g, '');
}

export class BankStore {
  constructor(bankDef) {
    this.def = bankDef;
    this.file = path.join(DIRS.memory, bankDef.file);
    this.records = null; // lazy
  }

  load() {
    if (this.records) return this.records;
    this.records = [];
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          try { this.records.push(JSON.parse(t)); }
          catch (err) { // self-heal: salvage partial line into a quarantine note
            log.warn('memory', `corrupt line in ${this.def.file}: ${err.message}`);
            this.records.push({
              id: newId(), ts: Date.now(), bank: this.def.id,
              content: t.slice(0, 500), tags: ['corrupt', 'salvaged'], importance: 0.1,
            });
          }
        }
      }
    } catch (err) {
      log.error('memory', `failed loading ${this.file}: ${err.message}`);
      this.records = [];
    }
    return this.records;
  }

  append(rec) {
    this.load().push(rec);
    try {
      fs.mkdirSync(DIRS.memory, { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(rec) + '\n');
    } catch (err) {
      log.error('memory', `failed appending to ${this.def.file}: ${err.message}`);
      return { ok: false, error: err.message };
    }
    return { ok: true, id: rec.id };
  }

  remove(idOrPredicate) {
    const recs = this.load();
    const pred = typeof idOrPredicate === 'function'
      ? idOrPredicate
      : (r) => r.id === idOrPredicate;
    const kept = recs.filter((r) => !pred(r));
    const removed = recs.length - kept.length;
    if (removed > 0) {
      this.records = kept;
      this.flush();
    }
    return removed;
  }

  rewrite(recs) {
    this.records = recs;
    this.flush();
  }

  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.renameSync(tmp, this.file); // atomic replace
  }

  size() { return this.load().length; }
}

export const STORES = Object.fromEntries(
  MEMORY_BANKS.map((b) => [b.id, new BankStore(b)])
);

export function bankDef(id) {
  return MEMORY_BANKS.find((b) => b.id === id);
}
