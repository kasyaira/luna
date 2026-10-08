// Luna — skill system.
// A skill is a Markdown file with frontmatter (name, description, triggers)
// plus instructions. Skills can also ship executable tool-packs: a sibling
// `<name>.tools.js` exporting an array of tool definitions — installing the
// skill literally gives Luna new tools.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, LUNA_ROOT } from '../constants.js';
import { log } from '../util/log.js';

const SKILL_DIRS = [
  path.join(DIRS.skills),              // user-installed (~/.luna/skills)
  path.join(LUNA_ROOT, 'skills'),      // bundled with the repo
];

export function parseFrontmatter(raw) {
  const meta = { name: '', version: '1.0.0', description: '', triggers: [], author: 'luna' };
  let body = raw;
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      if (key === 'triggers') {
        meta.triggers = val.replace(/[[\]"']/g, '').split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      } else if (key !== '') {
        meta[key] = val;
      }
    }
  }
  return { meta, body: body.trim() };
}

export function skillPath(skill) {
  return path.join(DIRS.skills, `${skill}.md`);
}

export function bundledSkillPath(skill) {
  return path.join(LUNA_ROOT, 'skills', `${skill}.md`);
}

/** Load every skill (user dir overrides bundled with the same name). */
export function loadSkills() {
  const found = new Map();
  for (const dir of [...SKILL_DIRS].reverse()) { // bundled first, user dir overrides
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        const full = path.join(dir, f);
        let raw;
        try { raw = fs.readFileSync(full, 'utf8'); } catch { continue; }
        const { meta, body } = parseFrontmatter(raw);
        const name = meta.name || f.replace(/\.md$/, '');
        found.set(name, {
          name,
          version: meta.version,
          description: meta.description,
          triggers: meta.triggers.length ? meta.triggers : deriveTriggers(name + ' ' + meta.description),
          body,
          file: full,
          source: dir === SKILL_DIRS[0] ? 'user' : 'bundled',
          toolsFile: fs.existsSync(full.replace(/\.md$/, '.tools.js')) ? full.replace(/\.md$/, '.tools.js') : null,
        });
      }
    } catch (err) {
      log.warn('skills', `failed scanning ${dir}: ${err.message}`);
    }
  }
  return [...found.values()];
}

function deriveTriggers(text) {
  return String(text || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 6);
}

/** Rank skills by trigger-word overlap with user input. */
export function matchSkills(input, skills) {
  const words = new Set(String(input).toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  return skills
    .map((s) => {
      let score = 0;
      for (const t of s.triggers) {
        if (words.has(t)) score += 2;
        else if ([...words].some((w) => t.includes(w) || w.includes(t))) score += 1;
      }
      if (words.has(s.name.toLowerCase())) score += 3;
      return { skill: s, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
}

/** Load a skill's tool-pack (JS module) if it ships one. */
export async function loadSkillTools(skill) {
  if (!skill.toolsFile) return [];
  try {
    const mod = await import(`${skill.toolsFile}?t=${Date.now()}`); // cache-bust
    const tools = mod.default?.tools || mod.tools || mod.default;
    if (Array.isArray(tools)) return tools;
    return [];
  } catch (err) {
    log.warn('skills', `tool-pack failed for ${skill.name}: ${err.message}`);
    return [];
  }
}

export function skillSummary(skills) {
  return skills.map((s) => ({
    name: s.name, version: s.version, source: s.source,
    description: (s.description || '').slice(0, 120),
    triggers: s.triggers.slice(0, 6),
    hasTools: !!s.toolsFile,
  }));
}

export function formatSkillForPrompt(skill) {
  return [
    `### SKILL ACTIVE: ${skill.name} (v${skill.version})`,
    skill.description ? `_${skill.description}_` : '',
    '',
    skill.body.slice(0, 6000),
  ].filter(Boolean).join('\n');
}
