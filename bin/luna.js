#!/usr/bin/env node
// Luna — CLI entry. Zero dependencies. Node >= 18.
// Commands: (none)|chat · run <task> · ask <q> · doctor · health · providers
//           skill(s) … · memory … · self … · config … · version · help
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELP = `luna — self-evolving AI terminal agent

USAGE
  luna                      interactive chat (REPL, streaming)
  luna "<task>"             one-shot: say something
  luna run "<task>"         autonomous agent mode (higher tool budget)
  luna ask "<question>"     quick answer, no tools
  luna doctor               full self-diagnostic (integrity + providers + memory)
  luna health               probe AI endpoints in parallel
  luna providers            list every supported AI endpoint
  luna skill list|show|run|remove <name>
  luna skill install <url>  install a skill from a URL
  luna memory stats|search|forget <q>
  luna self check|snapshot|rollback|backups
  luna config get|set|list
  luna version | help

FLAGS
  --provider <id>           force provider (pollinations, groq, ollama, …)
  --model <id>              force model
  --max-iters <n>           tool-loop iteration budget (default 24)
  --json                    protocol: JSON tool blocks (for endpoints w/o native tools)
  --no-color                disable ANSI colors
  --unsafe-file <path>      n/a (reserved)

CONFIG (zero-config: works instantly via keyless endpoints)
  ~/.luna/config.json       provider/model/persona settings
  env: LUNA_PROVIDER, LUNA_MODEL, LUNA_BASE_URL, LUNA_API_KEY,
       LUNA_OPENROUTER_KEY, LUNA_GROQ_KEY, LUNA_GEMINI_KEY, LUNA_MISTRAL_KEY,
       LUNA_TOGETHER_KEY, LUNA_CEREBRAS_KEY, LUNA_SAMBANOVA_KEY, LUNA_DEEPSEEK_KEY,
       LUNA_COHERE_KEY, LUNA_HF_KEY, LUNA_AIMLAPI_KEY, LUNA_BASETEN_KEY

MEMORY & SKILLS live in ~/.luna/ (persists across runs; git-ignorable, private).

LEARN MORE  https://github.com/kasyaira/luna
`;

/**
 * Resilient module loader: if an import fails (broken self-modified file),
 * run the zero-dependency last-resort repair (syntax scan + restore from
 * ~/.luna/backups snapshots), then retry the import with cache-busting.
 */
async function safeImport(spec) {
  try {
    return await import(spec);
  } catch (err) {
    try {
      const { walkAndFix } = await import('../src/healing/lastresort.js');
      const report = await walkAndFix();
      if (report.repaired.length) {
        console.error(`[luna] self-recovered ${report.repaired.length} file(s): ${report.repaired.map((r) => r.file).join(', ')}`);
        return await import(`${spec}?healed=${Date.now()}`);
      }
      if (report.stillBroken.length) {
        console.error(`[luna] WARNING — unrecoverable file(s): ${report.stillBroken.join(', ')}
  fix manually, or roll back:  luna self rollback`);
      }
    } catch { /* lastresort itself broken — nothing more we can do here */ }
    throw err;
  }
}

main().catch((err) => {
  console.error(`✗ ${err.stack || err.message || err}`);
  process.exit(1);
});

