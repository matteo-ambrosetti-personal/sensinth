/**
 * Voices a chord (pitch classes) inside [lo, hi], moving as little as
 * possible from the previous voicing. Candidates are every inversion, stacked
 * upward, at every octave that fits.
 */
export function voiceChord(
  pcs: readonly number[],
  lo: number,
  hi: number,
  prev?: readonly number[],
): number[] {
  const candidates: number[][] = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = lo; base < lo + 12; base++) {
      if ((((base - (order[0] as number)) % 12) + 12) % 12 !== 0) continue;
      for (let start = base; start <= hi; start += 12) {
        const v: number[] = [start];
        for (let i = 1; i < order.length; i++) {
          let n = v[i - 1] as number;
          do n++;
          while ((((n - (order[i] as number)) % 12) + 12) % 12 !== 0);
          v.push(n);
        }
        if ((v[v.length - 1] as number) <= hi) candidates.push(v);
      }
    }
  }
  if (candidates.length === 0) {
    // Range too narrow for any stacked voicing: each note at its lowest place
    // in the range, which keeps every chord tone and stays inside [lo, hi].
    return pcs
      .map((pc) => {
        const n = lo + ((((pc - lo) % 12) + 12) % 12);
        return n <= hi ? n : n - 12;
      })
      .sort((a, b) => a - b);
  }
  const center = (lo + hi) / 2;
  let best = candidates[0] as number[];
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = prev && prev.length > 0 ? movement(prev, c) : Math.abs(mean(c) - center);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
    }
  }
  return best;
}

function mean(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Total distance from each new note to the nearest previous note, plus a small drift penalty. */
function movement(prev: readonly number[], next: readonly number[]): number {
  let cost = 0;
  for (const n of next) {
    let d = Infinity;
    for (const p of prev) d = Math.min(d, Math.abs(n - p));
    cost += d;
  }
  return cost + 0.25 * Math.abs(mean(next) - mean(prev));
}
