// Luna — the agent herself: ties memory, skills, tools, providers, loop.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { MemoryManager } from '../memory/index.js';
import { ToolRegistry } from '../tools/index.js';
import { AgentLoop } from './loop.js';
import { buildSystemContext, buildCompactContext, assembleMessages } from './context.js';
import { loadSkills, matchSkills, loadSkillTools } from '../skills/index.js';
import { detectLocal, chat } from '../providers/router.js';
import { log } from '../util/log.js';
import { errMessage } from '../util/async.js';
import { IDENTITY, LUNA_ROOT } from '../constants.js';

export class LunaAgent {
  constructor(cfg) {
    this.cfg = cfg;
    this.memory = new MemoryManager(cfg);
    this.history = [];
    this.sessionStart = Date.now();
    this.turn = 0;
    this.activeSkill = null;
    this.skillToolDefs = [];
    this.jsonProtocol = !!cfg.forceJsonProtocol;

    this.registry = new ToolRegistry({
      memory: this.memory,
      cfg,
      onSkillActivated: (skill, tools) => this.activateSkill(skill, tools),
      reloadHook: () => this.reload(),
      restartHook: () => this.requestRestart(),
      upgradeHook: (opts) => this.upgrade(opts),
    });
    this.loop = new AgentLoop({ cfg, toolRegistry: this.registry, ui: null });
  }

  attachUi(ui) {
    this.loop.ui = ui;
    this.ui = ui;
  }

  async boot() {
    await detectLocal(this.cfg).catch(() => {});
    await this.memory.consolidate({ force: false }).catch(() => {});
    const skills = loadSkills();
    log.info('agent', `boot: ${skills.length} skills, provider=${this.cfg.provider}, model=${this.cfg.model}`);
    return this;
  }

  activateSkill(skill, tools = []) {
    this.activeSkill = skill;
    this.registry.addDynamicTools(tools);
    this.skillToolDefs = tools;
    log.info('agent', `skill activated: ${skill.name} (+${tools.length} tools)`);
  }

  clearSkill() {
    this.activeSkill = null;
  }

  /** One conversational turn with full agentic loop. */
  async speak(userInput, { autonomous = false, maxIterations } = {}) {
    this.turn++;
    const t0 = Date.now();

    // 1. auto-suggest skills by trigger match
    let skillNote = '';
    const matches = matchSkills(userInput, loadSkills());
    if (matches.length && matches[0].score >= 2) {
      const s = matches[0].skill;
      if (this.activeSkill?.name !== s.name) {
        const tools = await loadSkillTools(s);
        this.activateSkill(s, tools);
        skillNote = `(skill "${s.name}" auto-activated)`;
        this.ui?.onNotice?.(`skill auto-activated: ${s.name}`);
      }
    } else if (this.activeSkill && !this.registry.has('skills.run')) {
      // keep active skill for this session turn
    }

    // 2. parallel memory recall (async, all banks in parallel)
    let memoriesText = '';
    try {
      const { text } = await this.memory.recallFormatted(userInput);
      memoriesText = text;
    } catch (err) { log.warn('agent', `recall failed: ${errMessage(err)}`); }

    // 3. build context (full + compact for tight-budget fallback)
    const system = buildSystemContext({
      cfg: this.cfg,
      memoriesText,
      activeSkill: this.activeSkill,
      toolNames: this.registry.names(),
      jsonProtocol: this.jsonProtocol,
      cwd: process.cwd(),
      sessionTurn: this.turn,
    });
    const compactSystem = buildCompactContext({
      memoriesText,
      toolNames: this.registry.names(),
      cwd: process.cwd(),
      sessionTurn: this.turn,
    });
    const messages = assembleMessages({ system, history: this.history, user: userInput });

    // 4. run the loop
    this.history.push({ role: 'user', content: userInput });
    let result;
    try {
      result = await this.loop.run({
        messages,
        maxIterations: maxIterations ?? (autonomous ? (this.cfg.maxIterations || 24) : Math.min(12, this.cfg.maxIterations || 12)),
        jsonProtocol: this.jsonProtocol,
        compactSystem,
      });
    } catch (err) {
      const msg = errMessage(err);
      await this.memory.logError(`turn ${this.turn}: ${userInput.slice(0, 120)}`, msg, null).catch(() => {});
      result = {
        answer: `⚠ ${msg}\n\n(provider failover exhausted? try: luna health — or set a key, see luna providers)`,
        toolsUsed: [], iterations: 0, provider: '-', model: '-', error: msg,
      };
    }

    // 5. persist to history + episodic memory
    this.history.push({ role: 'assistant', content: result.answer });
    if (this.history.length > (this.cfg.historySize || 400)) {
      this.history = this.history.slice(-(this.cfg.historySize || 400));
    }
    this.memory.logTurn({ user: userInput, assistant: result.answer, toolsUsed: result.toolsUsed }).catch(() => {});
    this.memory.consolidate({ force: false }).catch(() => {});

    result.ms = Date.now() - t0;
    result.turn = this.turn;
    if (skillNote) result.skillNote = skillNote;

    // self.upgrade / self.restart may have requested a relaunch — do it after the reply
    if (this.pendingRestart) {
      const note = this._maybeRestart();
      if (note) result.restart = note;
    }
    return result;
  }

