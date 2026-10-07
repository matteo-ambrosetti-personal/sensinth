import { describe, expect, it } from 'vitest';
import {
  Engine,
  Fingerprinter,
  Rng,
  STEPS_PER_BAR,
  STYLES,
  SensorHub,
  SimulatedSource,
  anchorSteps,
  buildGenome,
  chiptune,
  cloneGenome,
  defaultMacros,
  driftOf,
  evolveGenome,
  genomeDistance,
  hashInts,
  lofi,
  mutatePhrase,
  nextChain,
  stepDuration,
  techno,
  type Fingerprint,
  type Genome,
  type Style,
} from '../src';

function fingerprint(seed = 3): Fingerprint {
  const s = new SimulatedSource(seed);
  const hub = new SensorHub();
  for (const d of s.descriptors) hub.announce(d);
  for (let i = 0; i < 40; i++) hub.pushAll(s.sampleAt(i * 0.05));
  return new Fingerprinter().take(hub.list());
}

/** A lineage of `n` genomes under frozen sensors, each evolved from the one before. */
function lineage(style: Style, n: number, rate = 0.16): Genome[] {
  const fp = fingerprint();
  let chain = 1;
  const out = [buildGenome(style, fp, chain, 0, defaultMacros())];
  for (let i = 1; i < n; i++) {
    chain = nextChain(chain, fp, i);
    const fresh = buildGenome(style, fp, chain, i, defaultMacros());
    const { genome } = evolveGenome(out[i - 1] as Genome, fresh, new Rng(hashInts(chain, 7)), {
      rate,
      drift: driftOf(style),
      palette: style.palette,
    });
    out.push(genome);
  }
  return out;
}

describe('Genome distance', () => {
  it('is 0 for a genome against itself, symmetric and inside 0..1', () => {
    const [a, , , b] = lineage(chiptune, 4);
    const ga = a as Genome;
    const gb = b as Genome;
    expect(genomeDistance(ga, cloneGenome(ga)).total).toBe(0);
    const ab = genomeDistance(ga, gb).total;
    expect(ab).toBeGreaterThan(0);
    expect(ab).toBeLessThanOrEqual(1);
    expect(genomeDistance(gb, ga).total).toBeCloseTo(ab, 9);
  });

  it('counts a slot that holds another kind of track as a different track', () => {
    const g = lineage(chiptune, 1)[0] as Genome;
    const other = cloneGenome(g);
    const t = other.tracks[0];
    if (t) t.role = t.role === 'drum' ? 'lead' : 'drum';
    const d = genomeDistance(g, other);
    expect(d.tracks.find((x) => x.slot === t?.slot)?.value).toBe(1);
  });
});

describe('Evolution', () => {
  it('moves a little each section and keeps moving away from where it started', () => {
    for (const style of [chiptune, lofi, techno]) {
      const line = lineage(style, 48);
      const first = line[0] as Genome;
      const d = line.map((g) => genomeDistance(first, g).total);
      expect(d[1]).toBeLessThan(0.35);
      // The average over the last sections is well past the first few.
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(d.slice(-8))).toBeGreaterThan(mean(d.slice(1, 5)) + 0.04);
      // No big leaps from one section to the next.
      for (let i = 1; i < line.length; i++) {
        expect(genomeDistance(line[i - 1] as Genome, line[i] as Genome).total).toBeLessThan(0.4);
      }
    }
  });

  it('keeps patterns playable: densities in bounds, anchors in place', () => {
    for (const style of STYLES) {
      for (const g of lineage(style, 24)) {
        for (const t of g.tracks) {
          if (t.role === 'fx' || t.role === 'drone') continue;
          const machine = style.palette.machines[t.machine];
          if (!machine) continue;
          const on = t.trigs.slice(0, t.length).filter(Boolean).length;
          expect(on).toBeGreaterThan(0);
          expect(on / t.length).toBeLessThanOrEqual(
            Math.min(1, Math.max(machine.density[1] * 1.2, 0.75)) + 1 / t.length,
          );
          if (t.rhythm === 'four')
            for (let i = 0; i < t.length; i += 4) expect(t.trigs[i]).toBeDefined();
        }
      }
    }
  });

  it('is the same for the same inputs', () => {
    const a = lineage(lofi, 12).map((g) => JSON.stringify(g));
    const b = lineage(lofi, 12).map((g) => JSON.stringify(g));
    expect(a).toEqual(b);
  });

  it('goes further for a new scene than for a section', () => {
    const fp = fingerprint();
    const g = buildGenome(chiptune, fp, 1, 0, defaultMacros());
    const fresh = buildGenome(chiptune, fp, 2, 1, defaultMacros());
    const o = { drift: driftOf(chiptune), palette: chiptune.palette };
    const section = evolveGenome(g, fresh, new Rng(5), { ...o, rate: 0.16 }).genome;
    const scene = evolveGenome(g, fresh, new Rng(5), { ...o, rate: 0.65 }).genome;
    expect(genomeDistance(g, scene).total).toBeGreaterThan(genomeDistance(g, section).total);
  });
});

