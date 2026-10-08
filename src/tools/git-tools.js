// Luna — git tools: safe subset for version-control workflows.
import { execCommand } from './shell-tools.js';
import fs from 'node:fs';
import path from 'node:path';

const SAFE_GIT = /^(status|log|diff|add|commit|push|pull|fetch|clone|branch|checkout|switch|merge|rebase|stash|tag|init|remote|show|restore|reset)\b/;

function isGitRepo(dir = process.cwd()) {
  let d = path.resolve(dir);
  while (true) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

async function git(args, cwd) {
  const cmd = `git ${args}`;
  const first = args.trim().split(/\s+/)[0];
  if (!SAFE_GIT.test(first)) {
    return { error: `git subcommand "${first}" not allowed (policy: read/version-control ops only)` };
  }
  const res = await execCommand(cmd, { cwd, timeoutMs: 60_000 });
  return res;
}

export const gitTools = [
  {
    name: 'git.status',
    description: 'git status --short --branch for the current repo.',
    parameters: { type: 'object', properties: { cwd: { type: 'string' } }, required: [] },
    execute: async ({ cwd } = {}) => {
      const repo = isGitRepo(cwd || process.cwd());
      if (!repo) return { error: 'not inside a git repository (use git.init or clone first)' };
      const r = await git('status --short --branch', cwd);
      return { repo, ...r };
    },
  },
  {
    name: 'git.diff',
    description: 'Show pending changes (git diff + staged diff).',
    parameters: { type: 'object', properties: { staged: { type: 'boolean' }, cwd: { type: 'string' } }, required: [] },
    execute: async ({ staged, cwd } = {}) =>
      git(staged ? 'diff --cached --stat && git diff --cached' : 'diff --stat && git diff', cwd),
  },
  {
    name: 'git.log',
    description: 'Recent commit history.',
    parameters: {
      type: 'object',
      properties: { n: { type: 'number', description: 'Number of commits (default 10)' }, cwd: { type: 'string' } },
      required: [],
    },
    execute: async ({ n = 10, cwd } = {}) => git(`log --oneline --graph -${Math.min(100, Math.max(1, n))}`, cwd),
  },
  {
    name: 'git.commit',
    description: 'Stage all changes (or given paths) and commit with a message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Specific paths to add (default: -A)' },
        cwd: { type: 'string' },
      },
      required: ['message'],
    },
    execute: async ({ message, paths = [], cwd } = {}) => {
      const repo = isGitRepo(cwd || process.cwd());
      if (!repo) return { error: 'not inside a git repository' };
      const add = paths.length ? `git add -- ${paths.map(shellQuote).join(' ')}` : 'git add -A';
      const commit = `git commit -m ${shellQuote(message)} --no-verify`;
      const r = await execCommand(`${add} && ${commit} && git log --oneline -1`, { cwd, timeoutMs: 60_000 });
      return r;
    },
  },
  {
    name: 'git.push',
    description: 'Push current branch to a remote (default origin).',
    parameters: {
      type: 'object',
      properties: { remote: { type: 'string' }, branch: { type: 'string' }, cwd: { type: 'string' } },
      required: [],
    },
    execute: async ({ remote = 'origin', branch = '', cwd } = {}) => {
      const b = branch || '';
      return git(`push ${remote} ${b}`.trim(), cwd);
    },
  },
  {
    name: 'git.pull',
    description: 'Pull latest changes from a remote.',
    parameters: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' }, cwd: { type: 'string' } }, required: [] },
    execute: async ({ remote = 'origin', branch = '', cwd } = {}) =>
      git(`pull ${remote} ${b}`.trim(), cwd),
  },
  {
    name: 'git.exec',
    description: 'Run any allowed git subcommand (status/log/diff/add/commit/push/pull/fetch/branch/checkout/stash/tag/init/remote/show/restore/reset).',
    parameters: {
      type: 'object',
      properties: { args: { type: 'string', description: 'Everything after "git ", e.g. "branch -a"' }, cwd: { type: 'string' } },
      required: ['args'],
    },
    execute: async ({ args, cwd } = {}) => git(args, cwd),
  },
];

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
