// Luna — shell tool: run commands with timeouts, output limits, and a
// hard blocklist of catastrophic patterns (self-preservation).
import { spawn } from 'node:child_process';
import { truncateMiddle } from '../util/json.js';
import { log } from '../util/log.js';
import { DEFAULTS } from '../constants.js';

const BLOCKLIST = [
  /\brm\s+(-[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\s+\/(\s|$)/,  // rm -rf /
  /\brm\s+-[rf]{2,}\s+\/(etc|usr|boot|sys|proc|dev|home|var)\b/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^|]*of=\/dev\/(sd|nvme|hd)/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,                                // fork bomb
  /\b(shutdown|poweroff|reboot|halt)\b/,
  /\bchmod\s+-R\s+777\s+\/(\s|$)/,
  /\bmv\s+\/\s+\/dev\/null/,
  />\s*\/dev\/sd[a-z]/,
];

function blocked(cmd) {
  return BLOCKLIST.find((re) => re.test(cmd));
}

export function execCommand(cmd, {
  cwd = process.cwd(),
  timeoutMs = DEFAULTS.shellTimeoutMs,
  maxOutput = DEFAULTS.maxToolOutput,
} = {}) {
  return new Promise((resolve) => {
    const danger = blocked(cmd);
    if (danger) {
      return resolve({ error: `blocked by safety policy (pattern: ${danger})`, exit: 126 });
    }
    let stdout = '', stderr = '', killed = false;
    const child = spawn('bash', ['-lc', cmd], {
      cwd,
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { if (stdout.length < maxOutput * 2) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < maxOutput) stderr += d.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ error: err.message, exit: 127 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = {
        exit: killed ? 124 : code,
        stdout: truncateMiddle(stdout, maxOutput),
        stderr: truncateMiddle(stderr, Math.floor(maxOutput / 2)),
      };
      if (killed) result.error = `timed out after ${timeoutMs}ms`;
      log.info('shell', `exit=${result.exit} cmd=${cmd.slice(0, 120)}`);
      resolve(result);
    });
  });
}

export const shellTools = [
  {
    name: 'shell.exec',
    description: 'Run a shell command in bash (cwd = current directory). Returns stdout/stderr/exit code. Long-running is killed at timeout.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command, e.g. "ls -la" or "npm test 2>&1 | tail -30"' },
        cwd: { type: 'string', description: 'Working directory (default: current)' },
        timeout: { type: 'number', description: 'Seconds before kill (default 180)' },
      },
      required: ['command'],
    },
    async execute({ command, cwd, timeout }) {
      if (typeof command !== 'string' || !command.trim()) return { error: 'empty command' };
      return execCommand(command, {
        cwd: cwd || process.cwd(),
        timeoutMs: (timeout || DEFAULTS.shellTimeoutMs / 1000) * 1000,
      });
    },
  },
];
