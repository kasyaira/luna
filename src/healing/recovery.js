// Luna — backup & rollback for self-modification safety.
// Snapshots live under ~/.luna/backups/<timestamp>__<label>/<relative-path>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS, LUNA_ROOT } from '../constants.js';
import { log } from '../util/log.js';

const BACKUP_ROOT = DIRS.backups;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slug(label) {
  return String(label || 'snap').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
}

/** Backup a single file (must be inside Luna's own source tree for self-protection). */
export function backupFile(file, label = 'edit') {
  const abs = path.resolve(file);
  const rel = path.relative(LUNA_ROOT, abs);
  if (rel.startsWith('..')) return { ok: false, error: 'refusing to back up files outside Luna root' };
  const dir = path.join(BACKUP_ROOT, `${stamp()}__${slug(label)}`);
  const dest = path.join(dir, rel);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
    log.info('recovery', `backed up ${rel} → ${path.relative(BACKUP_ROOT, dest)}`);
    return { ok: true, backup: dest, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Full snapshot of Luna's source (bin/ src/ skills/ package.json). */
export function snapshot(label = 'manual') {
  const dir = path.join(BACKUP_ROOT, `${stamp()}__${slug(label)}`);
  const targets = ['bin', 'src', 'skills', 'package.json'];
  let count = 0;
  for (const t of targets) {
    const from = path.join(LUNA_ROOT, t);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dir, t);
    try {
      fs.cpSync(from, to, { recursive: true, filter: (f) => !f.includes('node_modules') });
      count++;
    } catch (err) {
      log.warn('recovery', `snapshot partial fail on ${t}: ${err.message}`);
    }
  }
  log.info('recovery', `snapshot "${label}" → ${path.basename(dir)} (${count} targets)`);
  return { ok: count > 0, dir, count };
}

export function listSnapshots(limit = 30) {
  try {
    return fs.readdirSync(BACKUP_ROOT)
      .filter((d) => !d.startsWith('.'))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch { return []; }
}

/** Restore one file from the newest backup that contains it. */
export function restoreFile(relPath) {
  const rel = relPath.replace(/^[/\\]+/, '');
  const snaps = listSnapshots(200);
  for (const snap of snaps) {
    const candidate = path.join(BACKUP_ROOT, snap, rel);
    if (fs.existsSync(candidate)) {
      const dest = path.join(LUNA_ROOT, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(candidate, dest);
      log.info('recovery', `restored ${rel} from ${snap}`);
      return { ok: true, from: snap, file: dest };
    }
  }
  return { ok: false, error: `no backup found for ${rel}` };
}

/** Roll back the entire source tree to a given (or latest) snapshot. */
export function rollback(label) {
  const snaps = listSnapshots(200);
  if (!snaps.length) return { ok: false, error: 'no backups exist yet' };
  let chosen;
  if (label) {
    chosen = snaps.find((s) => s === label || s.includes(slug(label)));
    if (!chosen) return { ok: false, error: `snapshot "${label}" not found` };
  } else {
    chosen = snaps[0];
  }
  const src = path.join(BACKUP_ROOT, chosen);
  let restored = 0;
  for (const t of ['bin', 'src', 'skills', 'package.json']) {
    const from = path.join(src, t);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(LUNA_ROOT, t), { recursive: true });
    restored++;
  }
  // safety snapshot of the broken state before we overwrite it
  snapshot(`pre-rollback-broken-${crypto.randomUUID().slice(0, 6)}`);
  log.info('recovery', `rolled back source to ${chosen}`);
  return { ok: true, snapshot: chosen, restored };
}

/** Find which of Luna's own files broke, and restore them. Used by supervisor. */
export function autoRepair(report) {
  const results = [];
  for (const bad of report.bad || []) {
    const rel = path.relative(LUNA_ROOT, bad.file);
    const r = restoreFile(rel);
    results.push({ file: rel, ...r });
  }
  return results;
}
