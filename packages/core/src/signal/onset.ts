import { Ema } from './ema';

export interface OnsetOptions {
  /** Novelty above which an onset fires. */
  threshold?: number;
  /** Novelty below which the detector re-arms (hysteresis). */
  rearm?: number;
  /** Minimum seconds between onsets. */
  refractory?: number;
  /** Seconds for the baseline the novelty is measured against. */
  baselineTau?: number;
}

/**
 * Detects sudden rises (shakes, claps, flashes) in a 0..1 signal. Novelty is
 * the value minus its slow baseline; an onset fires on a rising crossing of
 * `threshold`, with hysteresis and a refractory period against chatter.
 * Returns the onset strength (0..1), or 0 when nothing fired.
 */
export class OnsetDetector {
  private readonly baseline: Ema;
  private armed = true;
  private sinceLast = Infinity;
  private readonly threshold: number;
  private readonly rearm: number;
  private readonly refractory: number;

  constructor(opts: OnsetOptions = {}) {
    this.threshold = opts.threshold ?? 0.2;
    this.rearm = opts.rearm ?? 0.08;
    this.refractory = opts.refractory ?? 0.15;
    this.baseline = new Ema(opts.baselineTau ?? 0.6);
  }

  update(x: number, dt: number): number {
    const base = this.baseline.value ?? x;
    const novelty = x - base;
    this.baseline.update(x, dt);
    this.sinceLast += dt;
    if (!this.armed && novelty < this.rearm) this.armed = true;
    if (this.armed && novelty > this.threshold && this.sinceLast >= this.refractory) {
      this.armed = false;
      this.sinceLast = 0;
      return Math.min(1, novelty / (1 - Math.min(0.99, base)));
    }
    return 0;
  }
}
