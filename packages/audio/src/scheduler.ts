import { stepDuration } from '@sensinth/core';

export interface SchedulerOptions {
  /** Seconds of audio scheduled ahead of the playhead. */
  lookahead?: number;
  /** Timer period in milliseconds. */
  interval?: number;
}

/**
 * Calls `fn` every `ms` milliseconds; the function returned stops it. The
 * ticks come from a worker where there are workers: a page's own timers
 * slow to one a second (or less) once its tab is in the background, a
 * worker's do not, and the music has to keep time behind other windows.
 */
function ticker(ms: number, fn: () => void): () => void {
  let fallback: ReturnType<typeof setInterval> | undefined;
  const plain = () => (fallback ??= setInterval(fn, ms));
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    plain();
    return () => clearInterval(fallback);
  }
  let worker: Worker | undefined;
  let url: string | undefined;
  try {
    url = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }),
    );
    worker = new Worker(url);
    worker.onmessage = fn;
    // A page that may not start workers (a strict content policy) keeps time by itself.
    worker.onerror = () => {
      worker?.terminate();
      worker = undefined;
      plain();
    };
  } catch {
    plain();
  }
  return () => {
    worker?.terminate();
    if (url) URL.revokeObjectURL(url);
    if (fallback !== undefined) clearInterval(fallback);
  };
}

/**
 * Lookahead scheduler ("a tale of two clocks"): a coarse JS timer wakes up
 * often and schedules every step that falls within the next `lookahead`
 * seconds on the precise audio clock.
 */
export class LookaheadScheduler {
  /**
   * Called once per step with its audio-clock time. After a stall, `skipped`
   * says how many steps were jumped over, so the music's own clock can jump too.
   */
  onStep: (step: number, time: number, stepSeconds: number, skipped: number) => void = () => {};
  private step = 0;
  private nextTime = 0;
  /** Steps jumped over and not yet reported. */
  private skipped = 0;
  private stepSeconds = stepDuration(120);
  private timer: (() => void) | undefined;
  private lookahead: number;
  private readonly interval: number;

  constructor(
    private readonly clock: { readonly currentTime: number },
    opts: SchedulerOptions = {},
  ) {
    this.lookahead = opts.lookahead ?? 0.12;
    this.interval = opts.interval ?? 25;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  start(bpm: number, delay = 0.08): void {
    this.stop();
    this.setTempo(bpm);
    this.step = 0;
    this.skipped = 0;
    this.nextTime = this.clock.currentTime + delay;
    this.timer = ticker(this.interval, () => this.pump());
    this.pump();
  }

  /**
   * Seconds of audio scheduled ahead. More is safer where the page is woken
   * less often (in the background), at the price of answering later.
   */
  setLookahead(seconds: number): void {
    this.lookahead = Math.max(0.05, seconds);
  }

  /** Takes effect from the next unscheduled step. */
  setTempo(bpm: number): void {
    this.stepSeconds = stepDuration(Math.min(300, Math.max(20, bpm)));
  }

  stop(): void {
    this.timer?.();
    this.timer = undefined;
  }

  /** Schedules all steps due within the lookahead window. */
  pump(): void {
    const now = this.clock.currentTime;
    // After a stall (background tab, slow device), skip ahead instead of
    // flooding the output with late notes: whole steps, so the count and the
    // grid stay in time with the audio clock.
    if (this.nextTime < now - 0.25) {
      const n = Math.ceil((now + 0.05 - this.nextTime) / this.stepSeconds);
      this.nextTime += n * this.stepSeconds;
      this.step += n;
      this.skipped += n;
    }
    while (this.nextTime < now + this.lookahead) {
      const skipped = this.skipped;
      this.skipped = 0;
      this.onStep(this.step, this.nextTime, this.stepSeconds, skipped);
      this.nextTime += this.stepSeconds;
      this.step++;
    }
  }
}
