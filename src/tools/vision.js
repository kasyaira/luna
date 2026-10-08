// Luna — EYES (webcam): see through the camera.
// vision.devices  → list webcams
// vision.capture  → snap a photo (ffmpeg → fswebcam fallback, warm-up aware)
// vision.look     → snap + understand with a vision model (the "look" primitive)
// vision.analyze  → understand an existing image file (photo/screenshot/download)
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, LUNA_ROOT } from '../constants.js';
import { execCommand } from './shell-tools.js';
import { resolvePath } from './fs-tools.js';
import { describeImage } from '../providers/vision.js';
import { cameraDevices, cameraNames, which } from '../util/sensors.js';
import { log } from '../util/log.js';

const CAPTURES = DIRS.captures;

function ensureCaptures() {
  if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });
  return CAPTURES;
}

function shotName(prefix) {
  return path.join(ensureCaptures(), `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
}

function validJpeg(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < 3000) return false;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(3);
    fs.readSync(fd, buf, 0, 3, 0);
    fs.closeSync(fd);
    return buf[0] === 0xff && buf[1] === 0xd8;
  } catch { return false; }
}

/**
 * Capture one photo from a webcam. Webcams need a few frames to warm up
 * (first frames are dark), so we grab several and keep the last.
 */
export function capturePhoto({ device = '/dev/video0', width = 1024, timeoutSec = 30 } = {}) {
  if (!fs.existsSync(device)) {
    const all = cameraDevices();
    return {
      error: `camera device not found: ${device}`,
      devices: all,
      hint: all.length
        ? `available: ${all.join(', ')} — retry with one of those`
        : 'no /dev/video* found. Is the webcam enabled (privacy shutter/switch)?',
    };
  }

  // --- backend 1: ffmpeg (most common, best quality control) ---
  if (which('ffmpeg')) {
    const file = shotName('cam');
    const dir = path.dirname(file);
    const attempts = [
      // warm-up: grab 4 frames, keep the last (mjpeg fast path)
      `ffmpeg -y -hide_banner -loglevel error -f v4l2 -input_format mjpeg -video_size 1280x720 -i ${device} -frames:v 4 -q:v 4 ${JSON.stringify(path.join(dir, 'frame%d.jpg'))}`,
      // plain path (some cams don't do mjpeg)
      `ffmpeg -y -hide_banner -loglevel error -f v4l2 -video_size 640x480 -i ${device} -frames:v 4 -q:v 4 ${JSON.stringify(path.join(dir, 'frame%d.jpg'))}`,
    ];
    for (const cmd of attempts) {
      const r = execCommand(cmd, { cwd: dir, timeoutMs: timeoutSec * 1000 });
      const last = path.join(dir, 'frame4.jpg');
      if (r.exit === 0 && validJpeg(last)) {
        // downscale for vision APIs if requested
        if (which('ffmpeg') && width && width < 1280) {
          execCommand(`ffmpeg -y -hide_banner -loglevel error -i ${JSON.stringify(last)} -vf scale=${width}:-2 -q:v 5 ${JSON.stringify(file)}`, { cwd: dir, timeoutMs: 15000 });
        }
        if (!fs.existsSync(file)) fs.renameSync(last, file);
        // clean temp frames
        for (let i = 1; i <= 4; i++) { try { fs.rmSync(path.join(dir, `frame${i}.jpg`), { force: true }); } catch {} }
        log.info('vision', `captured ${path.basename(file)} via ffmpeg`);
        return { ok: true, path: file, backend: 'ffmpeg' };
      }
      for (let i = 1; i <= 4; i++) { try { fs.rmSync(path.join(dir, `frame${i}.jpg`), { force: true }); } catch {} }
    }
  }

  // --- backend 2: fswebcam ---
  if (which('fswebcam')) {
    const file = shotName('cam');
    const r = execCommand(`fswebcam -d ${device} -r 1280x720 --skip 3 --no-banner ${JSON.stringify(file)}`, {
      cwd: path.dirname(file), timeoutMs: timeoutSec * 1000,
    });
    if (r.exit === 0 && validJpeg(file)) {
      log.info('vision', `captured ${path.basename(file)} via fswebcam`);
      return { ok: true, path: file, backend: 'fswebcam' };
    }
    try { fs.rmSync(file, { force: true }); } catch {}
  }

  return {
    error: 'capture failed',
    hint: which('ffmpeg')
      ? 'ffmpeg ran but produced no valid frame — device may be busy (Zoom/browser using it?) or unsupported. Try: vision.devices'
      : 'no capture backend installed. Fix: sudo apt install -y ffmpeg   (or fswebcam)',
  };
}

/**
 * Prepare an image for a vision API: downscale huge files to ≤1024px JPEG
 * (screenshots can be 2-4 MB PNGs). Returns a path (possibly the original).
 */
export function prepareForVision(filePath, { maxWidth = 1024 } = {}) {
  try {
    const stat = fs.statSync(filePath);
    const isPng = /\.png$/i.test(filePath);
    const isJpeg = /\.jpe?g$/i.test(filePath);
    if (stat.size < 700 * 1024 && (isJpeg || stat.size < 900 * 1024)) return { path: filePath, bytes: stat.size };
    if (!which('ffmpeg')) {
      if (stat.size > 6 * 1024 * 1024) {
        return { path: filePath, bytes: stat.size, warning: 'image is large and ffmpeg is not installed — the vision API may reject it. sudo apt install -y ffmpeg' };
      }
      return { path: filePath, bytes: stat.size };
    }
    const out = filePath.replace(/\.(png|jpeg|jpg)$/i, '') + `-v${Date.now() % 100000}.jpg`;
    const r = execCommand(
      `ffmpeg -y -hide_banner -loglevel error -i ${JSON.stringify(filePath)} -vf scale='min(${maxWidth},iw)':-2 -q:v 5 ${JSON.stringify(out)}`,
      { timeoutMs: 20000 },
    );
    if (r.exit === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000) {
      return { path: out, bytes: fs.statSync(out).size, transcoded: true, original: filePath };
    }
    return { path: filePath, bytes: stat.size };
  } catch (err) {
    return { path: filePath, bytes: 0, warning: String(err.message || err) };
  }
}

/** Read + encode an image file for the vision router. */
function encodeImage(filePath) {
  const prep = prepareForVision(resolvePath(filePath));
  if (!fs.existsSync(prep.path)) return { error: `image not found: ${filePath}` };
  const buf = fs.readFileSync(prep.path);
  if (!buf.length) return { error: `image is empty: ${prep.path}` };
  const mime = /\.png$/i.test(prep.path) ? 'image/png' : 'image/jpeg';
  return { imageBase64: buf.toString('base64'), mime, path: prep.path, bytes: buf.length };
}

export function makeVisionTools() {
  return [
    {
      name: 'vision.devices',
      description: 'List available camera devices (/dev/video*) with names. Check this before vision.capture/look.',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        const devices = cameraDevices();
        const names = cameraNames(); // v4l2-ctl, may be null
        return {
          devices,
          count: devices.length,
          names: names ? names.split('\n').filter(Boolean).slice(0, 20) : undefined,
          hint: devices.length ? undefined : 'no cameras found — check privacy shutter / USB / permissions (video group)',
        };
      },
    },
    {
      name: 'vision.capture',
      description: 'Capture a photo from the webcam. Handles camera warm-up (skips first dark frames). Returns the saved file path (~/.luna/captures).',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Camera device (default /dev/video0; see vision.devices)' },
          width: { type: 'number', description: 'Max width in px for the saved photo (default 1024)' },
        },
        required: [],
      },
      async execute({ device, width }) {
        return capturePhoto({ device: device || '/dev/video0', width: width || 1024 });
      },
    },
    {
      name: 'vision.look',
      description: 'SEE through the webcam: capture a photo and have a vision model describe it. Use whenever the user asks you to look/see/watch the camera or the room.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to pay attention to / question about the scene (default: full description)' },
          device: { type: 'string', description: 'Camera device (default /dev/video0)' },
        },
        required: [],
      },
      async execute({ prompt, device }, { cfg } = {}) {
        const shot = capturePhoto({ device: device || '/dev/video0' });
        if (shot.error) return shot;
        const enc = encodeImage(shot.path);
        if (enc.error) return { ...shot, error: enc.error };
        const res = await describeImage(cfg || {}, {
          imageBase64: enc.imageBase64, mimeType: enc.mime,
          prompt: prompt || 'Describe what this webcam photo shows in detail: people, objects, text, setting. Be concrete.',
          system: 'You are the eyes of a terminal AI agent. Describe images factually and precisely. Do not speculate beyond what is visible.',
        });
        if (res.error) return { photo: shot.path, backend: shot.backend, vision: res, note: 'photo captured, but understanding failed — see vision.error' };
        return {
          photo: shot.path, backend: shot.backend,
          vision: { description: res.description, model: `${res.provider} · ${res.model}` },
          description: res.description,
        };
      },
    },
    {
      name: 'vision.analyze',
      description: 'Understand an existing image file (photo, screenshot, downloaded image). Returns a description.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the image file (jpg/png; ~ and relative allowed)' },
          prompt: { type: 'string', description: 'Question about the image (default: full description)' },
        },
        required: ['path'],
      },
      async execute({ path: p, prompt }, { cfg } = {}) {
        const enc = encodeImage(p);
        if (enc.error) return enc;
        const res = await describeImage(cfg || {}, {
          imageBase64: enc.imageBase64, mimeType: enc.mime,
          prompt: prompt || 'Describe this image in detail: objects, people, text, layout, anything notable.',
          system: 'You are the eyes of a terminal AI agent. Describe images factually and precisely.',
        });
        return res.error ? res : {
          file: enc.path, bytes: enc.bytes,
          vision: { description: res.description, model: `${res.provider} · ${res.model}` },
          description: res.description,
        };
      },
    },
  ];
}
