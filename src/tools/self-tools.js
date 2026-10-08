// Luna — self-modification tools. This is what makes Luna self-evolving:
// she can read, patch, validate, snapshot, reload, and roll back her own code.
import fs from 'node:fs';
import path from 'node:path';
import { LUNA_ROOT } from '../constants.js';
import { checkSyntax, checkTree } from '../healing/validator.js';
import { backupFile, snapshot, listSnapshots, rollback, restoreFile } from '../healing/recovery.js';
import { sensorReport } from '../util/sensors.js';
import { visionStatus } from '../providers/vision.js';
import { resolvePath } from './fs-tools.js';
import { truncateMiddle } from '../util/json.js';
import { log } from '../util/log.js';
import { IDENTITY } from '../constants.js';

const SELF_DIR_WHITELIST = ['src', 'bin', 'skills', 'docs'];

function toSelfRelative(p) {
  const abs = resolvePath(p, LUNA_ROOT);
  const rel = path.relative(LUNA_ROOT, abs);
  if (rel.startsWith('..')) return { outside: true, abs, rel };
  return { outside: false, abs, rel };
}

export function makeSelfTools({ reloadHook, restartHook, upgradeHook } = {}) {
  return [
    {
      name: 'self.list',
      description: 'List Luna\'s own source files (the code you are running).',
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string', enum: SELF_DIR_WHITELIST, description: 'Sub-directory (default src)' } },
        required: [],
      },
      execute: async ({ dir = 'src' } = {}) => {
        const target = path.join(LUNA_ROOT, dir);
        const files = [];
        (function walk(d, depth) {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full, depth + 1);
            else files.push(path.relative(LUNA_ROOT, full));
          }
        })(target, 0);
        return { root: LUNA_ROOT, version: IDENTITY.version, files: files.sort() };
      },
    },
    {
      name: 'self.read',
      description: 'Read one of Luna\'s own source files.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async ({ path: p }) => {
        const { abs, outside } = toSelfRelative(p);
        if (outside) return { error: `path outside Luna root: ${p}` };
        if (!fs.existsSync(abs)) return { error: `not found: ${p}` };
        return { path: p, content: truncateMiddle(fs.readFileSync(abs, 'utf8'), 200 * 1024) };
      },
    },
    {
      name: 'self.patch',
      description: 'Modify Luna\'s own source code. Validates syntax first (node --check), backs up the original, writes atomically. On validation failure nothing is written.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to Luna root, e.g. src/ui/banner.js' },
          content: { type: 'string', description: 'Full new file content (for surgical edits use fs.edit after backing up)' },
        },
        required: ['path', 'content'],
      },
      execute: async ({ path: p, content }) => {
        const { abs, rel, outside } = toSelfRelative(p);
        if (outside) return { error: `refusing: path outside Luna root (${p})` };

        // 1. write candidate to temp (keeps real extension so node --check validates it)
        //    and syntax-check BEFORE touching the real file
        const tmp = abs + '.luna-new' + path.extname(abs);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(tmp, content ?? '');
        const check = await checkSyntax(tmp);
        if (!check.ok) {
          fs.rmSync(tmp, { force: true });
          return { ok: false, error: `syntax validation failed — NOTHING written: ${check.error}`, hint: 'fix the syntax and retry' };
        }
        // 2. backup original
        if (fs.existsSync(abs)) {
          const b = backupFile(abs, 'self-patch');
          if (!b.ok) { fs.rmSync(tmp, { force: true }); return { ok: false, error: `backup failed: ${b.error}` }; }
        }
        // 3. atomic replace
        fs.renameSync(tmp, abs);
        log.info('self', `patched ${rel}`);
        return {
          ok: true, path: rel, bytes: Buffer.byteLength(String(content ?? '')),
          note: 'change is on disk. Run self.reload to hot-reload modules without restarting, or restart luna for a clean boot.',
        };
      },
    },
    {
      name: 'self.check',
      description: 'Integrity check of Luna\'s own source tree (syntax-validated, parallel).',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const report = await checkTree(LUNA_ROOT, { ignore: ['node_modules', '.git'] });
        return {
          files: report.files,
          healthy: report.bad.length === 0,
          broken: report.bad.map((b) => ({ file: path.relative(LUNA_ROOT, b.file), error: b.error.slice(0, 200) })),
        };
      },
    },
    {
      name: 'self.snapshot',
      description: 'Snapshot Luna\'s entire source (bin/src/skills) into ~/.luna/backups for rollback safety.',
      parameters: { type: 'object', properties: { label: { type: 'string' } }, required: [] },
      execute: async ({ label = 'agent-snapshot' } = {}) => snapshot(label),
    },
    {
      name: 'self.rollback',
      description: 'Roll Luna\'s source back to a previous snapshot (default: latest). Use after a bad self-modification.',
      parameters: { type: 'object', properties: { label: { type: 'string', description: 'Snapshot label or full name (optional)' } }, required: [] },
      execute: async ({ label } = {}) => rollback(label),
    },
    {
      name: 'self.backups',
      description: 'List available self-snapshots.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ snapshots: listSnapshots(50) }),
    },
    {
      name: 'self.restore',
      description: 'Restore a single one of Luna\'s files from the newest snapshot containing it.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async ({ path: p }) => {
        const { rel } = toSelfRelative(p);
        return restoreFile(rel);
      },
    },
    {
      name: 'self.reload',
      description: 'Hot-reload Luna\'s modules after self-modification (clears the ESM import cache with cache-busting imports). Restarts the in-process agent cleanly.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        if (typeof reloadHook === 'function') {
          return reloadHook();
        }
        return { ok: true, note: 'full hot-reload requires restart: run `luna` again (your memories persist).' };
      },
    },
    {
      name: 'self.restart',
      description: 'Relaunch Luna with fresh code (spawn a new process, keep the terminal). Use after self.patch/self.upgrade so changes take effect immediately — memories and config persist in ~/.luna.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        if (typeof restartHook === 'function') return restartHook();
        return { ok: false, error: 'restart hook not available in this context — run `luna` again instead' };
      },
    },
    {
      name: 'self.upgrade',
      description: 'Upgrade Luna\'s own code from the latest release (GitHub) or a local zip, then relaunch. Auto: git pull when a git checkout, otherwise downloads the GitHub main zip. Snapshot + integrity check + auto-rollback included. THIS is how you gain new abilities.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '"auto" (default) · "git" · "github" (zip from GitHub main) · an https URL to a zip · or a local path to a zip file' },
        },
        required: [],
      },
      execute: async ({ source } = {}) => {
        if (typeof upgradeHook === 'function') return upgradeHook({ source: source || 'auto' });
        return { ok: false, error: 'upgrade hook not available — run: luna upgrade' };
      },
    },
    {
      name: 'self.sensors',
      description: 'Body report: display server, webcams, input backends (mouse/keyboard), screenshot & capture backends, vision model availability, with install hints. Check this when eyes/hands fail, and to answer "what can you do right now?".',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async (_args, { cfg } = {}) => {
        const sensors = sensorReport();
        const vision = await visionStatus(cfg || {}).catch(() => ({ available: false, candidates: [] }));
        return {
          version: IDENTITY.version,
          display: sensors.display,
          eyes: {
            ...sensors.eyes,
            visionModels: vision.candidates,
            keylessVision: vision.keyless,
            localVision: vision.local,
          },
          hands: sensors.hands,
          installHints: sensors.installHints,
        };
      },
    },
    {
      name: 'self.info',
      description: 'Identity & environment info: version, root, node version, platform, config.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({
        name: IDENTITY.name,
        version: IDENTITY.version,
        root: LUNA_ROOT,
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        pid: process.pid,
        cwd: process.cwd(),
        body: 'eyes: vision.*, screen.* · hands: input.* · upgrade: self.upgrade',
      }),
    },
  ];
}
