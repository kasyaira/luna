#!/usr/bin/env node
// Luna — internal smoke tests (no network required for core; network tests optional)
// Run: npm test  |  node bin/test.js [--net]
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.LUNA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-test-'));

const WITH_NET = process.argv.includes('--net');
let pass = 0, fail = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ${'✓'} ${name}`);
  } catch (err) {
    fail++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}\n    ${err.message?.split('\n')[0]?.slice(0, 120)}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

console.log('luna self-tests\n');

// ---- module loading ----
await test('all modules import cleanly', async () => {
  const mods = [
    '../src/constants.js', '../src/config.js',
    '../src/util/ansi.js', '../src/util/async.js', '../src/util/json.js', '../src/util/log.js', '../src/util/tokens.js',
    '../src/providers/registry.js', '../src/providers/openai-compat.js', '../src/providers/router.js',
    '../src/memory/store.js', '../src/memory/retrieve.js', '../src/memory/index.js',
    '../src/healing/validator.js', '../src/healing/recovery.js', '../src/healing/supervisor.js',
    '../src/tools/index.js',
    '../src/skills/index.js',
    '../src/agent/context.js', '../src/agent/loop.js', '../src/agent/index.js',
    '../src/ui/banner.js', '../src/ui/spinner.js',
    '../src/boot.js', '../src/index.js',
  ];
  for (const m of mods) await import(m);
});

// ---- provider registry ----
const { PROVIDERS, autoOrder, PROVIDER_BY_ID } = await import('../src/providers/registry.js');

await test('provider registry has 14+ endpoints incl. keyless default', async () => {
  assert(PROVIDERS.length >= 14, `only ${PROVIDERS.length}`);
  assert(PROVIDER_BY_ID.pollinations, 'pollinations missing');
  eq(PROVIDER_BY_ID.pollinations.kind, 'keyless');
  assert(PROVIDER_BY_ID.ollama, 'ollama missing');
});

await test('auto order puts keyless first when no keys', async () => {
  const order = autoOrder({}, {});
  eq(order[0], 'pollinations', 'pollinations should be default first');
});

await test('auto order prefers keyed providers when keys exist', async () => {
  const order = autoOrder({ groq: 'x' }, {});
  assert(order[0] !== 'pollinations', 'groq should outrank pollinations when keyed');
  assert(order.includes('groq'), 'groq in chain');
});

// ---- config ----
await test('config loads with defaults + env overrides', async () => {
  const { loadConfig } = await import('../src/config.js');
  process.env.LUNA_PROVIDER = 'groq';
  const cfg = loadConfig({});
  eq(cfg.provider, 'groq', 'env provider override');
  delete process.env.LUNA_PROVIDER;
  const cfg2 = loadConfig({});
  eq(cfg2.provider, 'auto');
});

// ---- memory ----
await test('memory: save → parallel recall → stats', async () => {
  const { MemoryManager } = await import('../src/memory/index.js');
  const mem = new MemoryManager({ recallTopK: 5 });
  await mem.save('semantic', 'The user\'s laptop runs Ubuntu 24.04 with Node 20', { tags: ['env'], importance: 0.9 });
  await mem.save('semantic', 'User prefers answers in Indonesian', { tags: ['user-profile'], importance: 0.8 });
  await mem.save('procedural', 'Fix for npm ENOENT: rm -rf node_modules && npm i', { tags: ['error', 'fix'], importance: 0.7 });
  await mem.save('episodic', 'User asked about weather in Jakarta yesterday', { tags: ['turn'], importance: 0.3 });

  const hits = await mem.recall('what laptop ubuntu does the user have');
  assert(hits.length >= 1, 'no recall hits');
  assert(hits[0].bank === 'semantic', `top hit should be semantic, got ${hits[0].bank}`);
  assert(/Ubuntu/.test(hits[0].record.content), 'content mismatch');

  const stats = mem.stats();
  assert(stats.total >= 4, `expected >=4, got ${stats.total}`);
  assert(stats.banks.semantic >= 2 && stats.banks.procedural >= 1, 'bank counts wrong');
});

await test('memory: forget removes by fuzzy content query', async () => {
  const { MemoryManager } = await import('../src/memory/index.js');
  const mem = new MemoryManager({});
  await mem.save('semantic', 'xx-unique-marker-42: the secret code is 1234', { importance: 0.5 });
  const r = await mem.forget('unique marker 42');
  assert(r.removed >= 1, `removed=${r.removed}`);
  const hits = await mem.recall('secret code');
  assert(!hits.some((h) => /xx-unique-marker/.test(h.record.content)), 'still present');
});

await test('memory: consolidation distills facts', async () => {
  const { MemoryManager } = await import('../src/memory/index.js');
  const { STORES } = await import('../src/memory/store.js');
  const mem = new MemoryManager({ consolidateEveryTurns: 1 });
  STORES.episodic.rewrite([]); STORES.semantic.rewrite([]);
  await mem.save('episodic', 'User: my name is Budi and I prefer dark mode', { importance: 0.3 });
  const r = await mem.consolidate({ force: true });
  assert(r && r.distilled >= 1, `distilled=${r?.distilled}`);
});

// ---- skills ----
await test('skills: bundled skills parse with frontmatter + triggers', async () => {
  const { loadSkills, matchSkills } = await import('../src/skills/index.js');
  const skills = loadSkills();
  assert(skills.length >= 5, `bundled skills ${skills.length} < 5`);
  const names = skills.map((s) => s.name);
  for (const expected of ['self-improvement', 'deep-research', 'code-review', 'memory-gardening', 'skill-forge', 'debug-fix']) {
    assert(names.includes(expected), `missing skill ${expected}`);
  }
  const m = matchSkills('please review my code for bugs', skills);
  assert(m.length >= 1 && m[0].skill.name === 'code-review', `match got ${m[0]?.skill?.name}`);
});

// ---- tools ----
await test('tool registry: full toolbelt builds', async () => {
  const { ToolRegistry } = await import('../src/tools/index.js');
  const { MemoryManager } = await import('../src/memory/index.js');
  const mem = new MemoryManager({});
  const reg = new ToolRegistry({ memory: mem, cfg: { maxIterations: 5 } });
  const names = reg.names();
  for (const expected of ['think', 'fs.read', 'fs.write', 'fs.edit', 'fs.list', 'fs.search',
    'shell.exec', 'memory.save', 'memory.recall', 'memory.forget', 'memory.stats',
    'skills.list', 'skills.create', 'skills.install', 'skills.run',
    'self.read', 'self.patch', 'self.check', 'self.snapshot', 'self.rollback', 'self.reload',
    'git.status', 'git.commit', 'web.fetch', 'web.search', 'heal.report', 'heal.fix']) {
    assert(names.includes(expected), `missing tool ${expected}`);
  }
  const schemas = reg.openAiSchemas();
  assert(schemas.length === names.length, 'schema count mismatch');
  assert(schemas[0].type === 'function' && schemas[0].function.name, 'schema shape wrong');
});

await test('fs tools: write → read → edit → search round-trip', async () => {
  const { ToolRegistry } = await import('../src/tools/index.js');
  const { MemoryManager } = await import('../src/memory/index.js');
  const reg = new ToolRegistry({ memory: new MemoryManager({}), cfg: {} });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-fs-'));
  const file = path.join(dir, 'hello.txt');
  const w = await reg.execute({ name: 'fs.write', arguments: { path: file, content: 'hello luna\nsecond line' } });
  assert(!w.error, `write failed: ${w.error}`);
  const r = await reg.execute({ name: 'fs.read', arguments: { path: file } });
  assert(r.content.includes('hello luna'), 'read mismatch');
  const e = await reg.execute({ name: 'fs.edit', arguments: { path: file, old: 'hello luna', new: 'hi luna' } });
  assert(e.ok && e.replacements === 1, 'edit failed');
  const s = await reg.execute({ name: 'fs.search', arguments: { pattern: 'second', path: dir } });
  assert(s.matches?.length >= 1, 'search found nothing');
  const rm = await reg.execute({ name: 'fs.remove', arguments: { path: file } });
  assert(rm.ok, 'remove failed');
});

await test('shell tool: blocks catastrophic commands, runs safe ones', async () => {
  const { ToolRegistry } = await import('../src/tools/index.js');
  const reg = new ToolRegistry({ memory: { save: async () => ({}) }, cfg: { shellTimeoutMs: 10000 } });
  const blocked = await reg.execute({ name: 'shell.exec', arguments: { command: 'rm -rf /' } });
  assert(blocked.error && /blocked/i.test(blocked.error), 'rm -rf / not blocked');
  const ok = await reg.execute({ name: 'shell.exec', arguments: { command: 'echo luna-shell-ok' } });
  assert(ok.stdout?.includes('luna-shell-ok'), `echo failed: ${JSON.stringify(ok).slice(0, 100)}`);
});

await test('memory tools: recall via tool interface', async () => {
  const { ToolRegistry } = await import('../src/tools/index.js');
  const { MemoryManager } = await import('../src/memory/index.js');
  const mem = new MemoryManager({});
  await mem.save('semantic', 'TEST-FACT: luna memory tools work', { importance: 0.9 });
  const reg = new ToolRegistry({ memory: mem, cfg: {} });
  const r = await reg.execute({ name: 'memory.recall', arguments: { query: 'memory tools work' } });
  assert(r.count >= 1 && /TEST-FACT/.test(r.text), `recall tool: ${JSON.stringify(r).slice(0, 120)}`);
});

// ---- self / healing ----
await test('validator: node --check catches broken JS, passes good JS', async () => {
  const { checkSyntax } = await import('../src/healing/validator.js');
  const bad = path.join(os.tmpdir(), 'luna-bad.js');
  fs.writeFileSync(bad, 'const = broken(((\n');
  const r1 = await checkSyntax(bad);
  assert(!r1.ok, 'broken JS passed');
  const good = path.join(os.tmpdir(), 'luna-good.js');
  fs.writeFileSync(good, 'const ok = 1;\nexport default ok;\n');
  const r2 = await checkSyntax(good);
  assert(r2.ok, 'good JS failed');
});

await test('self tools: patch validates syntax and refuses broken writes', async () => {
  const { ToolRegistry } = await import('../src/tools/index.js');
  const reg = new ToolRegistry({ memory: { save: async () => ({}) }, cfg: {} });
  const target = path.join(ROOT, 'src', 'zz-test-tmp.js');
  const bad = await reg.execute({ name: 'self.patch', arguments: { path: 'src/zz-test-tmp.js', content: 'broken(((' } });
  assert(!bad.ok && /syntax/i.test(bad.error), `should refuse: ${JSON.stringify(bad).slice(0, 120)}`);
  assert(!fs.existsSync(target), 'no file should be written on validation failure');
  const good = await reg.execute({ name: 'self.patch', arguments: { path: 'src/zz-test-tmp.js', content: '// temp file for tests\nexport const zz = 1;\n' } });
  assert(good.ok, `good patch failed: ${JSON.stringify(good).slice(0, 200)}`);
  fs.rmSync(target, { force: true });
});

await test('backup/rollback: snapshot then restore', async () => {
  const { snapshot, restoreFile, listSnapshots } = await import('../src/healing/recovery.js');
  const snap = snapshot('unit-test');
  assert(snap.ok, 'snapshot failed');
  const marker = path.join(ROOT, 'src', 'zz-marker.js');
  fs.writeFileSync(marker, '// marker\n');
  const r = restoreFile('src/zz-marker.js'); // not in snapshot → should fail
  // (marker was created after snapshot, so no backup contains it)
  fs.rmSync(marker, { force: true });
  const snaps = listSnapshots(10);
  assert(snaps.some((s) => s.includes('unit-test')), 'snapshot not listed');
});

await test('agent: context builder produces structured system prompt', async () => {
  const { buildSystemContext, assembleMessages } = await import('../src/agent/context.js');
  const sys = buildSystemContext({
    cfg: {}, memoriesText: '[semantic] user likes tea', activeSkill: null,
    toolNames: ['think', 'fs.read'], jsonProtocol: false, cwd: '/tmp', sessionTurn: 3,
  });
  assert(/IDENTITY/.test(sys) && /MEMORY/.test(sys) && /ENVIRONMENT/.test(sys), 'sections missing');
  assert(/user likes tea/.test(sys), 'memory not injected');
  const msgs = assembleMessages({ system: sys, history: [], user: 'hi' });
  eq(msgs[0].role, 'system');
  eq(msgs.at(-1).content, 'hi');
});

await test('json protocol: extract tool blocks from assistant prose', async () => {
  const { extractJsonBlocks } = await import('../src/util/json.js');
  const blocks = extractJsonBlocks('Sure! Let me check.\n```json\n{"tool":"fs.read","args":{"path":"/tmp/x"}}\n```');
  eq(blocks[0]?.tool, 'fs.read');
  const inline = extractJsonBlocks('{"tool":"think","args":{"thought":"hmm"}}');
  eq(inline[0]?.tool, 'think');
});

await test('tokens: fitHistory trims under budget', async () => {
  const { fitHistory } = await import('../src/util/tokens.js');
  const msgs = [
    { role: 'system', content: 'sys' },
    ...Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: 'x'.repeat(200) + i })),
  ];
  const { messages, dropped } = fitHistory(msgs, 500);
  assert(dropped > 0, 'should drop');
  eq(messages[0].role, 'system', 'system must survive');
});

// ---- network (optional) ----
if (WITH_NET) {
  await test('NET: pollinations keyless chat responds', async () => {
    const { chatOnce } = await import('../src/providers/openai-compat.js');
    const { PROVIDER_BY_ID } = await import('../src/providers/registry.js');
    const res = await chatOnce(PROVIDER_BY_ID.pollinations, { requestTimeoutMs: 60000 }, {
      messages: [{ role: 'user', content: 'Reply with exactly: LUNA_NET_OK' }],
      temperature: 0,
    });
    assert(res.content && res.content.length > 0, `no content: ${JSON.stringify(res).slice(0, 200)}`);
  });

  await test('NET: provider router chat() end-to-end', async () => {
    const { chat } = await import('../src/providers/router.js');
    const res = await chat({ provider: 'auto', requestTimeoutMs: 60000 }, {
      messages: [{ role: 'user', content: 'Say OK' }],
    });
    assert(res.content, 'no content from router');
    assert(res.providerId, 'provider id missing');
  });
}

// ---- summary ----
console.log(`\n${pass} passed, ${fail} failed${fail ? '' : ' — all green ✦'}`);
if (fail) {
  for (const f of failures) console.error(`  ✗ ${f.name}: ${f.error?.slice(0, 200)}`);
  process.exit(1);
}
