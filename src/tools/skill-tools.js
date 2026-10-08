// Luna — skill tools: create, install, list, show, remove, run.
// Luna builds her own skills (skill-forge) and installs them from URLs.
import fs from 'node:fs';
import path from 'node:path';
import { loadSkills, skillPath, bundledSkillPath, loadSkillTools } from '../skills/index.js';
import { log } from '../util/log.js';

const VALID_NAME = /^[a-z0-9][a-z0-9-_.]{1,48}$/;

export function makeSkillTools({ onSkillActivated } = {}) {
  return [
    {
      name: 'skills.list',
      description: 'List all skills (bundled + user-installed), with triggers and whether they add tools.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const skills = loadSkills();
        return {
          count: skills.length,
          skills: skills.map((s) => ({
            name: s.name, version: s.version, source: s.source, hasTools: !!s.toolsFile,
            description: (s.description || '').slice(0, 160), triggers: s.triggers.slice(0, 6),
          })),
        };
      },
    },
    {
      name: 'skills.show',
      description: 'Show the full instructions of one skill.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async ({ name }) => {
        const skills = loadSkills();
        const s = skills.find((x) => x.name === name);
        if (!s) return { error: `skill "${name}" not found` };
        return { name: s.name, file: s.file, content: s.body.slice(0, 8000) };
      },
    },
    {
      name: 'skills.create',
      description: 'Create a new skill as a Markdown file in ~/.luna/skills. Luna writes her own procedures — distill reusable know-how into steps.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'kebab-case name, e.g. "pdf-report-writer"' },
          description: { type: 'string' },
          triggers: { type: 'array', items: { type: 'string' }, description: 'Keywords that should activate this skill' },
          instructions: { type: 'string', description: 'The skill body: when to use, step-by-step procedure, examples, pitfalls' },
        },
        required: ['name', 'instructions'],
      },
      execute: async ({ name, description = '', triggers = [], instructions }) => {
        const clean = String(name).toLowerCase().trim().replace(/\s+/g, '-');
        if (!VALID_NAME.test(clean)) return { error: `invalid skill name "${clean}" (use kebab-case, 2-50 chars)` };
        const file = skillPath(clean);
        if (fs.existsSync(file)) return { error: `skill "${clean}" already exists — edit or remove it first` };
        const fm = [
          '---',
          `name: ${clean}`,
          'version: 1.0.0',
          `description: ${String(description).replace(/\n/g, ' ').slice(0, 200)}`,
          `triggers: [${triggers.map((t) => String(t).toLowerCase().trim()).join(', ')}]`,
          'author: luna-self',
          '---',
          '',
          String(instructions),
          '',
        ].join('\n');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, fm);
        log.info('skills', `created skill ${clean}`);
        return { ok: true, skill: clean, file, note: 'will auto-suggest when triggers match future input' };
      },
    },
    {
      name: 'skills.install',
      description: 'Install a skill from a URL (raw markdown) into ~/.luna/skills. Works with raw.githubusercontent.com links and any direct .md URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Direct URL to a skill .md file' },
          name: { type: 'string', description: 'Optional rename' },
        },
        required: ['url'],
      },
      execute: async ({ url, name }) => {
        if (!/^https?:\/\//i.test(url || '')) return { error: 'url must be http(s)' };
        let res;
        try {
          const r = await fetch(url, { headers: { 'User-Agent': 'LunaAgent/1.0' }, redirect: 'follow' });
          if (!r.ok) return { error: `HTTP ${r.status}` };
          res = await r.text();
        } catch (err) { return { error: err.message }; }

        let skillName = name;
        let content = res;
        if (/^---\s*\n/.test(res)) {
          const m = res.match(/^---\s*\n([\s\S]*?)\n---/);
          if (m) {
            const nm = m[1].match(/^name:\s*(.+)$/m);
            if (!skillName && nm) skillName = nm[1].trim();
          }
        }
        if (!skillName) {
          skillName = decodeURIComponent(url.split('/').pop() || '').replace(/\.md$/i, '') || 'imported-skill';
        }
        const clean = String(skillName).toLowerCase().trim().replace(/\s+/g, '-');
        if (!VALID_NAME.test(clean)) return { error: `invalid skill name "${clean}"` };
        if (!/^---\s*\n/.test(content)) {
          content = `---\nname: ${clean}\nversion: 1.0.0\ndescription: imported from ${url}\ntriggers: []\nauthor: imported\n---\n\n${content}`;
        }
        const file = skillPath(clean);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        log.info('skills', `installed skill ${clean} from ${url.slice(0, 80)}`);
        return { ok: true, skill: clean, file, bytes: content.length };
      },
    },
    {
      name: 'skills.remove',
      description: 'Remove a user-installed skill (bundled skills cannot be removed, only overridden).',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async ({ name }) => {
        const file = skillPath(name);
        if (fs.existsSync(file)) {
          fs.rmSync(file);
          const tools = file.replace(/\.md$/, '.tools.js');
          if (fs.existsSync(tools)) fs.rmSync(tools);
          return { ok: true, removed: name };
        }
        if (fs.existsSync(bundledSkillPath(name))) {
          return { error: `"${name}" is bundled — override it by creating ~/.luna/skills/${name}.md` };
        }
        return { error: `skill "${name}" not found` };
      },
    },
    {
      name: 'skills.run',
      description: 'Activate a skill for the CURRENT task: its instructions are injected into your context right now. Also loads its tool-pack if present.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async ({ name }) => {
        const skills = loadSkills();
        const s = skills.find((x) => x.name === name);
        if (!s) return { error: `skill "${name}" not found — try skills.list` };
        const tools = await loadSkillTools(s);
        if (onSkillActivated) onSkillActivated(s, tools);
        return {
          ok: true,
          skill: s.name,
          toolsAdded: tools.map((t) => t.name),
          note: `follow the skill instructions in the next context update`,
        };
      },
    },
  ];
}
