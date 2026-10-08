// Luna — ANSI escape helpers (zero-dependency terminal styling)
import { ANSI_ENABLED } from '../constants.js';

const CODES = {
  reset: 0, bold: 1, dim: 2, italic: 3, underline: 4, blink: 5, reverse: 7,
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  bgBlack: 40, bgRed: 41, bgGreen: 42, bgYellow: 43, bgBlue: 44, bgMagenta: 45, bgCyan: 46, bgWhite: 47,
  brightBlack: 90, brightRed: 91, brightGreen: 92, brightYellow: 93,
  brightBlue: 94, brightMagenta: 95, brightCyan: 96, brightWhite: 97,
};

function wrap(code, text) {
  if (!ANSI_ENABLED) return String(text ?? '');
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const ansi = {};
for (const [name, code] of Object.entries(CODES)) {
  ansi[name] = (text) => wrap(code, text);
}

/** 256-color foreground. */
export function fg256(n, text) {
  if (!ANSI_ENABLED) return String(text ?? '');
  return `\x1b[38;5;${n}m${text}\x1b[0m`;
}

export function rgbFg(r, g, b, text) {
  if (!ANSI_ENABLED) return String(text ?? '');
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/** Moon-lavender → cyan gradient text. */
export function gradient(text) {
  if (!ANSI_ENABLED) return String(text);
  const stops = [
    [190, 150, 255], [160, 165, 255], [130, 180, 255],
    [110, 195, 250], [90, 210, 245], [80, 225, 240],
  ];
  const chars = [...String(text)];
  const out = chars.map((ch, i) => {
    if (ch === ' ') return ch;
    const t = chars.length > 1 ? i / (chars.length - 1) : 0;
    const pos = t * (stops.length - 1);
    const i0 = Math.floor(pos), i1 = Math.min(stops.length - 1, i0 + 1);
    const f = pos - i0;
    const r = Math.round(stops[i0][0] + (stops[i1][0] - stops[i0][0]) * f);
    const g = Math.round(stops[i0][1] + (stops[i1][1] - stops[i0][1]) * f);
    const b = Math.round(stops[i0][2] + (stops[i1][2] - stops[i0][2]) * f);
    return `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
  });
  return out.join('');
}

export function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

export function clearLine(stream = process.stdout) {
  if (stream.isTTY) stream.write('\r\x1b[2K');
}
