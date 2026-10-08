// Luna — boot sequence with self-integrity guard & auto-recovery.
import { loadConfig } from './config.js';
import { ensureDirs } from './constants.js';
import { installSupervisor, selfCheck } from './healing/supervisor.js';
import { autoRepair } from './healing/recovery.js';
import { LunaAgent } from './agent/index.js';
import { log } from './util/log.js';

/**
 * Boot: dirs → config → integrity guard → (auto-repair if broken) → agent.
 * @param {object} overrides CLI flag overrides
 */
export async function boot(overrides = {}) {
  ensureDirs();
  const cfg = loadConfig(overrides);
  log.info('boot', `luna starting · provider=${cfg.provider} model=${cfg.model} home=${cfg.configDir}`);

  // integrity guard: validate own source, auto-restore from snapshots if broken
  const integrity = await selfCheck({ repair: true });
  if (!integrity.healthy) {
    const stillBroken = integrity.broken;
    if (stillBroken.length) {
      log.error('boot', `boot with ${stillBroken.length} broken file(s) — supervisor armed for runtime recovery`);
      console.error(`[luna] warning: ${stillBroken.length} file(s) failed syntax check:`);
      for (const b of stillBroken) console.error(`  ✗ ${b.file}: ${b.error.slice(0, 90)}`);
      console.error(`[luna] run: luna doctor   (auto-repair from snapshots: luna self rollback)`);
    } else {
      console.error('[luna] recovered: broken source files were restored from backups');
    }
  }

  const agent = new LunaAgent(cfg);
  installSupervisor({ memory: agent.memory });
  await agent.boot();
  return { agent, cfg };
}

export { autoRepair };
