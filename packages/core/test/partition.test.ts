import { describe, expect, it } from 'vitest';
import {
  AREAS,
  DOMAINS,
  DOMAIN_AREAS,
  Fingerprinter,
  MACROS,
  MACRO_AREA,
  Router,
  SensorHub,
  SimulatedSource,
  buildGenome,
  chiptune,
  defaultMacros,
  domainOf,
  parseSensorSource,
  partitionAreas,
  sourceKind,
  destArea,
  type Area,
  type PartitionChannel,
  type SensorDescriptor,
} from '../src';

/** A few sources as the app announces them: one per group, several channels each. */
const MOTION: PartitionChannel[] = [
  { id: 'motion.accel', kind: 'motion.accel', group: 'motion', timescale: 'fast' },
  { id: 'motion.spin', kind: 'rotation.rate', group: 'motion', timescale: 'fast' },
  { id: 'motion.pitch', kind: 'orientation.pitch', group: 'motion', timescale: 'medium' },
  { id: 'motion.roll', kind: 'orientation.roll', group: 'motion', timescale: 'medium' },
];
const LIGHT: PartitionChannel[] = [
  { id: 'light.lux', kind: 'light', group: 'light', timescale: 'medium' },
];
const MIC: PartitionChannel[] = [
  { id: 'mic.level', kind: 'sound.level', group: 'mic', timescale: 'fast' },
  { id: 'mic.bright', kind: 'sound.brightness', group: 'mic', timescale: 'medium' },
];
const CLOCK: PartitionChannel[] = [
  { id: 'clock.daylight', kind: 'time.daylight', group: 'device', timescale: 'slow' },
];

function many(n: number): PartitionChannel[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `knob.${i}`,
    kind: 'midi.cc',
    group: `g${i}`,
    timescale: 'medium' as const,
  }));
}

