// Luna — interactive REPL: streaming answers, reasoning dim-mode,
// slash commands, persistent input history, graceful exit.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { ansi, gradient } from '../util/ansi.js';
import { banner, bootLine, helpSlash, goodbye } from './banner.js';
import { Spinner } from './spinner.js';
import { DIRS, IDENTITY } from '../constants.js';
import { health, allProviders, routerState } from '../providers/router.js';
import { selfCheck } from '../healing/supervisor.js';
import { listSnapshots, snapshot, rollback } from '../healing/recovery.js';
import { loadSkills } from '../skills/index.js';
import { log } from '../util/log.js';
import { saveConfig, loadConfig } from '../config.js';
import { execCommand } from '../tools/shell-tools.js';

const HISTORY_FILE = path.join(DIRS.home, 'history');

export async function startRepl(agent, cfg) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ansi.brightMagenta('luna')} ${ansi.dim('›')} `,
    historySize: 500,
    completer: (line) => {
      const cmds = ['/help', '/exit', '/memory', '/save', '/recall', '/forget', '/skills',
        '/skill', '/self', '/providers', '/provider', '/model', '/health', '/doctor',
        '/git', '/log', '/stats', '/config', '/clear'];
      const hits = cmds.filter((c) => c.startsWith(line.trim()));
      return [hits.length ? hits : [], line];
    },
  });
  if (fs.existsSync(HISTORY_FILE)) {
    try { rl.history = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-400).reverse(); } catch {}
  }

  const spinner = new Spinner();
  let inFlight = false;
  let ctrlC = 0;
  let streaming = false;
  let reasoningMode = process.env.LUNA_SHOW_REASONING === '1';

  process.on('SIGINT', () => {
    if (!inFlight) {
      ctrlC++;
      if (ctrlC >= 2) { finish(); return; }
      process.stdout.write(`\n${ansi.dim('(ctrl+c again to exit)')}\n`);
      rl.prompt();
      setTimeout(() => { ctrlC = 0; }, 2000);
    }
  });

  console.log(banner());
  console.log(bootLine());
  const prov = routerState();
  if (prov.localDetected.length) {
    console.log(ansi.dim(`  local runtime detected: ${prov.localDetected.join(', ')}`));
  }
  console.log(ansi.dim('  /help for commands · just talk to me otherwise\n'));

  rl.prompt();

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();
    if (!line) { rl.prompt(); return; }
    appendHistory(line);

    if (line.startsWith('/')) {
      await handleCommand(line, agent, cfg, { rl, spinner });
      rl.prompt();
      return;
    }

    if (inFlight) { process.stdout.write(ansi.dim('(wait — still working)\n')); rl.prompt(); return; }
    inFlight = true;
    const prefix = process.stdout.isTTY ? '    ' : '';
    spinner.start('thinking…');
    let lastSpin = Date.now();

    const ui = {
      stream: true,
      onReasoning: (t) => {
        if (!reasoningMode) return;
        if (!streaming) { spinner.stop(); streaming = true; }
        process.stdout.write(ansi.dim(ansi.italic(t)));
      },
      onContent: (t) => {
        if (!streaming) { spinner.stop(); streaming = true; process.stdout.write(prefix); }
        process.stdout.write(t);
      },
      onNotice: (msg) => {
        const idle = Date.now() - lastSpin;
        if (streaming) { process.stdout.write('\n'); streaming = false; }
        spinner.start(`${ansi.cyan('⚙')} ${msg}`);
        lastSpin = Date.now();
      },
      onToolStart: () => {},
      onToolEnd: (name, result) => {
        const err = result && typeof result === 'object' && result.error;
        const icon = err ? ansi.brightRed('✗') : ansi.brightGreen('✓');
        if (streaming) { process.stdout.write('\n'); streaming = false; }
        spinner.update(`${icon} ${name}`);
      },
      onTurnEnd: () => { spinner.start('thinking…'); },
    };
    agent.attachUi(ui);

    try {
      const result = await agent.speak(line);
      spinner.stop();
      if (streaming) { process.stdout.write('\n'); streaming = false; }
      else {
        // no streaming support → print the whole answer
        console.log(prefix + result.answer);
      }
      const meta = ansi.dim(`  ⌁ ${result.provider} · ${result.model} · ${result.iterations} step${result.iterations > 1 ? 's' : ''}${result.toolsUsed.length ? ' · tools: ' + [...new Set(result.toolsUsed)].join(',') : ''} · ${(result.ms / 1000).toFixed(1)}s`);
      console.log(meta + '\n');
    } catch (err) {
      spinner.stop();
      if (streaming) { process.stdout.write('\n'); streaming = false; }
      console.error(ansi.brightRed(`✗ ${err.message || err}`));
    } finally {
      inFlight = false;
      agent.attachUi(nullUi());
      rl.prompt();
    }
  }).on('close', () => finish());

  function finish() {
    try {
      if (fs.existsSync(HISTORY_FILE)) fs.appendFileSync(HISTORY_FILE, '\n');
    } catch {}
    console.log('\n' + goodbye());
    process.exit(0);
  }

  return rl;
}

function appendHistory(line) {
  try { fs.appendFileSync(HISTORY_FILE, line.replace(/\n/g, ' ') + '\n'); } catch {}
}

function nullUi() { return { stream: false }; }

async function handleCommand(line, agent, cfg, { rl, spinner }) {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case '/help':
      console.log(helpSlash());
      break;

    case '/exit':
    case '/quit':
      process.stdout.write(goodbye());
      process.exit(0);
      break;

    case '/memory': {
      if (rest[0] === 'search') {
        const hits = await agent.memory.recall(rest.slice(1).join(' '));
        printRecalls(hits);
      } else {
        console.log(box(JSON.stringify(agent.memory.stats(), null, 2)));
      }
      break;
    }

    case '/save': {
      // /save semantic | likes dark mode
      const [bank, ...text] = arg.split('|').map((s) => s.trim());
      const res = await agent.memory.save(bank || 'semantic', text.join('|').trim() || bank, { tags: ['manual'] });
      console.log(box(JSON.stringify(res)));
      break;
    }

    case '/recall': {
      const hits = await agent.memory.recall(arg);
      printRecalls(hits);
      break;
    }

    case '/forget': {
      const res = await agent.memory.forget(arg);
      console.log(box(JSON.stringify(res)));
      break;
    }

    case '/skills':
    case '/skill': {
      if (rest[0] === 'run' && rest[1]) {
        const skills = loadSkills();
        const s = skills.find((x) => x.name === rest[1]);
        if (s) {
          const { loadSkillTools } = await import('../skills/index.js');
          const tools = await loadSkillTools(s);
          agent.activateSkill(s, tools);
          console.log(ansi.cyan(`skill "${s.name}" active for next messages (+${tools.length} tools)`));
        } else console.log(ansi.yellow(`skill "${rest[1]}" not found`));
      } else if (rest[0]) {
        const skills = loadSkills();
        const s = skills.find((x) => x.name === rest[0]);
        if (s) console.log(box(s.body.slice(0, 1500)));
        else console.log(ansi.yellow(`skill "${rest[0]}" not found`));
      } else {
        const skills = loadSkills();
        console.log(box(skills.map((s) => `${ansi.brightCyan(s.name)} ${ansi.dim('v' + s.version + (s.hasTools ? ' ⚙' : '') + ' [' + s.source + ']')}\n    ${(s.description || '').slice(0, 100)}`).join('\n')));
      }
      break;
    }

    case '/self': {
      const sub = rest[0] || 'info';
      if (sub === 'check') {
        spinner.start('checking own source…');
        const rep = await selfCheck({ repair: false });
        spinner.stop();
        console.log(box(JSON.stringify(rep, null, 1).slice(0, 2000)));
      } else if (sub === 'snapshot') {
        console.log(box(JSON.stringify(snapshot(rest[1] || 'manual'), null, 1)));
      } else if (sub === 'rollback') {
        console.log(box(JSON.stringify(rollback(rest[1]), null, 1)));
      } else if (sub === 'backups') {
        console.log(box(listSnapshots(30).join('\n') || '(none)'));
      } else {
        console.log(box(JSON.stringify(agent.selfInfo?.() ?? {
          ...IDENTITY, session: agent.sessionInfo(), tools: agent.registry.names().length,
        }, null, 1)));
      }
      break;
    }

    case '/providers': {
      const lines = allProviders().map((p) => {
        const key = p.envKey ? (process.env[p.envKey] ? ansi.brightGreen('✓ key') : ansi.dim('· no key')) : ansi.dim('keyless');
        const cur = cfg.provider === p.id ? ansi.brightMagenta(' ← current') : '';
        return `${ansi.brightCyan(p.id.padEnd(12))} ${ansi.dim(p.label.slice(0, 44).padEnd(44))} ${key}${cur}`;
      });
      console.log(box(lines.join('\n')));
      console.log(ansi.dim('  switch: /provider <id>   ·   model: /model <name>   ·   probe: /health\n'));
      break;
    }

    case '/provider': {
      if (!arg) { console.log(ansi.yellow('usage: /provider <id> (see /providers)')); break; }
      saveConfig({ provider: arg });
      cfg.provider = arg;
      agent.cfg = cfg;
      console.log(ansi.cyan(`provider → ${arg} (saved)`));
      break;
    }

    case '/model': {
      if (!arg) { console.log(ansi.yellow('usage: /model <model-id>')); break; }
      saveConfig({ model: arg, providerId: cfg.provider });
      cfg.model = arg;
      console.log(ansi.cyan(`model → ${arg} (saved)`));
      break;
    }

    case '/health': {
      spinner.start('probing endpoints in parallel…');
      const results = await health(cfg);
      spinner.stop();
      console.log(box(results.map((r) => {
        const icon = r.ok ? ansi.brightGreen('✓') : ansi.brightRed('✗');
        return `${icon} ${r.id.padEnd(12)} ${ansi.dim(String(r.status).slice(0, 40))} ${ansi.dim(r.defaultModel || '')}`;
      }).join('\n')));
      break;
    }

    case '/doctor': {
      spinner.start('full diagnostic…');
      const [integrity, providers] = await Promise.all([selfCheck({}), health(cfg)]);
      spinner.stop();
      console.log(box([
        gradient('SELF INTEGRITY'),
        `  files: ${integrity.files} · healthy: ${integrity.healthy}`,
        ...integrity.broken.map((b) => ansi.brightRed(`  ✗ ${b.file}: ${b.error.slice(0, 80)}`)),
        '',
        gradient('PROVIDERS'),
        ...providers.map((r) => `  ${r.ok ? ansi.brightGreen('✓') : ansi.brightRed('✗')} ${r.id} ${ansi.dim(String(r.status).slice(0, 30))}`),
        '',
        gradient('MEMORY'),
        `  ${JSON.stringify(agent.memory.stats().banks)}`,
        '',
        gradient('ROUTER'),
        `  ${JSON.stringify(routerState())}`,
      ].join('\n')));
      break;
    }

    case '/git': {
      const r = await execCommand('git status --short --branch 2>/dev/null || echo "not a git repo"', { timeoutMs: 15_000 });
      console.log(box(r.stdout.trim() || r.stderr.trim()));
      break;
    }

    case '/log':
      console.log(box(log.tail(Number(rest[0]) || 25).join('\n') || '(empty)'));
      break;

    case '/stats': {
      const si = agent.sessionInfo();
      console.log(box([
        `turns:      ${si.turns}`,
        `history:    ${si.history} messages`,
        `skill:      ${si.activeSkill || '—'}`,
        `tools:      ${si.tools}`,
        `started:    ${si.started}`,
        `router:     ${JSON.stringify(routerState())}`,
      ].join('\n')));
      break;
    }

    case '/config': {
      const c = loadConfig();
      console.log(box(JSON.stringify({ ...c, apiKeys: Object.fromEntries(Object.entries(c.apiKeys || {}).map(([k]) => [k, '***'])) }, null, 1)));
      break;
    }

    case '/clear':
      agent.resetSession();
      process.stdout.write('\x1b[2J\x1b[H');
      console.log(banner());
      console.log(ansi.dim('  session context cleared · memories intact\n'));
      break;

    case '/reasoning':
      reasoningMode = !reasoningMode;
      console.log(ansi.dim(`reasoning display: ${reasoningMode ? 'on' : 'off'}`));
      break;

    default:
      console.log(ansi.yellow(`unknown command ${cmd} — /help`));
  }
}

function printRecalls(hits) {
  if (!hits.length) { console.log(ansi.dim('(no memories matched)')); return; }
  console.log(box(hits.map((h) => {
    const when = new Date(h.record.ts || 0).toISOString().slice(0, 16).replace('T', ' ');
    return `${ansi.brightMagenta('[' + h.bank + ']')} ${ansi.dim(when)} ${(h.record.content || '').replace(/\s+/g, ' ').slice(0, 140)}\n${ansi.dim('    tags: ' + (h.record.tags || []).join(',') + ' · score ' + h.score.toFixed(2))}`;
  }).join('\n')));
}

function box(text) {
  const lines = String(text).split('\n');
  const width = Math.min(100, Math.max(...lines.map((l) => stripLen(l))) + 2);
  const top = ansi.dim('╭' + '─'.repeat(width) + '╮');
  const bot = ansi.dim('╰' + '─'.repeat(width) + '╯');
  const body = lines.map((l) => ansi.dim('│') + ' ' + l + ' '.repeat(Math.max(0, width - stripLen(l) - 1)) + ansi.dim('│'));
  return [top, ...body, bot].join('\n');
}

function stripLen(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').length; }
