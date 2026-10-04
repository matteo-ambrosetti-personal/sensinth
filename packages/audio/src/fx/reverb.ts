import { Rng } from '@sensinth/core';

/** Stereo impulse response: decaying noise, slightly darker toward the tail. */
export function createImpulse(
  ctx: BaseAudioContext,
  seconds = 2.4,
  decay = 3,
  seed = 5,
): AudioBuffer {
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const rng = new Rng(seed);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const white = rng.next() * 2 - 1;
      // One-pole low-pass whose cutoff falls over time.
      const k = 0.9 - 0.75 * t;
      lp += (white - lp) * k;
      data[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}

/** Soft-clip curve: never exceeds ±0.95, roughly linear for quiet signals. */
export function createSoftClipCurve(drive = 1, size = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  const norm = Math.tanh(drive);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = (0.95 * Math.tanh(drive * x)) / norm;
  }
  return curve;
}
