/**
 * Euclidean rhythm: `hits` onsets spread as evenly as possible over `steps`
 * (Toussaint 2005). E(3, 8) is the tresillo `x..x..x.`.
 */
export function euclid(hits: number, steps: number, rotate = 0): boolean[] {
  const k = Math.max(0, Math.min(steps, Math.round(hits)));
  const out: boolean[] = [];
  for (let i = 0; i < steps; i++) {
    const j = (((i + rotate) % steps) + steps) % steps;
    out.push(k > 0 && (j * k) % steps < k);
  }
  return out;
}
