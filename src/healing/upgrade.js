// Luna — real self-upgrade: pull the newest code and relaunch.
// Sources, in order of preference:
//   1. git   — if the install root is a git checkout: `git pull --ff-only`
//   2. zip   — download the GitHub branch zip and copy over the install
//              (works for zip/extracted installs, e.g. luna-main)
//   3. local — a user-provided zip file path
// Always: snapshot first (rollback-able), syntax-check after, then restart.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LUNA_ROOT } from '../constants.js';
import { execCommand } from '../tools/shell-tools.js';
import { snapshot, rollback } from './recovery.js';
import { checkTree } from './validator.js';
import { log } from '../util/log.js';

export const RELEASE_ZIP = 'https://github.com/kasyaira/luna/archive/refs/heads/main.zip';

function isGitRepo() {
  return fs.existsSync(path.join(LUNA_ROOT, '.git'));
}

function sh(cmd, timeoutMs = 120_000) {
  const r = execCommand(cmd, { cwd: LUNA_ROOT, timeoutMs });
  return { ok: r.exit === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/**
 * Apply the upgrade. Returns a report; the caller decides when to restart.
 * @param {object} opts { source?: 'auto'|'git'|'github'|url|zip-path }
 */
export async function applyUpgrade({ source = 'auto' } = {}) {
  const report = { steps: [], ok: false };
  const step = (name, ok, detail = '') => {
    report.steps.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
    return ok;
  };

  // 0. safety snapshot (bin+src+skills) — rollback-able
  const snap = snapshot('pre-upgrade');
  step('snapshot', snap.ok, snap.ok ? `saved ${snap.dir ? path.basename(snap.dir) : ''}` : String(snap.error || ''));

  // 1. decide mode
  let mode = source;
  if (mode === 'auto') mode = isGitRepo() ? 'git' : 'github';

  // 2. apply
  if (mode === 'git') {
    if (!isGitRepo()) {
      step('git', false, 'not a git checkout — use source "github" (zip) instead');
      return report;
    }
    const fetch = sh('git fetch origin 2>&1');
    if (!step('git fetch', fetch.ok, fetch.out)) return report;
    const status = sh('git status --porcelain 2>&1');
    if ((status.out || '').length) {
      const st = sh('git stash push -u -m luna-auto-upgrade 2>&1');
      step('git stash (local changes preserved)', st.ok, st.out.slice(0, 120));
    }
    const pull = sh('git pull --ff-only 2>&1');
    if (!step('git pull --ff-only', pull.ok, pull.out)) return report;
  } else {
    // zip modes: 'github' (RELEASE_ZIP) | any http(s) URL | local file path
    let zipPath = mode;
    if (mode === 'github' || mode === 'zip') zipPath = RELEASE_ZIP;
    const isUrl = /^https?:\/\//i.test(zipPath);
    if (!fs.existsSync(zipPath) && !isUrl) {
      step('locate zip', false, `not found: ${zipPath}`);
      return report;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-upg-'));
    if (isUrl) {
      const dl = sh(`curl -sL --max-time 300 -o ${JSON.stringify(path.join(tmp, 'luna.zip'))} ${JSON.stringify(zipPath)}`, 330_000);
      if (!step('download zip', dl.ok, dl.out || zipPath)) return report;
      zipPath = path.join(tmp, 'luna.zip');
    } else {
      fs.copyFileSync(zipPath, path.join(tmp, 'luna.zip'));
    }
    // extract (unzip → python3 zipfile fallback)
    let ex = sh(`cd ${JSON.stringify(tmp)} && unzip -q -o luna.zip 2>&1`);
    if (!ex.ok) ex = sh(`cd ${JSON.stringify(tmp)} && python3 -m zipfile -e luna.zip . 2>&1`);
    if (!step('extract', ex.ok, ex.out)) return report;
    // find source dir (zip usually contains one root folder)
    const entries = fs.readdirSync(tmp).filter((n) => n !== 'luna.zip' && !n.startsWith('.'));
    const srcDir = entries.length === 1 && fs.statSync(path.join(tmp, entries[0])).isDirectory()
      ? path.join(tmp, entries[0])
      : tmp;
    // copy over the install (overwrites; user extras & .git preserved)
    const cp = sh(`cp -a ${JSON.stringify(path.join(srcDir, '.') + path.sep)} ${JSON.stringify(LUNA_ROOT + path.sep)}`);
    if (!step('copy files', cp.ok, cp.out)) return report;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  // 3. integrity check of the new code
  const check = await checkTree(LUNA_ROOT, { ignore: ['node_modules', '.git'] });
  if (!check.bad.length) {
    step('integrity check', true, `${check.files} files OK`);
    report.ok = true;
    return report;
  }
  // 4. broken → auto-rollback to the pre-upgrade snapshot
  const rb = rollback('pre-upgrade');
  step('integrity check', false, check.bad.map((b) => `${b.file}: ${b.error.slice(0, 80)}`).join(' | '));
  step('auto-rollback', rb.ok, rb.ok ? 'restored pre-upgrade state' : String(rb.error || ''));
  report.rolledBack = true;
  return report;
}
