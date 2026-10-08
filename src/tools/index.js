// Luna — tool registry: builds the full toolbelt, executes tool calls
// (in parallel when a model issues multiple calls), enforces timeouts,
// and records every result for the transcript.
import fs from 'node:fs';
import { shellTools } from './shell-tools.js';
import { fsTools } from './fs-tools.js';
import { makeMemoryTools } from './memory-tools.js';
import { makeSkillTools } from './skill-tools.js';
import { makeSelfTools } from './self-tools.js';
import { makeVisionTools } from './vision.js';
import { makeScreenTools } from './screen.js';
import { makeInputTools } from './input.js';
import { gitTools } from './git-tools.js';
import { webTools } from './web-tools.js';
import { makeHealTools } from './heal-tools.js';
import { thinkTools } from './think-tool.js';
import { withTimeout, errMessage } from '../util/async.js';
import { log } from '../util/log.js';
import { truncateMiddle } from '../util/json.js';
import { DEFAULTS } from '../constants.js';

export class ToolRegistry {
  constructor({ memory, cfg, onSkillActivated, reloadHook, restartHook, upgradeHook }) {
    this.cfg = cfg;
    this.memory = memory;
    this.tools = new Map();
    this.dynamicTools = new Map(); // from skill tool-packs
    this.onSkillActivated = onSkillActivated;

    const groups = [
      ...thinkTools,
      ...fsTools,
      ...shellTools,
      ...makeVisionTools(),
      ...makeScreenTools(),
      ...makeInputTools(),
      ...makeMemoryTools(memory),
      ...makeSkillTools({ onSkillActivated }),
      ...makeSelfTools({ reloadHook, restartHook, upgradeHook }),
      ...gitTools,
      ...webTools,
      ...makeHealTools(memory),
    ];
    for (const t of groups) this.tools.set(t.name, t);
  }

  addDynamicTools(tools) {
    for (const t of (tools || [])) {
      if (t?.name) this.dynamicTools.set(t.name, t);
    }
  }

  list() {
    return [...this.tools.values(), ...this.dynamicTools.values()];
  }

  openAiSchemas() {
    return this.list().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  names() { return this.list().map((t) => t.name); }

  has(name) { return this.tools.has(name) || this.dynamicTools.has(name); }

  /**
   * Execute one call {name, arguments(json str or object)}.
   * Parallel-safe: multiple calls run with Promise.all at the caller level.
   */
  async execute(call) {
    const name = call?.name || call?.function?.name;
    const rawArgs = call?.arguments ?? call?.function?.arguments ?? '{}';
    const def = this.tools.get(name) || this.dynamicTools.get(name);
    if (!def) {
      return { error: `unknown tool "${name}" — available: ${this.names().join(', ')}`.slice(0, 400) };
    }
    let args = {};
    if (typeof rawArgs === 'string') {
      try { args = JSON.parse(rawArgs || '{}'); }
      catch (err) { return { error: `invalid JSON arguments for ${name}: ${err.message}` }; }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs;
    }

    const started = Date.now();
    try {
      const result = await withTimeout(
        Promise.resolve(def.execute(args, { cfg: this.cfg, memory: this.memory, registry: this })),
        this.cfg.toolTimeoutMs || DEFAULTS.toolTimeoutMs,
        `tool ${name}`
      );
      const out = sanitizeResult(result);
      log.info('tools', `${name} ok in ${Date.now() - started}ms`);
      return out;
    } catch (err) {
      const msg = errMessage(err);
      log.warn('tools', `${name} failed in ${Date.now() - started}ms: ${msg.slice(0, 150)}`);
      // learn failures → procedural memory (self-healing knowledge)
      this.memory?.save('procedural',
        `TOOL FAILURE: ${name}(${JSON.stringify(args).slice(0, 200)}) → ${msg.slice(0, 200)}`,
        { tags: ['error', 'tool'], importance: 0.6 }).catch(() => {});
      return { error: msg.slice(0, 300) };
    }
  }
}

function sanitizeResult(result) {
  if (result == null) return { ok: true };
  let text;
  try { text = JSON.stringify(result, null, 1); }
  catch { text = String(result); }
  if (text.length > DEFAULTS.maxToolOutput) {
    return { ...((typeof result === 'object' && result) || {}), __truncated: true, preview: truncateMiddle(text, DEFAULTS.maxToolOutput) };
  }
  return result;
}

/** Persist the raw tool file cache — alias used by tests. */
export function touchArtifact(p) {
  try { fs.utimesSync(p, new Date(), new Date()); return true; } catch { return false; }
}