  /** One-shot: no history retention, autonomous iteration budget. */
  async runOnce(task, { maxIterations } = {}) {
    const savedHistory = this.history;
    this.history = [];
    try {
      return await this.speak(task, { autonomous: true, maxIterations });
    } finally {
      this.history = savedHistory;
    }
  }

  resetSession() {
    this.history = [];
    this.activeSkill = null;
    this.sessionStart = Date.now();
    this.turn = 0;
  }

  /** Hot self-reload: fresh-import every module and rebuild the agent. */
  async reload() {
    const notes = [];
    for (const mod of ['agent/index.js', 'agent/loop.js', 'agent/context.js', 'tools/index.js',
      'providers/router.js', 'providers/openai-compat.js', 'providers/vision.js',
      'tools/vision.js', 'tools/screen.js', 'tools/input.js',
      'memory/index.js', 'skills/index.js']) {
      try {
        await import(`../${mod}?t=${Date.now()}`);
        notes.push(`ok ${mod}`);
      } catch (err) {
        notes.push(`FAIL ${mod}: ${errMessage(err).slice(0, 80)}`);
      }
    }
    return {
      ok: true,
      note: 'modules re-imported with cache-busting; run self.restart for a guaranteed clean relaunch. Memory persisted.',
      modules: notes,
      identity: `${IDENTITY.name} v${IDENTITY.version}`,
    };
  }

  /** Schedule a relaunch (spawn new process, keep terminal). Returns tool result. */
  requestRestart() {
    this.pendingRestart = true;
    return {
      ok: true,
      note: 'relaunching with fresh code right after this reply — the terminal stays, memories & config persist in ~/.luna',
    };
  }

  /** Real self-upgrade: apply newest code, schedule restart. Returns tool result. */
  async upgrade(opts = {}) {
    const { applyUpgrade } = await import('../healing/upgrade.js');
    let report;
    try {
      report = await applyUpgrade(opts);
    } catch (err) {
      return { ok: false, error: `upgrade crashed: ${errMessage(err)}` };
    }
    if (report.ok) {
      this.pendingRestart = true;
      report.restart = 'scheduled — relaunching after this reply';
    }
    return report;
  }

  /** Spawn a fresh Luna on the same TTY, then exit. Returns a user-facing note. */
  _maybeRestart() {
    this.pendingRestart = false;
    const entry = path.join(LUNA_ROOT, 'bin', 'luna.js');
    try {
      const child = spawn(process.execPath, [entry], {
        stdio: 'inherit',
        detached: true,
        cwd: LUNA_ROOT,
        env: { ...process.env },
      });
      child.unref();
      log.info('agent', `restart: spawned fresh instance (pid ${child.pid})`);
      setTimeout(() => process.exit(0), 300);
      return '✦ relaunching with fresh code…';
    } catch (err) {
      log.warn('agent', `restart failed: ${errMessage(err)}`);
      return null;
    }
  }

  sessionInfo() {
    return {
      turns: this.turn,
      started: new Date(this.sessionStart).toISOString(),
      history: this.history.length,
      activeSkill: this.activeSkill?.name || null,
      tools: this.registry.names().length,
    };
  }
}

/** Quick provider connectivity test (no tools). */
export async function ping(cfg) {
  const res = await chat(cfg, {
    messages: [{ role: 'user', content: 'Reply with exactly: LUNA_OK' }],
    temperature: 0,
  });
  return { provider: res.provider, model: res.model, content: res.content.slice(0, 60) };
}
