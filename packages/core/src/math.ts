export function clamp(x: number, min = 0, max = 1): number {
  return x < min ? min : x > max ? max : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Exponential interpolation, for frequencies and other perceptual ranges. */
export function expLerp(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, t);
}

/** Smoothing coefficient for a one-pole filter with time constant `tau` seconds. */
export function onePoleAlpha(dt: number, tau: number): number {
  if (tau <= 0) return 1;
  return 1 - Math.exp(-Math.max(0, dt) / tau);
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
