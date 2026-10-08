// Luna — constants & identity
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root of the Luna installation (the repo/package itself). */
export const LUNA_ROOT = path.resolve(__dirname, '..');

/** Where Luna keeps her brain: memories, skills, backups, logs, config. */
export const LUNA_HOME = process.env.LUNA_HOME
  ? path.resolve(process.env.LUNA_HOME)
  : path.join(os.homedir(), '.luna');

export const DIRS = {
  home: LUNA_HOME,
  memory: path.join(LUNA_HOME, 'memory'),
  skills: path.join(LUNA_HOME, 'skills'),
  backups: path.join(LUNA_HOME, 'backups'),
  logs: path.join(LUNA_HOME, 'logs'),
  sessions: path.join(LUNA_HOME, 'sessions'),
  captures: path.join(LUNA_HOME, 'captures'), // webcam photos & screenshots (Luna's "retina")
};

export const IDENTITY = {
  name: 'Luna',
  fullName: 'Luna — Self-Evolving Embodied AI Terminal Agent',
  version: '1.1.0',
  tagline: 'parallel memory · self-modification · skills · self-healing · eyes & hands',
};

export const DEFAULTS = {
  provider: 'auto',
  model: 'auto',
  maxIterations: 24,
  requestTimeoutMs: 120_000,
  toolTimeoutMs: 180_000,
  historySize: 400,
  recallTopK: 6,
  maxFileRead: 256 * 1024,       // 256 KB
  maxToolOutput: 64 * 1024,      // 64 KB
  maxWebRead: 96 * 1024,
  shellTimeoutMs: 180_000,
  temperature: 0.7,
  consolidateEveryTurns: 6,
  circuitCooldownMs: 90_000,
  circuitThreshold: 3,
  retries: 2,
};

export const MEMORY_BANKS = [
  {
    id: 'working',
    file: 'working.jsonl',
    description: 'Short-term scratchpad for the current session: plans, partial results, state.',
    halfLifeHours: 6,
    defaultImportance: 0.4,
  },
  {
    id: 'episodic',
    file: 'episodic.jsonl',
    description: 'Events: what happened, when, who said what (auto-logged every turn).',
    halfLifeHours: 72,
    defaultImportance: 0.3,
  },
  {
    id: 'semantic',
    file: 'semantic.jsonl',
    description: 'Distilled facts and knowledge about the user, projects, and the world.',
    halfLifeHours: null, // no decay — knowledge is durable
    defaultImportance: 0.7,
  },
  {
    id: 'procedural',
    file: 'procedural.jsonl',
    description: 'How-to knowledge: recipes, workflows, error→fix pairs learned from experience.',
    halfLifeHours: null,
    defaultImportance: 0.6,
  },
  {
    id: 'reflection',
    file: 'reflection.jsonl',
    description: "Luna's own notes to self: observations, strategies, self-improvement ideas.",
    halfLifeHours: 24 * 30,
    defaultImportance: 0.5,
  },
];

export const ANSI_ENABLED = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.argv.includes('--no-color')) return false;
  return process.stdout.isTTY || process.env.FORCE_COLOR;
})();

export function ensureDirs() {
  for (const d of Object.values(DIRS)) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
