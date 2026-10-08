// Luna — syntax validation for self-modification.
// Uses `node --check` (real parser) for JS, JSON.parse for JSON.
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { pMap } from '../util/async.js';

const execFileP = promisify(execFile);

export async function checkSyntax(file) {
  const ext = path.extname(file);
  try {
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      const { stdout, stderr } = await execFileP(process.execPath, ['--check', file], { timeout: 15_000 });
      if (stderr && stderr.trim()) return { ok: false, error: stderr.trim().slice(0, 500) };
      return { ok: true };
    }
    if (ext === '.json') {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ok: true };
    }
    return { ok: true, skipped: true }; // md, txt, etc. — nothing to validate
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message || err).slice(0, 500) };
  }
}

/** Validate a whole tree (parallel, bounded). */
export async function checkTree(dir, { ignore = ['node_modules', '.git', 'memory'], concurrency = 8 } = {}) {
  const files = [];
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (ignore.includes(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|json)$/.test(e.name) && !e.name.includes('.luna-new')) files.push(full);
    }
  })(dir);

  const results = await pMap(files, async (f) => ({ file: f, ...(await checkSyntax(f)) }), { concurrency });
  return {
    files: results.length,
    bad: results.filter((r) => !r.ok),
    ok: results.filter((r) => r.ok),
  };
}
