// Luna — configuration: env vars > config file > defaults. Zero-config friendly.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, DEFAULTS, ensureDirs } from './constants.js';

const CONFIG_FILE = path.join(DIRS.home, 'config.json');

const ENV_MAP = {
  LUNA_PROVIDER: 'provider',
  LUNA_MODEL: 'model',
  LUNA_BASE_URL: 'baseUrl',
  LUNA_API_KEY: 'apiKey',
  LUNA_MAX_ITER: 'maxIterations',
  LUNA_TIMEOUT: 'requestTimeoutMs',
  LUNA_TEMPERATURE: 'temperature',
  LUNA_SHELL_TIMEOUT: 'shellTimeoutMs',
  LUNA_RECALL_TOPK: 'recallTopK',
  LUNA_PERSONA: 'persona',
  LUNA_SAFE_MODE: 'safeMode',
};

/** Provider-specific API keys, all optional. */
export const PROVIDER_ENV_KEYS = {
  openrouter: 'LUNA_OPENROUTER_KEY',
  groq: 'LUNA_GROQ_KEY',
  gemini: 'LUNA_GEMINI_KEY',
  mistral: 'LUNA_MISTRAL_KEY',
  together: 'LUNA_TOGETHER_KEY',
  cerebras: 'LUNA_CEREBRAS_KEY',
  sambanova: 'LUNA_SAMBANOVA_KEY',
  deepseek: 'LUNA_DEEPSEEK_KEY',
  cohere: 'LUNA_COHERE_KEY',
  huggingface: 'LUNA_HF_KEY',
  aimlapi: 'LUNA_AIMLAPI_KEY',
  baseten: 'LUNA_BASETEN_KEY',
  custom: 'LUNA_API_KEY',
};

function loadFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* corrupted config → start fresh, self-heal */ }
  return {};
}

function coerce(key, value) {
  const numKeys = new Set(['maxIterations', 'requestTimeoutMs', 'temperature',
    'shellTimeoutMs', 'recallTopK', 'toolTimeoutMs', 'historySize']);
  const boolKeys = new Set(['safeMode', 'stream', 'allowDestructive']);
  if (numKeys.has(key) && value !== '' && value != null) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  if (boolKeys.has(key)) {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  }
  return value;
}

export function loadConfig(overrides = {}) {
  ensureDirs();
  const file = loadFile();
  const cfg = { ...DEFAULTS, ...file };

  for (const [env, key] of Object.entries(ENV_MAP)) {
    if (process.env[env] !== undefined) cfg[key] = coerce(key, process.env[env]);
  }
  for (const [k, v] of Object.entries(overrides)) cfg[k] = coerce(k, v);

  cfg.apiKeys = { ...collectKeys(), ...cfg.apiKeys };
  cfg.configFile = CONFIG_FILE;
  cfg.configDir = DIRS.home;
  return cfg;
}

function collectKeys() {
  const keys = {};
  for (const [providerId, envName] of Object.entries(PROVIDER_ENV_KEYS)) {
    const v = process.env[envName];
    if (v) keys[providerId] = v;
  }
  return keys;
}

export function saveConfig(partial) {
  const current = loadFile();
  const next = { ...current, ...partial };
  delete next.apiKeys; // keys never persist to disk from env
  fs.mkdirSync(DIRS.home, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function getConfigValue(key) {
  const cfg = loadConfig();
  return key ? cfg[key] : cfg;
}

export function setConfigValue(key, value) {
  const cfg = loadFile();
  cfg[key] = coerce(key, value);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}
