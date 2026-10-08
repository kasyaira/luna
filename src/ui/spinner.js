// Luna — spinner (braille frames, zero deps, non-TTY safe)
import { ansi, clearLine } from '../util/ansi.js';
import { setInterval as interval, clearInterval } from 'node:timers';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  constructor(stream = process.stderr) {
    this.stream = stream;
    this.frame = 0;
    this.timer = null;
    this.label = '';
    this.active = false;
  }

  start(label) {
    if (!this.stream.isTTY) {
      if (label) this.stream.write(`${ansi.dim(`… ${label}`)}\n`);
      return;
    }
    this.label = label || '';
    this.active = true;
    this.timer = interval(() => this.tick(), 90);
    this.tick();
  }

  tick() {
    if (!this.active) return;
    const f = FRAMES[this.frame % FRAMES.length];
    this.frame++;
    clearLine(this.stream);
    this.stream.write(`${ansi.magenta(f)} ${ansi.dim(this.label.slice(0, 60))}`);
  }

  update(label) {
    this.label = label || this.label;
    if (!this.stream.isTTY && label) this.stream.write(`${ansi.dim(`… ${label.slice(0, 60)}`)}\n`);
  }

  stop(finalWord) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.active = false;
    clearLine(this.stream);
    if (finalWord && this.stream.isTTY) this.stream.write(`${ansi.dim(finalWord)}\n`);
  }
}

export function nl(n = 1) { process.stdout.write('\n'.repeat(n)); }
