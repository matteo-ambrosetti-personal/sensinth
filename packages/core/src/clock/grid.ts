export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;

/** Seconds per 16th-note step. */
export function stepDuration(bpm: number): number {
  return 60 / bpm / STEPS_PER_BEAT;
}

/**
 * Delay for the off-beat 16ths. `swing` 0.5 is straight; 0.66 is a
 * triplet shuffle.
 */
export function swingOffset(step: number, swing: number, stepSeconds: number): number {
  return step % 2 === 1 ? (swing - 0.5) * 2 * stepSeconds : 0;
}

/** Metric weight of a step within the bar: 1 on the downbeat down to 0.15 on off-16ths. */
export function beatStrength(stepInBar: number): number {
  const s = ((stepInBar % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  if (s === 0) return 1;
  if (s === 8) return 0.85;
  if (s % 4 === 0) return 0.7;
  if (s % 2 === 0) return 0.4;
  return 0.15;
}

export function isStrongBeat(stepInBar: number): boolean {
  return stepInBar % STEPS_PER_BEAT === 0;
}
