// Luna — environment sensors: display server, webcams, input backends,
// screenshot/capture helpers. Powers her "body awareness" (self.sensors,
// doctor) and gives precise install hints when a helper is missing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

/** Pure: which display server is this process attached to? */
export function displayServer(env = process.env) {
  if (env.XDG_SESSION_TYPE) return env.XDG_SESSION_TYPE; // x11 | wayland | tty
  if (env.WAYLAND_DISPLAY) return 'wayland';
  if (env.DISPLAY) return 'x11';
  return 'none';
}

/** True when a GUI session is reachable (mouse/keyboard/screenshot possible). */
export function hasGui(env = process.env) {
  const ds = displayServer(env);
  if (ds === 'x11') return !!env.DISPLAY;
  if (ds === 'wayland') return !!env.WAYLAND_DISPLAY;
  return false;
}

/** Is a binary on PATH? (cached, sync — spawnSync with bash -lc) */
const whichCache = new Map();
export function which(bin) {
  if (whichCache.has(bin)) return whichCache.get(bin);
  let ok = false;
  try {
    const r = spawnSync('bash', ['-lc', `command -v ${bin} >/dev/null 2>&1 && echo FOUND`], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    ok = (r.stdout || '').includes('FOUND');
  } catch { ok = false; }
  whichCache.set(bin, ok);
  return ok;
}

/** Webcam device nodes (/dev/videoN). */
export function cameraDevices() {
  try {
    return fs.readdirSync('/dev')
      .filter((n) => /^video\d+$/.test(n))
      .map((n) => `/dev/${n}`);
  } catch { return []; }
}

/** Friendly camera names via v4l2-ctl if present (best-effort). */
export function cameraNames() {
  if (!which('v4l2-ctl')) return null;
  try {
    const r = spawnSync('bash', ['-lc', 'v4l2-ctl --list-devices 2>/dev/null'], {
      encoding: 'utf8', timeout: 4000,
    });
    return (r.stdout || '').trim() || null;
  } catch { return null; }
}

/**
 * Full body report — what Luna's eyes & hands can reach right now.
 * Pure-ish (cached binary lookups, filesystem reads only).
 */
export function sensorReport() {
  const ds = displayServer();
  const cameras = cameraDevices();
  const xdotool = which('xdotool');
  const ydotool = which('ydotool');
  const wtype = which('wtype');
  const wmctrl = which('wmctrl');
  const ffmpeg = which('ffmpeg');
  const fswebcam = which('fswebcam');
  const scrot = which('scrot');
  const grim = which('grim');
  const gnomeScreenshot = which('gnome-screenshot');
  const import_ = which('import');

  const wayland = ds === 'wayland';
  const inputBackend = wayland
    ? (ydotool ? 'ydotool' : (wtype ? 'wtype (typing only)' : null))
    : (xdotool ? 'xdotool' : null);
  const screenshotBackend = wayland
    ? (grim ? 'grim' : (gnomeScreenshot ? 'gnome-screenshot' : null))
    : (gnomeScreenshot ? 'gnome-screenshot' : (scrot ? 'scrot' : (import_ ? 'imagemagick import' : null)));
  const cameraBackend = ffmpeg ? 'ffmpeg' : (fswebcam ? 'fswebcam' : null);

  const report = {
    display: { server: ds, gui: hasGui(), wayland, x11: ds === 'x11' },
    eyes: {
      cameras: cameras.length ? cameras : [],
      cameraBackend,
      canSee: cameras.length > 0 && !!cameraBackend,
      screenshotBackend,
      canSeeScreen: hasGui() && !!screenshotBackend,
    },
    hands: {
      inputBackend,
      canMove: !!inputBackend && (wayland ? !!ydotool : !!xdotool),
      canType: !!inputBackend,
      windowManager: wmctrl ? 'wmctrl' : (xdotool ? 'xdotool search' : null),
    },
    installHints: [],
  };

  if (cameras.length && !cameraBackend) {
    report.installHints.push('camera capture needs ffmpeg: sudo apt install -y ffmpeg   (or fswebcam)');
  }
  if (!cameras.length) {
    report.installHints.push('no /dev/video* camera detected (laptop webcam? check privacy shutter / USB)');
  }
  if (hasGui() && !inputBackend) {
    report.installHints.push(wayland
      ? 'input control on Wayland needs ydotool (sudo apt install -y ydotool; enable ydotoold service, add user to input group)'
      : 'input control on X11 needs xdotool: sudo apt install -y xdotool');
  }
  if (hasGui() && !screenshotBackend) {
    report.installHints.push(wayland
      ? 'screenshots on Wayland need grim: sudo apt install -y grim   (or gnome-screenshot)'
      : 'screenshots need one of: gnome-screenshot / scrot / imagemagick');
  }
  return report;
}
