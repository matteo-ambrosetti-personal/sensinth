import { clamp } from '../math';
import { Rng } from '../random';

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'sh' | 'smooth';

export const LFO_SHAPES: readonly LfoShape[] = [
  'sine',
  'triangle',
  'saw',
  'square',
  'sh',
  'smooth',
];

export interface LfoSpec {
  shape: LfoShape;
  /** Steps per cycle when its rate is not modulated. */
  periodSteps: number;
  /** Output depth 0..1 when not modulated. */
  depth: number;
  /** Starting phase, 0..1. */
  phase: number;
  /** Seed for the random shapes. */
  seed: number;
}

/** Shortest and longest LFO cycle, in 16th steps. */
export const LFO_PERIOD_LIMITS: [number, number] = [2, 512];

/**
 * A tempo-synced low-frequency oscillator, advanced once per step. Its rate
 * and depth are themselves modulation destinations, so LFOs can modulate
 * each other.
 */
export class Lfo {
  private phase: number;
  private held: number;
  private prevHeld: number;
  private readonly rng: Rng;
  /** Output of the latest step, −1..1 (already scaled by depth). */
  value = 0;

  constructor(readonly spec: LfoSpec) {
    this.phase = clamp(spec.phase, 0, 0.999999);
    this.rng = new Rng(spec.seed);
    this.prevHeld = this.rng.next() * 2 - 1;
    this.held = this.rng.next() * 2 - 1;
    this.value = this.shape() * clamp(spec.depth);
  }

  /**
   * Advances one step. `rate` and `depth` are modulated values where 0.5
   * means "as specified": rate moves the period by up to two octaves either
   * way, depth adds to the specified depth.
   */
  advance(rate = 0.5, depth = 0.5): number {
    const [lo, hi] = LFO_PERIOD_LIMITS;
    const period = clamp(this.spec.periodSteps * Math.pow(2, (0.5 - clamp(rate)) * 4), lo, hi);
    this.phase += 1 / period;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.prevHeld = this.held;
      this.held = this.rng.next() * 2 - 1;
    }
    this.value = this.shape() * clamp(this.spec.depth + (clamp(depth) - 0.5));
    return this.value;
  }

  private shape(): number {
    const p = this.phase;
    switch (this.spec.shape) {
      case 'sine':
        return Math.sin(2 * Math.PI * p);
      case 'triangle':
        return 1 - 4 * Math.abs(p - 0.5);
      case 'saw':
        return 2 * p - 1;
      case 'square':
        return p < 0.5 ? 1 : -1;
      case 'sh':
        return this.held;
      case 'smooth': {
        const s = p * p * (3 - 2 * p);
        return this.prevHeld + (this.held - this.prevHeld) * s;
      }
    }
  }
}
