import { Rng } from '@sensinth/core';

/**
 * One second of seeded noise held at a lower rate, which gives the gritty,
 * slightly pitched character of 8-bit noise channels.
 */
export function createNoiseBuffer(ctx: BaseAudioContext, holdHz = 16000, seed = 99): AudioBuffer {
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = new Rng(seed);
  const hold = Math.max(1, Math.round(ctx.sampleRate / holdHz));
  let v = 0;
  for (let i = 0; i < length; i++) {
    if (i % hold === 0) v = rng.next() * 2 - 1;
    data[i] = v;
  }
  return buffer;
}

/**
 * Vinyl surface noise: faint hiss with sparse clicks and pops, meant to loop.
 */
export function createCrackleBuffer(ctx: BaseAudioContext, seconds = 3, seed = 31): AudioBuffer {
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = new Rng(seed);
  const clicksPerSecond = 9;
  const p = clicksPerSecond / ctx.sampleRate;
  for (let i = 0; i < length; i++) {
    data[i] = (data[i] ?? 0) + (rng.next() - 0.5) * 0.04;
    if (rng.next() < p) {
      const amp = (0.25 + 0.75 * rng.next()) * (rng.next() < 0.5 ? -1 : 1);
      for (let k = 0; k < 24 && i + k < length; k++) {
        data[i + k] = (data[i + k] ?? 0) + amp * Math.exp(-k / 4) * (k % 2 === 0 ? 1 : -0.6);
      }
    }
  }
  return buffer;
}