async function main() {
  const argv = process.argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(a);
  }

  const overrides = {
    ...(flags.provider ? { provider: flags.provider } : {}),
    ...(flags.model ? { model: flags.model } : {}),
    ...(flags['max-iters'] ? { maxIterations: Number(flags['max-iters']) } : {}),
    ...(flags.json ? { forceJsonProtocol: true } : {}),
  };

  const command = positional[0] || 'chat';

  // fast paths that don't need the agent
  if (command === 'help' || flags.help) { console.log(HELP); return; }
  if (command === 'version' || flags.version) {
    const { IDENTITY } = await safeImport('../src/constants.js');
    console.log(`luna ${IDENTITY.version} (node ${process.version})`);
    return;
  }

  const { boot } = await safeImport('../src/boot.js');
  const { ansi } = await safeImport('../src/util/ansi.js');

  // ---------- commands ----------
  if (command === 'providers') {
    const { allProviders } = await safeImport('../src/providers/router.js');
    for (const p of allProviders()) {
      const keyHint = p.envKey ? `${process.env[p.envKey] ? ansi.brightGreen('✓ key set') : ansi.dim('needs key: ' + p.envKey)}` : ansi.brightGreen('keyless');
      console.log(`${ansi.brightMagenta(p.id.padEnd(12))} ${ansi.bold(p.label)}`);
      console.log(' '.repeat(14) + ansi.dim(`${p.baseUrl || '(set LUNA_BASE_URL)'} · default model: ${p.defaultModel || '(any)'}`) + '  ' + keyHint);
      if (p.signup) console.log(`${' '.repeat(14)}${ansi.dim('get key: ' + p.signup)}`);
    }
    return;
  }

  if (command === 'health') {
    const { loadConfig } = await safeImport('../src/config.js');
    const { health } = await safeImport('../src/providers/router.js');
    const cfg = loadConfig(overrides);
    const results = await health(cfg);
    for (const r of results) {
      console.log(`${r.ok ? ansi.brightGreen('✓') : ansi.brightRed('✗')} ${r.id.padEnd(12)} ${String(r.status).slice(0, 44)} ${ansi.dim(r.defaultModel || '')}`);
    }
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
    return;
  }

  if (command === 'doctor') {
    const { selfCheck } = await safeImport('../src/healing/supervisor.js');
    const { loadConfig } = await safeImport('../src/config.js');
    const { health, routerState } = await safeImport('../src/providers/router.js');
    const { MemoryManager } = await safeImport('../src/memory/index.js');
    const cfg = loadConfig(overrides);
    const { integrity, providers, mem, router } = {
      integrity: await selfCheck({ repair: true }),
      providers: await health(cfg),
      mem: new MemoryManager(cfg).stats(),
      router: routerState(),
    };
    console.log(ansi.bold('LUNA DOCTOR'));
    console.log(`integrity : ${integrity.healthy ? ansi.brightGreen('healthy') : ansi.brightRed('broken')} (${integrity.files} files checked${integrity.repaired?.length ? `, ${integrity.repaired.length} auto-repaired` : ''})`);
    for (const b of integrity.broken) console.log(`  ✗ ${b.file}: ${b.error.slice(0, 80)}`);
    console.log(`providers : ${providers.filter((p) => p.ok).length}/${providers.length} reachable`);
    for (const p of providers) console.log(`  ${p.ok ? '✓' : '✗'} ${p.id} ${String(p.status).slice(0, 36)}`);
    console.log(`memory    : ${JSON.stringify(mem.banks)}`);
    console.log(`router    : calls=${router.calls} switches=${router.providerSwitches} failures=${router.failures}${router.openCircuits.length ? ' · circuits: ' + router.openCircuits.join(',') : ''}`);
    return;
  }

  if (command === 'skill' || command === 'skills') {
    const { loadSkills, skillPath } = await safeImport('../src/skills/index.js');
    const sub = positional[1] || 'list';
    if (sub === 'list') {
      const skills = loadSkills();
      if (!skills.length) { console.log('(no skills yet — ask Luna to create one, or luna skill install <url>)'); return; }
      for (const s of skills) {
        console.log(`${ansi.brightCyan(s.name)} ${ansi.dim('v' + s.version + (s.hasTools ? ' ⚙tools' : '') + ' [' + s.source + ']')}`);
        console.log(`  ${ansi.dim((s.description || '').slice(0, 110))}`);
        console.log(`  ${ansi.dim('triggers: ' + s.triggers.slice(0, 6).join(', '))}`);
      }
    } else if (sub === 'show' && positional[2]) {
      const s = loadSkills().find((x) => x.name === positional[2]);
      if (s) console.log(s.body);
      else console.error(`skill "${positional[2]}" not found`);
    } else if (sub === 'remove' && positional[2]) {
      const fs = await import('node:fs');
      const f = skillPath(positional[2]);
      if (fs.existsSync(f)) { fs.rmSync(f); console.log(`removed ${positional[2]}`); }
      else console.error(`user skill "${positional[2]}" not found`);
    } else if (sub === 'install' && positional[2]) {
      const { ToolRegistry } = await safeImport('../src/tools/index.js');
      const { MemoryManager } = await safeImport('../src/memory/index.js');
      const { loadConfig } = await safeImport('../src/config.js');
      const mem = new MemoryManager(loadConfig(overrides));
      const reg = new ToolRegistry({ memory: mem, cfg: loadConfig(overrides) });
      const r = await reg.execute({ name: 'skills.install', arguments: JSON.stringify({ url: positional[2], name: positional[3] }) });
      console.log(JSON.stringify(r, null, 2));
    } else if (sub === 'run' && positional[2]) {
      const { boot: b } = await safeImport('../src/boot.js');
      const { agent } = await b(overrides);
      const skills = loadSkills();
      const s = skills.find((x) => x.name === positional[2]);
      if (!s) { console.error(`skill "${positional[2]}" not found`); return; }
      const { loadSkillTools } = await safeImport('../src/skills/index.js');
      agent.activateSkill(s, await loadSkillTools(s));
      const { startRepl } = await safeImport('../src/ui/repl.js');
      await startRepl(agent, agent.cfg);
    } else {
      console.log('usage: luna skill list | show <n> | run <n> | remove <n> | install <url> [name]');
    }
    return;
  }

  if (command === 'memory') {
    const { loadConfig } = await safeImport('../src/config.js');
    const { MemoryManager } = await safeImport('../src/memory/index.js');
    const mem = new MemoryManager(loadConfig(overrides));
    const sub = positional[1] || 'stats';
    if (sub === 'stats') {
      console.log(JSON.stringify(mem.stats(), null, 2));
    } else if (sub === 'search' || sub === 'recall') {
      const hits = await mem.recall(positional.slice(2).join(' '));
      for (const h of hits) {
        console.log(`${ansi.brightMagenta('[' + h.bank + ']')} ${ansi.dim(new Date(h.record.ts).toISOString().slice(0, 16).replace('T', ' '))} ${(h.record.content || '').replace(/\s+/g, ' ').slice(0, 150)}`);
        console.log(ansi.dim(`    tags: ${(h.record.tags || []).join(',')} · score ${h.score.toFixed(2)}`));
      }
      if (!hits.length) console.log('(no matches)');
    } else if (sub === 'forget') {
      console.log(JSON.stringify(await mem.forget(positional.slice(2).join(' '))));
    } else if (sub === 'consolidate') {
      console.log(JSON.stringify(await mem.consolidate({ force: true }), null, 2));
    } else {
      console.log('usage: luna memory stats | search <q> | forget <q> | consolidate');
    }
    return;
  }

  if (command === 'self') {
    const { loadConfig } = await safeImport('../src/config.js');
    const { selfCheck } = await safeImport('../src/healing/supervisor.js');
    const { snapshot, rollback, listSnapshots } = await safeImport('../src/healing/recovery.js');
    const { IDENTITY, LUNA_ROOT } = await safeImport('../src/constants.js');
    const sub = positional[1] || 'info';
    if (sub === 'info') {
      console.log(JSON.stringify({ name: IDENTITY.name, version: IDENTITY.version, root: LUNA_ROOT, node: process.version }, null, 2));
    } else if (sub === 'check') {
      const rep = await selfCheck({});
      console.log(JSON.stringify(rep, null, 2));
      process.exitCode = rep.healthy ? 0 : 1;
    } else if (sub === 'snapshot') {
      console.log(JSON.stringify(snapshot(positional[2] || 'manual'), null, 2));
    } else if (sub === 'rollback') {
      console.log(JSON.stringify(rollback(positional[2]), null, 2));
    } else if (sub === 'backups') {
      console.log(listSnapshots(50).join('\n') || '(none)');
    } else {
      console.log('usage: luna self info | check | snapshot [label] | rollback [label] | backups');
    }
    return;
  }

  if (command === 'config') {
    const { getConfigValue, setConfigValue, loadConfig } = await safeImport('../src/config.js');
    const sub = positional[1] || 'list';
    if (sub === 'get' && positional[2]) {
      console.log(JSON.stringify(getConfigValue(positional[2])));
    } else if (sub === 'set' && positional[2] && positional[3] !== undefined) {
      setConfigValue(positional[2], positional[3]);
      console.log(`${positional[2]} = ${positional[3]}`);
    } else {
      const c = loadConfig();
      delete c.apiKeys;
      console.log(JSON.stringify(c, null, 2));
    }
    return;
  }

  if (command === 'ping') {
    const { loadConfig } = await safeImport('../src/config.js');
    const { ping } = await safeImport('../src/agent/index.js');
    const cfg = loadConfig(overrides);
    console.log(JSON.stringify(await ping(cfg), null, 2));
    return;
  }

  // ---------- conversational paths ----------
  if (command === 'chat' && positional.length <= 1) {
    const { agent, cfg } = await boot(overrides);
    const { startRepl } = await safeImport('../src/ui/repl.js');
    await startRepl(agent, cfg);
    return;
  }

  if (command === 'run' && positional[1]) {
    const task = positional.slice(1).join(' ');
    const { agent } = await boot(overrides);
    const result = await agent.runOnce(task, { maxIterations: overrides.maxIterations });
    if (flags.quiet) { console.log(result.answer); }
    else {
      console.log(result.answer);
      console.error(ansi.dim(`  ⌁ ${result.provider} · ${result.model} · ${result.iterations} steps · tools: ${[...new Set(result.toolsUsed)].join(',') || '—'} · ${(result.ms / 1000).toFixed(1)}s`));
    }
    return;
  }

  if (command === 'ask' && positional[1]) {
    const q = positional.slice(1).join(' ');
    const { agent } = await boot({ ...overrides, maxIterations: 2 });
    const result = await agent.runOnce(q, { maxIterations: 2 });
    console.log(result.answer);
    return;
  }

  // one-shot: first positional is the message itself
  if (command !== 'chat' && positional.length >= 1 && !['run', 'ask'].includes(command)) {
    const { agent } = await boot(overrides);
    const result = await agent.speak(positional.join(' '));
    console.log(result.answer);
    console.error(ansi.dim(`  ⌁ ${result.provider} · ${result.model} · ${result.iterations} steps · ${(result.ms / 1000).toFixed(1)}s`));
    return;
  }

  console.log(HELP);
}
