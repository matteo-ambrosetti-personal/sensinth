import { Rng } from '@sensinth/core';

/** Seconds of silence before the reverb answers, so the dry sound stays in front. */
const PRE_DELAY = 0.012;

/**
 * Stereo impulse response: a few early reflections, then decaying noise that
 * darkens toward the tail. Each side has its own noise and its own
 * reflections, so the room is wide.
 */
export function createImpulse(
  ctx: BaseAudioContext,
  seconds = 2.4,
  decay = 3,
  seed = 5,
): AudioBuffer {
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const pre = Math.min(length, Math.round(ctx.sampleRate * PRE_DELAY));
  for (let ch = 0; ch < 2; ch++) {
    const rng = new Rng(seed + ch * 7919);
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / Math.max(1, length - pre);
      const white = rng.next() * 2 - 1;
      // One-pole low-pass whose cutoff falls over time.
      const k = 0.85 - 0.72 * t;
      lp += (white - lp) * k;
      // The tail builds over the first hundredths of a second, then falls away.
      const build = Math.min(1, (i - pre) / (0.02 * ctx.sampleRate));
      data[i] = lp * build * Math.exp(-2.2 * decay * t) * Math.pow(1 - t, 0.5);
    }
    // Early reflections: a handful of taps in the first 80 ms, different on each side.
    for (let j = 0; j < 6; j++) {
      const at = pre + Math.round(ctx.sampleRate * (0.007 + rng.next() * 0.07));
      if (at < length) data[at] = (data[at] ?? 0) + (rng.next() < 0.5 ? -1 : 1) * (0.5 - j * 0.06);
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