describe('Partition', () => {
  it('gives one source every area, shared among its channels', () => {
    const p = partitionAreas(MOTION);
    expect(p.level).toBe('all');
    expect(p.groups).toEqual([{ group: 'motion', areas: [...AREAS] }]);
    const covered = new Set(Object.values(p.channels).flat());
    expect(covered.size).toBe(AREAS.length);
    for (const c of MOTION) expect(p.channels[c.id]?.length).toBeGreaterThan(0);
    // A single channel alone owns everything.
    expect(partitionAreas(LIGHT).channels['light.lux']).toEqual([...AREAS]);
  });

  it('splits whole domains among two to five sources, with nothing left out or shared', () => {
    for (const set of [
      [MOTION, LIGHT],
      [MOTION, LIGHT, MIC],
      [MOTION, LIGHT, MIC, CLOCK],
    ]) {
      const p = partitionAreas(set.flat());
      expect(p.level).toBe('domains');
      const all = p.groups.flatMap((g) => g.areas);
      expect(new Set(all).size).toBe(all.length);
      expect(new Set(all)).toEqual(new Set(AREAS));
      for (const g of p.groups) {
        expect(g.areas.length).toBeGreaterThan(0);
        // Whole domains only.
        for (const d of DOMAINS) {
          const has = DOMAIN_AREAS[d].filter((a) => g.areas.includes(a)).length;
          expect([0, 2]).toContain(has);
        }
      }
    }
  });

  it('splits single areas among six to ten sources, and shares them beyond', () => {
    const six = partitionAreas(many(6));
    expect(six.level).toBe('areas');
    const all = six.groups.flatMap((g) => g.areas);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(AREAS));
    const lots = partitionAreas(many(14));
    expect(lots.level).toBe('shared');
    for (const g of lots.groups) expect(g.areas.length).toBeGreaterThan(0);
    for (const a of AREAS) expect(lots.owners[a].length).toBeGreaterThan(0);
  });

  it('does not depend on the order channels come in, and gives every channel an area', () => {
    const set = [...MOTION, ...LIGHT, ...MIC, ...CLOCK];
    const a = partitionAreas(set);
    const b = partitionAreas([...set].reverse());
    expect(b).toEqual(a);
    for (const c of set) expect(a.channels[c.id]?.length).toBeGreaterThan(0);
  });

  it('gives sources the jobs that suit them', () => {
    const p = partitionAreas([...MOTION, ...LIGHT, ...MIC, ...CLOCK]);
    const domainsOfGroup = (g: string) =>
      new Set((p.groups.find((x) => x.group === g)?.areas ?? []).map(domainOf));
    expect(domainsOfGroup('motion').has('rhythm')).toBe(true);
    expect(domainsOfGroup('light').has('sound')).toBe(true);
    expect(domainsOfGroup('mic').has('space')).toBe(true);
    expect(domainsOfGroup('device').has('harmony')).toBe(true);
  });

  it('moves little when another source joins', () => {
    const before = partitionAreas([...MOTION, ...LIGHT, ...MIC]);
    const after = partitionAreas([...MOTION, ...LIGHT, ...MIC, ...CLOCK], undefined, before);
    let kept = 0;
    let total = 0;
    for (const g of before.groups) {
      const now = new Set(after.groups.find((x) => x.group === g.group)?.areas ?? []);
      total += g.areas.length;
      kept += g.areas.filter((a) => now.has(a)).length;
    }
    expect(kept / total).toBeGreaterThanOrEqual(0.6);
  });

  it('places every destination in an area', () => {
    const roles = new Map([
      ['t1', 'drum'],
      ['t2', 'bass'],
      ['t3', 'lead'],
    ]);
    const roleOf = (s: string) => roles.get(s);
    expect(destArea('t1.prob', roleOf)).toBe('rhythm.drums');
    expect(destArea('t3.tune', roleOf)).toBe('harmony.melody');
    expect(destArea('t2.cutoff', roleOf)).toBe('sound.tonal');
    expect(destArea('t1.decay', roleOf)).toBe('sound.drums');
    expect(destArea('g.swing', roleOf)).toBe('rhythm.groove');
    expect(destArea('g.tension', roleOf)).toBe('harmony.chords');
    expect(destArea('t2.sendReverb', roleOf)).toBe('space.room');
    expect(destArea('lfo:t1.rate', roleOf)).toBe('motion.lfo');
    expect(destArea('fx.prob', () => 'fx')).toBeUndefined();
  });
});

function hubWith(descs: readonly SensorDescriptor[], level = 0.5): SensorHub {
  const hub = new SensorHub();
  for (const d of descs) hub.announce(d);
  for (let i = 0; i < 40; i++) {
    hub.pushAll(descs.map((d) => ({ id: d.id, t: i * 0.05, v: level * 100 + (i % 3) })));
  }
  return hub;
}

const desc = (id: string, kind: string, group: string): SensorDescriptor => ({
  id,
  kind,
  label: id,
  group,
  range: [0, 100],
  rateHz: 20,
});

describe('Router with a partition', () => {
  it('drives every dial from a single sensor', () => {
    const d = [desc('only.light', 'light', 'light')];
    const hub = hubWith(d);
    const router = new Router(hub);
    const p = partitionAreas([
      { id: 'only.light', kind: 'light', group: 'light', timescale: 'medium' },
    ]);
    router.setPartition(p);
    const macros = new Set(router.getRoutes().macros.map((r) => r.macro));
    expect(macros).toEqual(new Set(MACROS));
  });

  it('lets each dial be driven only by the channels that own its area', () => {
    const d = [
      desc('m.accel', 'motion.accel', 'motion'),
      desc('l.lux', 'light', 'light'),
      desc('s.level', 'sound.level', 'mic'),
    ];
    const hub = hubWith(d);
    const router = new Router(hub);
    const p = partitionAreas(
      hub.list().map((c) => ({
        id: c.desc.id,
        kind: c.desc.kind,
        group: c.desc.group as string,
        timescale: c.timescale,
      })),
    );
    router.setPartition(p);
    const { macros, triggers } = router.getRoutes();
    for (const r of macros) expect(p.channels[r.channelId]).toContain(MACRO_AREA[r.macro]);
    for (const m of MACROS) expect(macros.some((r) => r.macro === m)).toBe(true);
    for (const t of triggers) {
      expect(p.channels[t.channelId]).toContain(
        t.trigger === 'accent' ? 'rhythm.drums' : 'rhythm.groove',
      );
    }
  });
});

