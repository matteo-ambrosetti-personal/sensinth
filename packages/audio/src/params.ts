import { clamp, expLerp, type Envelope, type TrackParams } from '@sensinth/core';

/** Default track filter range, Hz. */
export const DEFAULT_FILTER: [number, number] = [120, 18000];

/** Multiplier of `octaves` octaves either side of 0.5: 0 → 2^−o/2, 1 → 2^o/2. */
export function octaves(v: number, octaves: number): number {
  return Math.pow(2, (clamp(v) - 0.5) * octaves);
}

export function cutoffHz(v: number, range: [number, number] = DEFAULT_FILTER): number {
  return expLerp(range[0], range[1], clamp(v));
}

/** ±9 dB around the patch gain. */
export function levelGain(v: number): number {
  return Math.pow(10, ((clamp(v) - 0.5) * 18) / 20);
}

export function resonanceQ(v: number): number {
  const r = clamp(v);
  return 0.5 + r * r * 10;
}

/** Pan −1..1, kept off the extreme edges. */
export function panValue(v: number): number {
  return (clamp(v) - 0.5) * 1.8;
}

/** Send level for a track's reverb or delay send. */
export function sendGain(v: number): number {
  return clamp(v) * 2;
}

/** Attack and decay params stretch or shorten a patch's envelope, ±2 octaves. */
export function shapeEnvelope(env: Envelope, p: Readonly<TrackParams>): Envelope {
  const attack = octaves(p.attack, 4);
  const decay = octaves(p.decay, 4);
  return { a: env.a * attack, d: env.d * decay, s: env.s, r: env.r * decay };
}
