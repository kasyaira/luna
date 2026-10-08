// Luna — LAST-RESORT self-repair. Zero internal imports (node builtins only),
// so it stays loadable even when the rest of Luna's source is broken.
// Walks bin/ + src/, syntax-checks every JS/JSON file with `node --check`,
// and restores broken files from the newest matching snapshot in ~/.luna/backups.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

function lunaRoot() {
  // src/healing/lastresort.js → up two levels
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

function backupRoot() {
  return process.env.LUNA_HOME
    ? path.join(path.resolve(process.env.LUNA_HOME), 'backups')
    : path.join(os.homedir(), '.luna', 'backups');
}

function collectFiles(dirs) {
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|json)$/.test(e.name) && !e.name.includes('.luna-new')) files.push(full);
    }
  };
  for (const d of dirs) {
    if (fs.existsSync(d)) walk(d);
  }
  return files;
}

async function checkOk(file) {
  try {
    if (file.endsWith('.json')) {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      return true;
    }
    const { stderr } = await execFileP(process.execPath, ['--check', file], { timeout: 10_000 });
    return !stderr || !stderr.trim();
  } catch { return false; }
}

function findBackupFor(relPath) {
  const root = backupRoot();
  let snaps = [];
  try { snaps = fs.readdirSync(root).sort().reverse(); } catch { return null; }
  for (const snap of snaps) {
    const candidate = path.join(root, snap, relPath);
    if (fs.existsSync(candidate)) return { snap, file: candidate };
  }
  return null;
}

/** Scan & repair. Returns { broken, repaired, stillBroken }. */
export async function walkAndFix() {
  const root = lunaRoot();
  const files = collectFiles([path.join(root, 'bin'), path.join(root, 'src')]);
  const broken = [];
  for (const f of files) {
    if (!(await checkOk(f))) broken.push(f);
  }
  const repaired = [];
  const stillBroken = [];
  for (const f of broken) {
    const rel = path.relative(root, f);
    const bk = findBackupFor(rel);
    if (bk) {
      try {
        fs.copyFileSync(bk.file, f);
        if (await checkOk(f)) { repaired.push({ file: rel, from: bk.snap }); continue; }
      } catch { /* fall through */ }
    }
    stillBroken.push(rel);
  }
  return { broken: broken.map((f) => path.relative(root, f)), repaired, stillBroken };
}

// CLI direct invocation: node src/healing/lastresort.js
if (process.argv[1] && process.argv[1].endsWith('lastresort.js')) {
  walkAndFix().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.stillBroken.length ? 1 : 0);
  });
}
