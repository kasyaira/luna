// Luna — HANDS: control the mouse and keyboard (GUI automation).
// X11     → xdotool (move/click/drag/scroll/type/key, window mgmt via wmctrl)
// Wayland → ydotool (move/click), wtype (type/keys) — best effort
// Every command is built by a PURE function (exported, unit-tested) and
// shell-quoted; numbers are coerced & clamped; key combos are whitelisted.
import { execCommand } from './shell-tools.js';
import { displayServer, which } from '../util/sensors.js';
import { log } from '../util/log.js';

// ---------- pure helpers (exported for tests) ----------

/** bash-safe single-quote wrapping: it's 'safe' even with quotes/newlines. */
export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const KEY_MAP = {
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape',
  pageup: 'Prior', pagedown: 'Next', backspace: 'BackSpace', printscreen: 'Print',
  capslock: 'Caps_Lock', numlock: 'Num_Lock', win: 'super', meta: 'super',
};
const MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'super']);
const KEY_RE = /^[a-z0-9]$|^f([1-9]|1[0-9]|2[0-4])$|^(enter|return|tab|esc|escape|space|backspace|delete|home|end|pageup|pagedown|up|down|left|right|insert|printscreen|pause|capslock|numlock|win|meta|super|print|prior|next)$/;

/**
 * Validate + normalize a key combo string ("ctrl+shift+t").
 * Returns {keys: 'ctrl+shift+t'} or {error}.
 * Whitelist only — this is the injection guard for keyboard control.
 */
export function sanitizeKeyCombo(raw) {
  const tokens = String(raw || '').toLowerCase().split('+').map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return { error: 'empty key combo' };
  if (tokens.length > 6) return { error: 'too many keys in combo (max 6)' };
  const out = [];
  for (const t of tokens) {
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(t)) { out.push(t.toUpperCase()); continue; } // f4 → F4
    if (!KEY_RE.test(t) && !MODIFIERS.has(t)) {
      return { error: `unknown key "${t}" — allowed: single letters/digits, F1-F24, ctrl/alt/shift/super, enter/tab/esc/space/backspace/delete/home/end/pageup/pagedown/arrows/insert/printscreen` };
    }
    out.push(KEY_MAP[t] || t);
  }
  return { keys: out.join('+') };
}

