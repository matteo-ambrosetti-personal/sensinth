import { clamp } from '../math';

/** Lowest and highest growth rate: the logistic map is chaotic over most of this range. */
export const CHAOS_R: [number, number] = [3.57, 4];

/**
 * The logistic map x ← r·x·(1−x), iterated once per step. In its chaotic
 * range two starting points that differ in the tenth decimal end up
 * unrelated after a few dozen steps, so the tiniest difference in the sensor
 * that sets `r` (or the starting point) changes the music.
 */
export class LogisticMap {
  x: number;
  private steps = 0;

  constructor(start: number) {
    this.x = LogisticMap.sanitize(start, 0);
  }

  /** One iteration with `r` given as 0..1 over `CHAOS_R`. Returns x in (0, 1). */
  step(r01: number): number {
    const r = CHAOS_R[0] + (CHAOS_R[1] - CHAOS_R[0]) * clamp(r01);
    this.steps++;
    this.x = LogisticMap.sanitize(r * this.x * (1 - this.x), this.steps);
    return this.x;
  }

  /** 0 and 1 are absorbing points of the map (and NaN never recovers); nudge away from them. */
  private static sanitize(x: number, salt: number): number {
    if (!Number.isFinite(x) || x <= 1e-9 || x >= 1 - 1e-9) {
      const frac = (((Math.sin(salt * 12.9898 + 78.233) * 43758.5453) % 1) + 1) % 1;
      return 0.1 + 0.8 * frac;
    }
    return x;
  }
}
