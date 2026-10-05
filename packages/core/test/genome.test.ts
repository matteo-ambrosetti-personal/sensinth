import { describe, expect, it } from 'vitest';
import {
  Fingerprinter,
  Rng,
  SensorHub,
  buildGenome,
  defaultMacros,
  fingerprintChange,
  firstChain,
  hashInts,
  lofi,
  mutatePhrase,
  nextChain,
  type Fingerprint,
  type Genome,
} from '../src';

const CHANNELS = [
  { id: 'light', kind: 'light' },
  { id: 'tilt', kind: 'orientation.pitch' },
  { id: 'temp', kind: 'temperature' },
];

/** A hub whose channels have settled on the given 0..1 values. */
function settled(values: Record<string, number>): SensorHub {
  const hub = new SensorHub();
  for (const c of CHANNELS) {
    hub.announce({ ...c, label: c.id, range: [0, 1], adaptive: false, rateHz: 30 });
  }
  for (let i = 0; i < 300; i++) {
    for (const c of CHANNELS) hub.push({ id: c.id, t: i / 30, v: values[c.id] ?? 0.5 });
  }
  return hub;
}

function print(values: Record<string, number>, fpr = new Fingerprinter()): Fingerprint {
  return fpr.take(settled(values).list());
}

function genomeFor(fp: Fingerprint, chain = firstChain(0, fp)): Genome {
  return buildGenome(lofi, fp, chain, 0, defaultMacros());
}

/** Fraction of the steps holding a trig in either genome where the trigs differ. */
function trigDifference(a: Genome, b: Genome): number {
  let same = 0;
  let total = 0;
  a.tracks.forEach((t, i) => {
    const u = b.tracks[i];
    if (!u) return;
    const n = Math.max(t.length, u.length);
    for (let s = 0; s < n; s++) {
      if (!t.trigs[s] && !u.trigs[s]) continue;
      total++;
      if (JSON.stringify(t.trigs[s] ?? null) === JSON.stringify(u.trigs[s] ?? null)) same++;
    }
  });
  return 1 - same / total;
}

describe('Fingerprint', () => {
  it('is the same for the same readings', () => {
    const a = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    const b = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    expect(a.coarseHash).toBe(b.coarseHash);
    expect(a.fineHash).toBe(b.fineHash);
  });

  it('keeps its coarse hash for small moves and changes the fine hash', () => {
    const a = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    const b = print({ light: 0.31, tilt: 0.6, temp: 0.4 });
    expect(b.coarseHash).toBe(a.coarseHash);
    expect(b.fineHash).not.toBe(a.fineHash);
  });

  it('changes its coarse hash when a reading moves far', () => {
    const a = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    const b = print({ light: 0.8, tilt: 0.6, temp: 0.4 });
    expect(b.coarseHash).not.toBe(a.coarseHash);
  });

  it('does not flicker for a value sitting on a bin edge', () => {
    const fpr = new Fingerprinter();
    const edge = 1 / 6;
    const a = print({ light: edge - 0.01, tilt: 0.6, temp: 0.4 }, fpr);
    const b = print({ light: edge + 0.02, tilt: 0.6, temp: 0.4 }, fpr);
    expect(b.coarseHash).toBe(a.coarseHash);
  });

  it('calls a scene change on a new light, not on a tilt or noise', () => {
    const base = print({ light: 0.2, tilt: 0.5, temp: 0.4 });
    const lighter = print({ light: 0.9, tilt: 0.5, temp: 0.4 });
    const tilted = print({ light: 0.2, tilt: 1, temp: 0.4 });
    const noisy = print({ light: 0.23, tilt: 0.5, temp: 0.41 });
    expect(fingerprintChange(base, lighter).distance).toBeGreaterThan(0.35);
    expect(fingerprintChange(base, lighter).channel?.id).toBe('light');
    expect(fingerprintChange(base, tilted).distance).toBe(0);
    expect(fingerprintChange(base, noisy).distance).toBeLessThan(0.1);
  });

  it('calls a scene change when a sensor appears or vanishes', () => {
    const all = print({ light: 0.2, tilt: 0.5, temp: 0.4 });
    const fewer = { ...all, channels: all.channels.slice(1) };
    expect(fingerprintChange(all, fewer).distance).toBe(1);
    expect(fingerprintChange(fewer, all).distance).toBe(1);
  });
});

describe('Genome', () => {
  it('is the same for the same fingerprint and chain', () => {
    const fp = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    expect(genomeFor(fp)).toEqual(genomeFor(fp));
  });

  it('is rewritten when one reading crosses a coarse bin', () => {
    const a = genomeFor(print({ light: 0.3, tilt: 0.6, temp: 0.4 }));
    const b = genomeFor(print({ light: 0.3, tilt: 0.6, temp: 0.9 }));
    expect(trigDifference(a, b)).toBeGreaterThan(0.6);
  });

  it('never repeats from one section to the next, even with frozen readings', () => {
    const fp = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    let chain = firstChain(0, fp);
    const seen = new Set<string>();
    for (let section = 0; section < 12; section++) {
      const g = buildGenome(lofi, fp, chain, section, defaultMacros());
      seen.add(JSON.stringify(g.tracks.map((t) => t.trigs)));
      chain = nextChain(chain, fp, section + 1);
    }
    expect(seen.size).toBe(12);
  });

  it('keeps machines while the coarse fingerprint stays', () => {
    const fp = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    const a = genomeFor(fp, 1);
    const b = genomeFor(fp, 2);
    expect(b.tracks.map((t) => t.machine)).toEqual(a.tracks.map((t) => t.machine));
    expect(trigDifference(a, b)).toBeGreaterThan(0.6);
  });

  it('mutates differently when a reading differs only slightly', () => {
    const a = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    const b = print({ light: 0.305, tilt: 0.6, temp: 0.4 });
    const chain = 77;
    const ga = genomeFor(a, chain);
    const gb = genomeFor(a, chain);
    mutatePhrase(ga, new Rng(hashInts(chain, 4, a.fineHash)), 0.8);
    mutatePhrase(gb, new Rng(hashInts(chain, 4, b.fineHash)), 0.8);
    expect(ga).not.toEqual(gb);
  });

  it('mutates every phrase', () => {
    const fp = print({ light: 0.3, tilt: 0.6, temp: 0.4 });
    const g = genomeFor(fp);
    const before = JSON.stringify(g);
    const changes = mutatePhrase(g, new Rng(5), 0);
    expect(changes.length + (JSON.stringify(g) !== before ? 1 : 0)).toBeGreaterThan(0);
  });
});
