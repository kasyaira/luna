// Luna — structured logging to ~/.luna/logs/ (zero deps)
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../constants.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = process.env.LUNA_LOG_LEVEL || 'info';

function logFile() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(DIRS.logs, `luna-${stamp}.log`);
}

function write(level, tag, parts) {
  if ((LEVELS[level] ?? 20) < (LEVELS[minLevel] ?? 20)) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${tag}] ` +
    parts.map((p) => (typeof p === 'string' ? p : safe(p))).join(' ') + '\n';
  try {
    fs.mkdirSync(DIRS.logs, { recursive: true });
    fs.appendFileSync(logFile(), line);
  } catch { /* disk issues must never crash the agent */ }
  return line;
}

function safe(obj) {
  try { return JSON.stringify(obj); } catch { return String(obj); }
}

export const log = {
  setLevel(level) { minLevel = level; },
  debug(tag, ...p) { write('debug', tag, p); },
  info(tag, ...p) { write('info', tag, p); },
  warn(tag, ...p) { write('warn', tag, p); },
  error(tag, ...p) { write('error', tag, p); },

  /** Read the tail of today's log (for /log command & doctor). */
  tail(lines = 40) {
    try {
      if (!fs.existsSync(logFile())) return [];
      const raw = fs.readFileSync(logFile(), 'utf8').trimEnd().split('\n');
      return raw.slice(-lines);
    } catch { return []; }
  },

  listFiles() {
    try {
      return fs.readdirSync(DIRS.logs).sort().reverse();
    } catch { return []; }
  },
};
