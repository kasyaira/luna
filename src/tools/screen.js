// Luna — EYES (screen): see what's on the display.
// screen.capture → screenshot (X11: gnome-screenshot/scrot/import · Wayland: grim)
// screen.look    → screenshot + vision description — lets Luna read UI,
//                  verify the results of her own mouse/keyboard actions.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../constants.js';
import { execCommand } from './shell-tools.js';
import { describeImage } from '../providers/vision.js';
import { displayServer, hasGui, which } from '../util/sensors.js';
import { prepareForVision } from './vision.js';
import { log } from '../util/log.js';

const CAPTURES = DIRS.captures;

function ensureCaptures() {
  if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });
  return CAPTURES;
}

function validImage(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < 4000) return false;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const jpg = buf[0] === 0xff && buf[1] === 0xd8;
    return png || jpg;
  } catch { return false; }
}

/**
 * Screenshot the whole screen (all monitors on X11 backends that support it).
 * Auto-detects display server and picks the first available tool.
 */
export function captureScreen({ timeoutSec = 20 } = {}) {
  const ds = displayServer();
  if (!hasGui()) {
    return {
      error: `no GUI session detected (display server: ${ds})`,
      hint: ds === 'none'
        ? 'run Luna from a desktop terminal (not SSH) to use screen tools'
        : 'DISPLAY/WAYLAND_DISPLAY not set — run from the desktop session',
    };
  }

  const file = path.join(ensureCaptures(), `screen-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  const q = JSON.stringify;

  const attempts = [];
  if (ds === 'wayland') {
    if (which('grim')) attempts.push(`grim -t png ${q(file)}`);
    if (which('gnome-screenshot')) attempts.push(`gnome-screenshot -f ${q(file)}`);
  } else {
    if (which('gnome-screenshot')) attempts.push(`gnome-screenshot -f ${q(file)}`);
    if (which('scrot')) attempts.push(`scrot -z -o ${q(file)}`);
    if (which('import')) attempts.push(`import -window root ${q(file)}`);
    // last resort inside SSH-with-X11-forwarding etc.
    if (which('xdotool') && which('import')) attempts.push(`import -window root ${q(file)}`);
  }

  for (const cmd of attempts) {
    const r = execCommand(cmd, { cwd: path.dirname(file), timeoutMs: timeoutSec * 1000 });
    if (r.exit === 0 && validImage(file)) {
      log.info('screen', `captured ${path.basename(file)}`);
      return { ok: true, path: file, backend: cmd.split(' ')[0] };
    }
    try { fs.rmSync(file, { force: true }); } catch {}
  }

  return {
    error: 'screenshot failed',
    displayServer: ds,
    hint: ds === 'wayland'
      ? 'Wayland needs one of: grim (sudo apt install -y grim), gnome-screenshot'
      : 'X11 needs one of: gnome-screenshot, scrot, imagemagick (sudo apt install -y scrot)',
  };
}

export function makeScreenTools() {
  return [
    {
      name: 'screen.capture',
      description: 'Take a screenshot of the whole screen. Returns the saved file path. Works on X11 and Wayland.',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        return captureScreen();
      },
    },
    {
      name: 'screen.look',
      description: 'SEE the screen: screenshot + vision description. Use it to read UI, find buttons/coordinates, and to VERIFY the effect of mouse/keyboard actions you just performed. Combine with input.mouse for closed-loop control.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to look for (default: describe the screen, list visible windows, buttons, and any text)' },
        },
        required: [],
      },
      async execute({ prompt }, { cfg } = {}) {
        const shot = captureScreen();
        if (shot.error) return shot;

        // screenshots are big PNGs — downscale for the vision API
        const prep = prepareForVision(shot.path, { maxWidth: 1280 });
        const bytes = fs.statSync(prep.path).size;
        const mime = /\.png$/i.test(prep.path) ? 'image/png' : 'image/jpeg';
        const imageBase64 = fs.readFileSync(prep.path).toString('base64');

        const res = await describeImage(cfg || {}, {
          imageBase64, mimeType: mime,
          prompt: prompt || 'Describe this screenshot: which app/window is focused, the main UI elements, any dialogs, and any important text. Estimate pixel coordinates of notable buttons relative to the top-left corner.',
          system: 'You are the eyes of a terminal AI agent looking at a screenshot. Describe precisely; include approximate coordinates (x,y from top-left) for clickable elements when possible.',
        });
        if (res.error) return { screenshot: shot.path, vision: res, note: 'screenshot captured, but understanding failed' };
        return {
          screenshot: shot.path,
          vision: { description: res.description, model: `${res.provider} · ${res.model}` },
          description: res.description,
        };
      },
    },
  ];
}
