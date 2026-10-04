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
