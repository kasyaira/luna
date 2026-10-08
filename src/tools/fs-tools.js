// Luna — filesystem tools: read, write, edit, append, list, search, info.
import fs from 'node:fs';
import path from 'node:path';
import { LUNA_ROOT, DEFAULTS } from '../constants.js';
import { truncateMiddle } from '../util/json.js';
import { log } from '../util/log.js';

function resolvePath(p, base = process.cwd()) {
  if (!p) return base;
  if (p === '~') return process.env.HOME;
  if (p.startsWith('~/')) return path.join(process.env.HOME, p.slice(2));
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.resolve(base, p);
}

const IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.cache']);

function walkFiles(dir, { max = 2000, depth = 8, ignore = IGNORE_DIRS } = {}) {
  const out = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= max) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ignore.has(e.name) || depth <= 0) continue;
        out.push(...walkFiles(full, { max: max - out.length, depth: depth - 1, ignore }));
      } else {
        out.push(full);
      }
    }
  } catch { /* unreadable dir — skip */ }
  return out;
}

export const fsTools = [
  {
    name: 'fs.read',
    description: 'Read a file. Supports head/tail limits. Use for source code, configs, docs.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (absolute, or relative to cwd, ~/ allowed)' },
        head: { type: 'number', description: 'Only first N lines' },
        tail: { type: 'number', description: 'Only last N lines' },
      },
      required: ['path'],
    },
    async execute({ path: p, head, tail }) {
      const abs = resolvePath(p);
      if (!fs.existsSync(abs)) return { error: `not found: ${abs}` };
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) return { error: `is a directory (use fs.list): ${abs}` };
      let content = fs.readFileSync(abs, 'utf8');
      const bytes = Buffer.byteLength(content);
      if (bytes > DEFAULTS.maxFileRead) content = truncateMiddle(content, DEFAULTS.maxFileRead);
      let lines = content.split('\n');
      if (head) lines = lines.slice(0, head);
      else if (tail) lines = lines.slice(-tail);
      const numbered = lines.map((l, i) => `${i + 1}| ${l}`).join('\n');
      return {
        path: abs,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        lines: lines.length,
        content: numbered,
      };
    },
  },
  {
    name: 'fs.write',
    description: 'Create or overwrite a file (parent dirs auto-created). Truncates existing content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        mkdir: { type: 'boolean', description: 'Create parent directories (default true)' },
      },
      required: ['path', 'content'],
    },
    async execute({ path: p, content, mkdir = true }) {
      const abs = resolvePath(p);
      try {
        if (mkdir) fs.mkdirSync(path.dirname(abs), { recursive: true });
        const existed = fs.existsSync(abs);
        fs.writeFileSync(abs, content ?? '');
        log.info('fs', `wrote ${abs} (${Buffer.byteLength(String(content ?? ''))} bytes)`);
        return { ok: true, path: abs, bytes: Buffer.byteLength(String(content ?? '')), existed };
      } catch (err) {
        return { error: err.message };
      }
    },
  },
  {
    name: 'fs.append',
    description: 'Append text to the end of a file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    async execute({ path: p, content }) {
      const abs = resolvePath(p);
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.appendFileSync(abs, content ?? '');
        return { ok: true, path: abs };
      } catch (err) { return { error: err.message }; }
    },
  },
  {
    name: 'fs.edit',
    description: 'Precise in-place edit: replace exact old text with new text. old must match exactly once (or set all=true).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old: { type: 'string', description: 'Exact existing text to replace' },
        new: { type: 'string', description: 'Replacement text' },
        all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match' },
      },
      required: ['path', 'old', 'new'],
    },
    async execute({ path: p, old, new: replacement, all }) {
      const abs = resolvePath(p);
      if (!fs.existsSync(abs)) return { error: `not found: ${abs}` };
      const original = fs.readFileSync(abs, 'utf8');
      const occurrences = original.split(old).length - 1;
      if (occurrences === 0) return { error: 'old text not found — no changes made. Read the file and retry with the exact text.' };
      if (occurrences > 1 && !all) {
        return { error: `old text found ${occurrences} times — provide more context to make it unique, or set all=true` };
      }
      const updated = all ? original.split(old).join(replacement) : original.replace(old, replacement);
      fs.writeFileSync(abs, updated);
      return { ok: true, path: abs, replacements: all ? occurrences : 1 };
    },
  },
  {
    name: 'fs.list',
    description: 'List files/dirs under a path (recursive optional). Good for exploring a project.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
        max: { type: 'number', description: 'Max entries (default 500)' },
      },
      required: [],
    },
    async execute({ path: p = '.', recursive = false, max = 500 }) {
      const abs = resolvePath(p);
      if (!fs.existsSync(abs)) return { error: `not found: ${abs}` };
      if (!recursive) {
        const entries = fs.readdirSync(abs, { withFileTypes: true })
          .slice(0, max)
          .map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}${e.isDirectory() ? '/' : ''}`);
        return { path: abs, entries };
      }
      const files = walkFiles(abs, { max }).map((f) => path.relative(abs, f));
      return { path: abs, count: files.length, entries: files };
    },
  },
  {
    name: 'fs.search',
    description: 'Grep-like regex search across files in a directory. Returns file:line: match, max 80 hits.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regex, e.g. "function\\\\s+login"' },
        path: { type: 'string', description: 'Directory or file to search (default cwd)' },
        glob: { type: 'string', description: 'Simple extension filter, e.g. ".js" or ".md"' },
        max: { type: 'number' },
      },
      required: ['pattern'],
    },
    async execute({ pattern, path: p = '.', glob = '', max = 80 }) {
      const abs = resolvePath(p);
      let regex;
      try { regex = new RegExp(pattern, 'i'); } catch (err) { return { error: `bad regex: ${err.message}` }; }
      const targets = fs.existsSync(abs)
        ? (fs.statSync(abs).isDirectory() ? walkFiles(abs, { max: 4000 }) : [abs])
        : [];
      const hits = [];
      for (const file of targets) {
        if (glob && !file.endsWith(glob)) continue;
        if (file.startsWith(path.join(LUNA_ROOT, 'node_modules'))) continue;
        let content;
        try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (/\u0000/.test(content.slice(0, 100))) continue; // binary
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && hits.length < max; i++) {
          if (regex.test(lines[i])) hits.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
        if (hits.length >= max) break;
      }
      return { pattern, searched: targets.length, hits: hits.length, matches: hits };
    },
  },
  {
    name: 'fs.info',
    description: 'Stat info for a path: size, type, times, permissions.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute({ path: p }) {
      const abs = resolvePath(p);
      try {
        const st = fs.statSync(abs);
        return {
          path: abs,
          type: st.isDirectory() ? 'directory' : 'file',
          size: st.size,
          created: st.birthtime?.toISOString?.(),
          modified: st.mtime.toISOString(),
          mode: (st.mode & 0o777).toString(8),
        };
      } catch (err) { return { error: err.message }; }
    },
  },
  {
    name: 'fs.remove',
    description: 'Delete a file or directory (moves nothing to trash — permanent). Use with care.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean', description: 'Required (and sufficient) to delete directories' },
      },
      required: ['path'],
    },
    async execute({ path: p, recursive }) {
      const abs = resolvePath(p);
      // self-preservation: never delete Luna's own brain or system paths
      const protectedPrefixes = ['/etc', '/usr', '/boot', '/sys', '/proc', '/dev', path.join(process.env.HOME || '/', '.luna')];
      if (protectedPrefixes.some((pre) => abs === pre || abs.startsWith(pre + path.sep))) {
        return { error: 'refusing to delete protected path' };
      }
      try {
        const st = fs.statSync(abs);
        if (st.isDirectory() && !recursive) return { error: 'is a directory — set recursive=true to remove' };
        fs.rmSync(abs, { recursive: !!recursive });
        return { ok: true, removed: abs };
      } catch (err) { return { error: err.message }; }
    },
  },
];

export { resolvePath, walkFiles };