describe('Router following a new share', () => {
  it('moves the dials to new owners even when the channels are the same', () => {
    const d = [desc('m.accel', 'motion.accel', 'motion'), desc('l.lux', 'light', 'light')];
    const hub = hubWith(d);
    const router = new Router(hub);
    const p = partitionAreas(
      hub.list().map((c) => ({
        id: c.desc.id,
        kind: c.desc.kind,
        group: c.desc.group as string,
        timescale: c.timescale,
      })),
    );
    router.setPartition(p);
    router.getRoutes();
    // The same channels (the same key), dealt the other way round.
    const swap = (id: string) => (id === 'm.accel' ? 'l.lux' : 'm.accel');
    const swapped = {
      ...p,
      channels: {
        'm.accel': p.channels['l.lux'] ?? [],
        'l.lux': p.channels['m.accel'] ?? [],
      } as typeof p.channels,
      owners: Object.fromEntries(
        Object.entries(p.owners).map(([a, ids]) => [a, ids.map(swap)]),
      ) as typeof p.owners,
    };
    router.setPartition(swapped);
    const { macros } = router.getRoutes();
    for (const r of macros) expect(swapped.channels[r.channelId]).toContain(MACRO_AREA[r.macro]);
  });
});

describe('Genome routes with a partition', () => {
  function genomeFor(descs: readonly SensorDescriptor[]) {
    const hub = hubWith(descs);
    const fp = new Fingerprinter().take(hub.list());
    return buildGenome(chiptune, fp, 1234, 0, defaultMacros());
  }

  it('keeps every sensor route inside the areas its channel owns, two strong ones at least', () => {
    const g = genomeFor([
      desc('m.accel', 'motion.accel', 'motion'),
      desc('l.lux', 'light', 'light'),
      desc('s.level', 'sound.level', 'mic'),
    ]);
    const roles = new Map(g.tracks.map((t) => [t.slot, t.role]));
    const strong = new Map<string, Set<string>>();
    for (const r of g.matrix.routes) {
      if (sourceKind(r.source) !== 'sensor') continue;
      const { channelId, feature } = parseSensorSource(r.source);
      const area = destArea(r.dest, (s) => roles.get(s)) as Area;
      expect(g.ownership[channelId]).toContain(area);
      if (feature !== 'jitter' && Math.abs(r.amount) >= 0.4) {
        strong.set(channelId, (strong.get(channelId) ?? new Set()).add(r.dest));
      }
    }
    for (const id of ['m.accel', 'l.lux', 's.level'])
      expect(strong.get(id)?.size).toBeGreaterThanOrEqual(2);
  });

  it('gives a sensor alone a route into every area there are tracks for', () => {
    const g = genomeFor([desc('l.lux', 'light', 'light')]);
    const sensor = g.matrix.routes.filter(
      (r) => r.source.startsWith('s:l.lux:') && !r.source.endsWith('jitter'),
    );
    expect(sensor.length).toBeGreaterThanOrEqual(8);
  });

  it('fires sensor effects only from channels that own the effects area', () => {
    const s = new SimulatedSource(4);
    const hub = new SensorHub();
    for (const d of s.descriptors)
      hub.announce({ ...d, group: d.id.endsWith('accel') ? 'motion' : 'sim' });
    for (let i = 0; i < 40; i++) hub.pushAll(s.sampleAt(i * 0.05));
    const fp = new Fingerprinter().take(hub.list());
    const g = buildGenome(chiptune, fp, 99, 0, defaultMacros());
    for (const t of g.fxTriggers) expect(g.ownership[t.channelId]).toContain('space.fx');
  });
});
