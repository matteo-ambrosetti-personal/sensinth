import { stepDuration } from '@sensinth/core';

export interface SchedulerOptions {
  /** Seconds of audio scheduled ahead of the playhead. */
  lookahead?: number;
  /** Timer period in milliseconds. */
  interval?: number;
}

/**
 * Lookahead scheduler ("a tale of two clocks"): a coarse JS timer wakes up
 * often and schedules every step that falls within the next `lookahead`
 * seconds on the precise audio clock.
 */
export class LookaheadScheduler {
  /** Called once per step with its audio-clock time. */
  onStep: (step: number, time: number, stepSeconds: number) => void = () => {};
  private step = 0;
  private nextTime = 0;
  private stepSeconds = stepDuration(120);
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly lookahead: number;
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
    this.nextTime = this.clock.currentTime + delay;
    this.timer = setInterval(() => this.pump(), this.interval);
    this.pump();
  }

  /** Takes effect from the next unscheduled step. */
  setTempo(bpm: number): void {
    this.stepSeconds = stepDuration(Math.min(300, Math.max(20, bpm)));
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Schedules all steps due within the lookahead window. */
  pump(): void {
    const now = this.clock.currentTime;
    // After a stall (background tab, slow device), skip ahead instead of
    // flooding the output with late notes.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    while (this.nextTime < now + this.lookahead) {
      this.onStep(this.step, this.nextTime, this.stepSeconds);
      this.nextTime += this.stepSeconds;
      this.step++;
    }
  }
}
