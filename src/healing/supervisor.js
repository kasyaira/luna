// Luna — supervisor: global error capture, error→memory learning,
// auto-repair of her own broken files, boot-time integrity guard.
import { checkTree } from './validator.js';
import { autoRepair, restoreFile } from './recovery.js';
import { LUNA_ROOT } from '../constants.js';
import { log } from '../util/log.js';
import { errMessage } from '../util/async.js';

let memoryRef = null; // set at install() to avoid circular import
let installed = false;

export function installSupervisor({ memory } = {}) {
  if (installed) return;
  installed = true;
  memoryRef = memory;

  process.on('uncaughtException', async (err) => {
    await handle(err, 'uncaughtException');
  });
  process.on('unhandledRejection', async (reason) => {
    await handle(reason, 'unhandledRejection');
  });
  process.on('warning', (w) => {
    log.warn('supervisor', w.message?.slice(0, 200));
  });
  log.info('supervisor', 'global error handlers installed');
}

async function handle(err, kind) {
  const msg = errMessage(err);
  log.error('supervisor', `${kind}: ${msg}`);

  try {
    // 1. learn the error (procedural memory → future self-healing knowledge)
    if (memoryRef) {
      await memoryRef.logError(kind, msg, null);
    }

    // 2. if it looks like one of Luna's own files broke syntax → auto-restore
    const syntaxMatch = msg.match(/([\w./-]+\.(?:js|mjs|cjs)):\d+/);
    if (syntaxMatch) {
      const rel = syntaxMatch[1];
      const abs = rel.startsWith('/') ? rel : `${LUNA_ROOT}/${rel}`;
      const repair = restoreFile(abs);
      if (repair.ok) {
        log.info('supervisor', `auto-repaired ${rel} from backup`);
        if (memoryRef) {
          await memoryRef.save('procedural',
            `ERROR: ${msg.slice(0, 200)}\nFIX: auto-restored ${rel} from snapshot ${repair.from}; restart luna.`,
            { tags: ['error', 'auto-repair'], importance: 0.8 });
        }
      }
    }

    // 3. keep the process alive when possible
    if (kind === 'unhandledRejection') return; // logged & learned; continue running
    // uncaughtException during REPL: report, try to continue
    console.error(`\n[luna] recovered from ${kind}: ${msg.slice(0, 160)}\n`);
  } catch (meta) {
    // last-resort: never let the handler itself crash
    console.error('[luna] supervisor meta-error:', errMessage(meta));
  }
}

/** Deep integrity check of Luna's own source. Auto-repair optionally. */
export async function selfCheck({ repair = false } = {}) {
  const report = await checkTree(LUNA_ROOT, { ignore: ['node_modules', '.git', 'memory', 'sessions', 'logs', 'backups'] });
  let repairs = [];
  if (repair && report.bad.length) {
    repairs = autoRepair(report);
  }
  return {
    files: report.files,
    broken: report.bad.map((b) => ({ file: b.file, error: b.error.slice(0, 160) })),
    repaired: repairs,
    healthy: report.bad.length === 0,
  };
}