function num(v, { min = -100000, max = 100000, dflt = 0 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Build an xdotool mouse command (pure). */
export function buildXdoMouse(spec) {
  const { action } = spec;
  switch (action) {
    case 'move': {
      const x = num(spec.x, { min: 0 }), y = num(spec.y, { min: 0 });
      if (spec.x == null || spec.y == null) return { error: 'move needs x and y' };
      return { cmd: `xdotool mousemove --sync ${x} ${y}` };
    }
    case 'moveby': {
      const dx = num(spec.dx, { min: -8000, max: 8000 }), dy = num(spec.dy, { min: -8000, max: 8000 });
      return { cmd: `xdotool mousemove_relative --sync -- ${dx} ${dy}` };
    }
    case 'click': {
      const btn = { left: 1, middle: 2, right: 3 }[spec.button || 'left'];
      const parts = [];
      if (spec.x != null && spec.y != null) parts.push(`mousemove --sync ${num(spec.x, { min: 0 })} ${num(spec.y, { min: 0 })}`);
      parts.push(`click ${btn}`);
      return { cmd: `xdotool ${parts.join(' ')}` };
    }
    case 'doubleclick': {
      const btn = { left: 1, middle: 2, right: 3 }[spec.button || 'left'];
      const parts = [];
      if (spec.x != null && spec.y != null) parts.push(`mousemove --sync ${num(spec.x, { min: 0 })} ${num(spec.y, { min: 0 })}`);
      parts.push(`click --repeat 2 --delay 120 ${btn}`);
      return { cmd: `xdotool ${parts.join(' ')}` };
    }
    case 'scroll': {
      const n = num(spec.amount, { min: 1, max: 30, dflt: 3 });
      const btn = spec.direction === 'up' ? 4 : 5;
      return { cmd: `xdotool click --repeat ${n} ${btn}` };
    }
    case 'drag': {
      if (spec.from == null || spec.to == null) return { error: 'drag needs from {x,y} and to {x,y}' };
      const [x1, y1] = [num(spec.from.x, { min: 0 }), num(spec.from.y, { min: 0 })];
      const [x2, y2] = [num(spec.to.x, { min: 0 }), num(spec.to.y, { min: 0 })];
      const btn = { left: 1, middle: 2, right: 3 }[spec.button || 'left'];
      return { cmd: `xdotool mousemove --sync ${x1} ${y1}; xdotool mousedown ${btn}; xdotool mousemove --sync ${x2} ${y2}; sleep 0.15; xdotool mouseup ${btn}` };
    }
    default:
      return { error: `unknown mouse action "${action}"` };
  }
}

/** Build an xdotool keyboard command (pure; combo pre-sanitized). */
export function buildXdoKey(combo) {
  return { cmd: `xdotool key --clearmodifiers --delay 80 ${combo}` };
}

/** Build an xdotool type command (pure; text shell-quoted). */
export function buildXdoType(text, delayMs = 40) {
  const d = num(delayMs, { min: 0, max: 500, dflt: 40 });
  return { cmd: `xdotool type --clearmodifiers --delay ${d} -- ${shellQuote(text)}` };
}

/** Build a ydotool mouse command for Wayland (pure). */
export function buildYdoMouse(spec) {
  const { action } = spec;
  switch (action) {
    case 'move': {
      if (spec.x == null || spec.y == null) return { error: 'move needs x and y' };
      return { cmd: `ydotool mousemove -a ${num(spec.x, { min: 0 })} ${num(spec.y, { min: 0 })}` };
    }
    case 'moveby': {
      return { cmd: `ydotool mousemove ${num(spec.dx, { min: -8000, max: 8000 })} ${num(spec.dy, { min: -8000, max: 8000 })}` };
    }
    case 'click':
    case 'doubleclick': {
      const code = { left: '0xC0', middle: '0xC2', right: '0xC1' }[spec.button || 'left'];
      const repeat = action === 'doubleclick' ? 2 : 1;
      const parts = [];
      if (spec.x != null && spec.y != null) parts.push(`ydotool mousemove -a ${num(spec.x, { min: 0 })} ${num(spec.y, { min: 0 })}`);
      for (let i = 0; i < repeat; i++) parts.push(`ydotool click ${code}`);
      return { cmd: parts.join('; ') };
    }
    case 'drag': {
      if (spec.from == null || spec.to == null) return { error: 'drag needs from {x,y} and to {x,y}' };
      const code = { left: '0xC0', middle: '0xC2', right: '0xC1' }[spec.button || 'left'];
      const [x1, y1] = [num(spec.from.x, { min: 0 }), num(spec.from.y, { min: 0 })];
      const [x2, y2] = [num(spec.to.x, { min: 0 }), num(spec.to.y, { min: 0 })];
      return { cmd: `ydotool mousemove -a ${x1} ${y1}; ydotool click ${code}; sleep 0.05; ydotool click ${code}; sleep 0.1; ydotool mousemove -a ${x2} ${y2}; sleep 0.15; ydotool click ${code}` };
    }
    case 'scroll':
      return { error: 'scrolling is not reliably supported on Wayland yet — use input.key pageup/pagedown instead, or switch session to X11 for full support' };
    default:
      return { error: `unknown mouse action "${action}"` };
  }
}

/** Build a wtype typing/key command for Wayland (pure). */
export function buildWtypeText(text) {
  return { cmd: `wtype -- ${shellQuote(text)}` };
}
export function buildWtypeKey(comboTokens) {
  // wtype: modifiers with -M (press) … text is keys typed while held
  const flags = [];
  const keys = [];
  for (const t of comboTokens) {
    if (MODIFIERS.has(t)) flags.push(`-M ${t}`);
    else keys.push(t);
  }
  if (!keys.length) return { error: 'combo needs at least one non-modifier key' };
  // wtype -k presses a keysym-named key; keep last key as -k, others too
  const keyArgs = keys.map((k) => `-k ${shellQuote(k)}`).join(' ');
  return { cmd: `wtype ${flags.join(' ')} ${keyArgs}` };
}

// ---------- backend selection ----------

function mouseBackend() {
  const ds = displayServer();
  if (ds === 'wayland') return which('ydotool') ? 'ydotool' : null;
  if (ds === 'x11' || process.env.DISPLAY) return which('xdotool') ? 'xdotool' : null;
  return null;
}

function keyboardBackend() {
  const ds = displayServer();
  if (ds === 'wayland') {
    if (which('wtype')) return 'wtype';
    if (which('ydotool')) return 'ydotool';
    return null;
  }
  if (ds === 'x11' || process.env.DISPLAY) return which('xdotool') ? 'xdotool' : null;
  return null;
}

function installHint(kind) {
  const ds = displayServer();
  if (ds === 'none') return 'no GUI session detected — run Luna from a desktop terminal (not over SSH)';
  if (kind === 'mouse') {
    return ds === 'wayland'
      ? 'Wayland mouse control needs ydotool: sudo apt install -y ydotool && sudo systemctl enable --now ydotoold && sudo usermod -aG input $USER (relogin). X11 session works with xdotool.'
      : 'X11 mouse control needs xdotool: sudo apt install -y xdotool';
  }
  return ds === 'wayland'
    ? 'Wayland typing needs wtype (sudo apt install -y wtype) or ydotool'
    : 'X11 typing needs xdotool: sudo apt install -y xdotool';
}

// ---------- tool runner ----------

async function runMouse(spec) {
  const backend = mouseBackend();
  if (!backend) return { error: `no mouse backend available (${displayServer()} session)`, hint: installHint('mouse') };
  const built = backend === 'xdotool' ? buildXdoMouse(spec) : buildYdoMouse(spec);
  if (built.error) return built;
  const r = execCommand(built.cmd, { timeoutMs: 20000 });
  log.info('input', `mouse ${spec.action} via ${backend} exit=${r.exit}`);
  return { ok: r.exit === 0, action: spec.action, backend, cmd: built.cmd, ...(r.exit === 0 ? {} : { error: (r.stderr || r.stdout || `exit ${r.exit}`).slice(0, 300) }) };
}

async function runType({ text, delay }) {
  if (typeof text !== 'string' || !text.length) return { error: 'empty text' };
  if (text.length > 5000) return { error: 'text too long (max 5000 chars per call)' };
  const backend = keyboardBackend();
  if (!backend) return { error: `no keyboard backend available (${displayServer()} session)`, hint: installHint('key') };
  let cmd;
  if (backend === 'xdotool') cmd = buildXdoType(text, delay).cmd;
  else if (backend === 'wtype') cmd = buildWtypeText(text).cmd;
  else cmd = `ydotool type -- ${shellQuote(text)}`;
  const r = execCommand(cmd, { timeoutMs: Math.max(15000, text.length * 30) });
  log.info('input', `type ${text.length} chars via ${backend} exit=${r.exit}`);
  return { ok: r.exit === 0, backend, chars: text.length, ...(r.exit === 0 ? {} : { error: (r.stderr || r.stdout || `exit ${r.exit}`).slice(0, 300) }) };
}

async function runKey({ keys }) {
  const check = sanitizeKeyCombo(keys);
  if (check.error) return check;
  const backend = keyboardBackend();
  if (!backend) return { error: `no keyboard backend available (${displayServer()} session)`, hint: installHint('key') };
  let cmd;
  if (backend === 'xdotool') cmd = buildXdoKey(check.keys).cmd;
  else if (backend === 'wtype') {
    // wtype wants keysym names — reuse the same normalized combo tokens
    const built = buildWtypeKey(check.keys.split('+'));
    if (built.error) return built;
    cmd = built.cmd;
  } else {
    // ydotool key wants evdev codes — convert common ones
    return { error: 'ydotool key codes vary by version — install wtype for combos: sudo apt install -y wtype' };
  }
  const r = execCommand(cmd, { timeoutMs: 15000 });
  log.info('input', `key ${check.keys} via ${backend} exit=${r.exit}`);
  return { ok: r.exit === 0, keys: check.keys, backend, ...(r.exit === 0 ? {} : { error: (r.stderr || r.stdout || `exit ${r.exit}`).slice(0, 300) }) };
}

async function runPosition() {
  const backend = mouseBackend();
  if (!backend) return { error: `no mouse backend available (${displayServer()} session)`, hint: installHint('mouse') };
  if (backend !== 'xdotool') return { error: 'position query is X11-only (xdotool getmouselocation)' };
  const r = execCommand('xdotool getmouselocation', { timeoutMs: 8000 });
  const m = /x:(\d+)\s+y:(\d+)\s+screen:(\d+)\s+window:(\d+)/.exec(r.stdout || '');
  if (!m) return { error: `could not parse position: ${(r.stderr || r.stdout || 'empty').slice(0, 150)}` };
  const windowId = m[4];
  let activeTitle = null;
  if (windowId) {
    const t = execCommand(`xdotool getwindowname ${windowId} 2>/dev/null`, { timeoutMs: 5000 });
    activeTitle = (t.stdout || '').trim() || null;
  }
  return { x: Number(m[1]), y: Number(m[2]), screen: Number(m[3]), window: windowId, windowTitle: activeTitle };
}

async function runWindows({ action, id, title }) {
  const ds = displayServer();
  if (ds === 'wayland') {
    return {
      error: 'window management on Wayland is restricted by design (apps isolate windows)',
      hint: 'use screen.look to find what you need, then input.mouse/input.key to act — or switch to an X11 session for wmctrl support',
    };
  }
  if (ds === 'none') return { error: 'no GUI session detected', hint: installHint('mouse') };
  if (!process.env.DISPLAY) return { error: 'DISPLAY not set', hint: installHint('mouse') };

  const hasWmctrl = which('wmctrl');
  const hasXdotool = which('xdotool');
  if (!hasWmctrl && !hasXdotool) return { error: 'window management needs wmctrl or xdotool', hint: 'sudo apt install -y wmctrl xdotool' };

  const q = shellQuote;
  switch (action) {
    case 'list': {
      if (hasWmctrl) {
        const r = execCommand('wmctrl -l', { timeoutMs: 8000 });
        const windows = (r.stdout || '').trim().split('\n').filter(Boolean).map((line) => {
          const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
          return m ? { id: m[1].slice(2), desktop: m[2], host: m[3], title: m[4] } : { raw: line };
        });
        return { windows, count: windows.length };
      }
      const r = execCommand('xdotool search --name "" 2>/dev/null | head -40', { timeoutMs: 8000 });
      const ids = (r.stdout || '').trim().split('\n').filter(Boolean);
      return { windows: ids.map((wid) => ({ id: wid })), count: ids.length, note: 'wmctrl gives titles too: sudo apt install -y wmctrl' };
    }
    case 'activate': case 'focus': {
      if (!id && !title) return { error: 'activate needs id or title' };
      if (id) {
        const r = execCommand(`wmctrl -i -a 0x${String(id).replace(/^0x/, '')} 2>/dev/null || xdotool windowactivate ${id}`, { timeoutMs: 8000 });
        return { ok: r.exit === 0, ...(r.exit ? { error: (r.stderr || '').slice(0, 200) } : {}) };
      }
      const r = execCommand(`wmctrl -a ${q(title)} 2>/dev/null || xdotool search --name ${q(title)} windowactivate %@`, { timeoutMs: 8000 });
      return { ok: r.exit === 0, ...(r.exit ? { error: (r.stderr || 'window not found').slice(0, 200) } : {}) };
    }
    case 'close': {
      if (!id && !title) return { error: 'close needs id or title' };
      const cmd = id
        ? `wmctrl -i -c 0x${String(id).replace(/^0x/, '')}`
        : `wmctrl -c ${q(title)}`;
      const r = execCommand(cmd, { timeoutMs: 8000 });
      return { ok: r.exit === 0, ...(r.exit ? { error: (r.stderr || 'window not found').slice(0, 200) } : {}) };
    }
    case 'minimize': {
      if (!id) return { error: 'minimize needs id (from input.windows list)' };
      const r = execCommand(`xdotool windowminimize ${id}`, { timeoutMs: 8000 });
      return { ok: r.exit === 0, ...(r.exit ? { error: (r.stderr || '').slice(0, 200) } : {}) };
    }
    case 'maximize': {
      if (!id) return { error: 'maximize needs id (from input.windows list)' };
      const r = execCommand(`wmctrl -ir 0x${String(id).replace(/^0x/, '')} -b add,maximized_vert,maximized_horz`, { timeoutMs: 8000 });
      return { ok: r.exit === 0, ...(r.exit ? { error: (r.stderr || '').slice(0, 200) } : {}) };
    }
    default:
      return { error: `unknown windows action "${action}"` };
  }
}

// ---------- exported toolbelt ----------

export function makeInputTools() {
  return [
    {
      name: 'input.mouse',
      description: 'Control the mouse: move (absolute x,y), moveby (relative dx,dy), click, doubleclick, rightclick, middleclick, drag (from→to), scroll (up/down). Pair with screen.look to see where to click and to verify results.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['move', 'moveby', 'click', 'doubleclick', 'rightclick', 'middleclick', 'drag', 'scroll'] },
          x: { type: 'number', description: 'target x (px from left) for move/click' },
          y: { type: 'number', description: 'target y (px from top) for move/click' },
          dx: { type: 'number', description: 'relative x for moveby' },
          dy: { type: 'number', description: 'relative y for moveby' },
          from: { type: 'object', description: 'drag start {x,y}', properties: { x: { type: 'number' }, y: { type: 'number' } } },
          to: { type: 'object', description: 'drag end {x,y}', properties: { x: { type: 'number' }, y: { type: 'number' } } },
          button: { type: 'string', enum: ['left', 'middle', 'right'], description: 'mouse button (default left)' },
          direction: { type: 'string', enum: ['up', 'down'], description: 'scroll direction' },
          amount: { type: 'number', description: 'scroll notches (default 3)' },
        },
        required: ['action'],
      },
      async execute(spec) {
        const aliases = { rightclick: { action: 'click', button: 'right' }, middleclick: { action: 'click', button: 'middle' } };
        const s = aliases[spec.action] ? { ...spec, ...aliases[spec.action] } : spec;
        return runMouse(s);
      },
    },
    {
      name: 'input.type',
      description: 'Type text with the keyboard at the current cursor focus. Click a text field with input.mouse first.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'text to type (UTF-8 ok, max 5000 chars)' },
          delay: { type: 'number', description: 'ms between keystrokes (default 40)' },
        },
        required: ['text'],
      },
      async execute(args) { return runType(args); },
    },
    {
      name: 'input.key',
      description: 'Press a key combination, e.g. "ctrl+shift+t", "alt+F4", "enter", "ctrl+c". Modifiers: ctrl/alt/shift/super.',
      parameters: {
        type: 'object',
        properties: { keys: { type: 'string', description: 'key combo like ctrl+alt+t' } },
        required: ['keys'],
      },
      async execute(args) { return runKey(args); },
    },
    {
      name: 'input.position',
      description: 'Current mouse position (x, y) and the window under it. Useful to orient before relative moves. X11 only.',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() { return runPosition(); },
    },
    {
      name: 'input.windows',
      description: 'Manage windows: list (id+title), activate/focus (by id or title), close, minimize, maximize. X11 only — on Wayland use screen.look + input.mouse instead.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'activate', 'focus', 'close', 'minimize', 'maximize'] },
          id: { type: 'string', description: 'window id from list (decimal or hex)' },
          title: { type: 'string', description: 'window title (substring match) for activate/close' },
        },
        required: ['action'],
      },
      async execute(args) { return runWindows(args); },
    },
  ];
}
