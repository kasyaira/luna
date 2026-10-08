// Luna — healing tools: the agent can diagnose and repair herself.
import { selfCheck } from '../healing/supervisor.js';
import { health, routerState } from '../providers/router.js';
import { listSnapshots, rollback } from '../healing/recovery.js';
import { log } from '../util/log.js';

export function makeHealTools(memory) {
  return [
    {
      name: 'heal.report',
      description: 'Full self-diagnostic: source integrity, provider health, router stats, memory stats, recent errors.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const [integrity, providers, stats, tail] = await Promise.all([
          selfCheck({ repair: false }),
          health(memory.cfg),
          memory.stats(),
          Promise.resolve(log.tail(15)),
        ]);
        return {
          integrity,
          providers,
          router: routerState(),
          memory: stats,
          recentErrors: tail.filter((l) => l.includes('ERROR') || l.includes('WARN')).slice(-8),
        };
      },
    },
    {
      name: 'heal.fix',
      description: 'Auto-repair: restore Luna\'s broken source files from backups (syntax errors found by self.check).',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const report = await selfCheck({ repair: true });
        return {
          broken: report.broken,
          repairs: report.repaired,
          healthy: report.healthy,
          note: report.repaired?.length ? 'files restored from snapshots — restart luna to run repaired code' : 'nothing to repair',
        };
      },
    },
    {
      name: 'heal.rollback',
      description: 'Emergency rollback of Luna\'s entire source to the latest (or named) snapshot.',
      parameters: { type: 'object', properties: { label: { type: 'string' } }, required: [] },
      execute: async ({ label } = {}) => rollback(label),
    },
    {
      name: 'heal.snapshots',
      description: 'List available recovery snapshots.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ snapshots: listSnapshots(50) }),
    },
    {
      name: 'heal.log',
      description: 'Show Luna\'s recent internal log lines (errors, warnings, provider events).',
      parameters: { type: 'object', properties: { lines: { type: 'number' } }, required: [] },
      execute: async ({ lines = 30 } = {}) => ({ lines: log.tail(Math.min(200, lines)) }),
    },
  ];
}