describe('Phrase mutation', () => {
  it('never touches the FX lane routes and keeps four on the floor on the beat', () => {
    const fp = fingerprint();
    const g = buildGenome(techno, fp, 11, 0, defaultMacros());
    const kick = g.tracks.find((t) => t.rhythm === 'four');
    expect(kick).toBeDefined();
    const rng = new Rng(3);
    for (let i = 0; i < 500; i++) mutatePhrase(g, rng, 1, techno.palette);
    for (const r of g.matrix.routes) expect(r.dest.startsWith('fx.')).toBe(false);
    const k = kick as NonNullable<typeof kick>;
    expect(k.length % 4).toBe(0);
    for (let i = 0; i < k.length; i += 4) expect(k.trigs[i]).toBeDefined();
    expect(anchorSteps(k).size).toBeGreaterThanOrEqual(k.length / 4);
  });

  it('makes the changes it counts', () => {
    const fp = fingerprint();
    const g = buildGenome(chiptune, fp, 21, 0, defaultMacros());
    const rng = new Rng(9);
    let total = 0;
    for (let i = 0; i < 50; i++) total += mutatePhrase(g, rng, 0.3, chiptune.palette).length;
    // 1 + round(0.3 × 4) = 2 per phrase, nearly always found.
    expect(total).toBeGreaterThanOrEqual(95);
  });
});

describe('Engine drift', () => {
  function play(style: Style, bars: number) {
    const s = new SimulatedSource(3);
    const values = s.sampleAt(0);
    const engine = new Engine({ style });
    for (const d of s.descriptors) engine.hub.announce(d);
    const dt = stepDuration(style.defaultTempo);
    const views = [];
    for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
      engine.hub.pushAll(values.map((x) => ({ ...x, t: step * dt })));
      engine.tick(dt);
      if (step % STEPS_PER_BAR === 0) views.push(engine.view());
    }
    return { engine, views };
  }

  it('reports how far the music has come, bar by bar', () => {
    const { views } = play(chiptune, 80);
    const last = views.at(-1);
    expect(last?.drift.history.length).toBe(80);
    expect(last?.drift.total).toBeGreaterThan(0);
    expect(views[0]?.drift.total).toBe(0);
    expect(last?.drift.marks.filter((m) => m.reason === 'section').length).toBe(4);
    expect(last?.partition.level).toBe('all');
  });

  it('hands out views that later steps do not change', () => {
    const { engine, views } = play(chiptune, 8);
    const before = JSON.stringify(views[4]);
    const dt = stepDuration(chiptune.defaultTempo);
    for (let i = 0; i < 16 * STEPS_PER_BAR; i++) engine.tick(dt);
    expect(JSON.stringify(views[4])).toBe(before);
  });
});
