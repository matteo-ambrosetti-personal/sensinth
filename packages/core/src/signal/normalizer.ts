import { clamp, onePoleAlpha } from '../math';

export interface NormalizerOptions {
  /** Known physical range. With `adaptive: false` it is used as-is. */
  range?: readonly [number, number];
  /** Track the observed range over time (default: true when no range is given). */
  adaptive?: boolean;
  /** Seconds for the bounds to relax back toward recent values. */
  relaxTau?: number;
  /** Smallest span (raw units) ever mapped to the full 0..1 range, so noise at rest stays small. */
  minSpan?: number;
  /** Floor for the span as a fraction of the widest span seen so far. */
  minSpanRatio?: number;
}

/**
 * Maps a raw value of unknown unit and range to 0..1.
 * Bounds expand instantly to include new extremes and relax slowly back
 * toward recent values, so the output keeps using the whole range.
 */
export class AdaptiveNormalizer {
  private lo: number | undefined;
  private hi: number | undefined;
  private maxSpanSeen = 0;
  private lastOutput = 0.5;
  private readonly adaptive: boolean;
  private readonly relaxTau: number;
  private readonly minSpan: number;
  private readonly minSpanRatio: number;
  private readonly range: readonly [number, number] | undefined;

  constructor(opts: NormalizerOptions = {}) {
    this.range = opts.range;
    this.adaptive = opts.adaptive ?? opts.range === undefined;
    this.relaxTau = opts.relaxTau ?? 60;
    this.minSpan = opts.minSpan ?? 0;
    this.minSpanRatio = opts.minSpanRatio ?? 0.1;
    if (opts.range) {
      this.lo = opts.range[0];
      this.hi = opts.range[1];
      this.maxSpanSeen = Math.abs(opts.range[1] - opts.range[0]);
    }
  }

  update(x: number, dt: number): number {
    if (!Number.isFinite(x)) return this.lastOutput;
    if (!this.adaptive && this.range) {
      const [a, b] = this.range;
      this.lastOutput = b === a ? 0.5 : clamp((x - a) / (b - a));
      return this.lastOutput;
    }
    if (this.lo === undefined || this.hi === undefined) {
      this.lo = x;
      this.hi = x;
    }
    // Relax toward the current value, then expand to include it.
    const k = onePoleAlpha(dt, this.relaxTau);
    this.lo += (x - this.lo) * k;
    this.hi += (x - this.hi) * k;
    if (x < this.lo) this.lo = x;
    if (x > this.hi) this.hi = x;

    const span = this.hi - this.lo;
    this.maxSpanSeen = Math.max(this.maxSpanSeen, span);
    const floor = Math.max(this.minSpan, this.maxSpanSeen * this.minSpanRatio, 1e-9);
    if (span < floor) {
      // Too little movement to trust: center the window on the bounds' midpoint.
      const mid = (this.lo + this.hi) / 2;
      this.lastOutput = clamp(0.5 + (x - mid) / floor);
    } else {
      this.lastOutput = clamp((x - this.lo) / span);
    }
    return this.lastOutput;
  }
}
