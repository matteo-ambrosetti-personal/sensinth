import { describe, expect, it } from 'vitest';
import {
  DOMAINS,
  Engine,
  FINAL_BARS,
  STEPS_PER_BAR,
  STYLES,
  SimulatedSource,
  Rng,
  chooseSection,
  defaultMacros,
  planBars,
  sectionBars,
  sensorShares,
  stepDuration,
  type EngineView,
  type NoteEvent,
  type PieceLog,
  type SectionKind,
  type Style,
} from '../src';

interface Piece {
  seconds: number;
  bars: number;
  view: EngineView;
  log: PieceLog;
  /** Events of every bar. */
  byBar: NoteEvent[][];
  /** Slots that rested, per bar. */
  resting: string[][];
  inScale: boolean;
}

/** Plays one whole piece from simulated sensors, to its last bar of silence. */
function playPiece(
  style: Style,
  sensorSeed = 3,
  seed = 0,
  bpm = style.defaultTempo,
  /** How fast the simulated sensors move: 1 as written, less for calmer surroundings. */
  pace = 1,
): Piece {
  const engine = new Engine({ style, seed, form: {} });
  const sensors = new SimulatedSource(sensorSeed);
  for (const d of sensors.descriptors) engine.hub.announce(d);
  const dt = stepDuration(bpm);
  const byBar: NoteEvent[][] = [];
  const resting: string[][] = [];
  let inScale = true;
  let step = 0;
  for (; !engine.ended && step < 400 * STEPS_PER_BAR; step++) {
    engine.hub.pushAll(sensors.sampleAt(step * dt * pace).map((x) => ({ ...x, t: step * dt })));
    const events = engine.tick(dt);
    if (step % STEPS_PER_BAR === 0) {
      byBar.push([]);
      resting.push([...(engine.view().form?.resting ?? [])]);
    }
    (byBar[byBar.length - 1] as NoteEvent[]).push(...events);
    const scale = engine.scale;
    for (const ev of events) {
      if (ev.midi === undefined || !scale) continue;
      const blue = ev.role === 'lead';
      if (!scale.contains(ev.midi) && !blue) inScale = false;
    }
  }
  // The piece is known to be over one step into the bar after its silence.
  if (byBar[byBar.length - 1]?.length === 0 && step % STEPS_PER_BAR === 1) {
    byBar.pop();
    resting.pop();
  }
  const log = engine.pieceLog() as PieceLog;
  return {
    seconds: step * dt,
    bars: byBar.length,
    view: engine.view(),
    log,
    byBar,
    resting,
    inScale,
  };
}

describe('a piece has a form', () => {
  it.each(STYLES.map((s) => [s.id, s] as const))(
    '%s: an intro, sections, an outro and an end, in three to five minutes',
    (_id, style) => {
      const p = playPiece(style);
      const form = p.view.form;
      expect(form?.ended).toBe(true);
      const kinds = (form?.sections ?? []).map((s) => s.kind);
      expect(kinds[0]).toBe('intro');
      expect(kinds[1]).toBe('riff');
      expect(kinds[kinds.length - 1]).toBe('outro');
      expect(kinds.filter((k) => k === 'intro')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'outro')).toHaveLength(1);
      // A middle of several different sections.
      expect(kinds.length).toBeGreaterThanOrEqual(5);
      expect(new Set(kinds.slice(1, -1)).size).toBeGreaterThanOrEqual(2);
      expect(p.seconds).toBeGreaterThanOrEqual(175);
      expect(p.seconds).toBeLessThanOrEqual(305);
      // Sections follow one another without a gap.
      const sections = form?.sections ?? [];
      sections.forEach((s, i) => {
        if (i > 0) {
          const prev = sections[i - 1] as (typeof sections)[number];
          expect(s.startBar).toBe(prev.startBar + prev.bars);
        }
      });
      const last = sections[sections.length - 1] as (typeof sections)[number];
      expect(p.bars).toBe(last.startBar + last.bars + FINAL_BARS);
      expect(p.inScale).toBe(true);
    },
  );

  it('ends on one chord, then silence', () => {
    const p = playPiece(STYLES[1] as Style);
    const final = p.byBar[p.bars - FINAL_BARS] as NoteEvent[];
    const silence = p.byBar[p.bars - 1] as NoteEvent[];
    expect(final.length).toBeGreaterThan(0);
    expect(new Set(final.map((e) => e.step)).size).toBe(1);
    expect(silence).toHaveLength(0);
  });

  it('brings the band in over the intro and lets it go over the outro', () => {
    for (const style of STYLES) {
      const p = playPiece(style);
      const sections = p.view.form?.sections ?? [];
      const intro = sections[0] as (typeof sections)[number];
      const outro = sections[sections.length - 1] as (typeof sections)[number];
      const playing = (bar: number) =>
        new Set((p.byBar[bar] as NoteEvent[]).map((e) => e.part)).size;
      const riffBar = intro.bars + 1;
      expect(playing(0) + playing(1), `${style.id}: first bars`).toBeGreaterThan(0);
      expect(p.resting[0]?.length ?? 0, `${style.id}: someone waits`).toBeGreaterThan(0);
      expect(p.resting[0]?.length ?? 0).toBeGreaterThanOrEqual(p.resting[riffBar]?.length ?? 0);
      const lastOutro = outro.startBar + outro.bars - 1;
      expect(p.resting[lastOutro]?.length ?? 0, `${style.id}: outro thins`).toBeGreaterThan(
        p.resting[outro.startBar]?.length ?? 0,
      );
      // Someone stays to the end (a held pad may have started its note bars before).
      const outroNotes = p.byBar.slice(outro.startBar, lastOutro + 1).flat().length;
      expect(outroNotes, `${style.id}: someone stays`).toBeGreaterThan(0);
    }
  });

  it('a resting track plays nothing', () => {
    const p = playPiece(STYLES[2] as Style);
    p.byBar.slice(0, -FINAL_BARS).forEach((events, bar) => {
      const rest = new Set(p.resting[bar]);
      for (const e of events) if (!e.fx) expect(rest.has(e.part), `bar ${bar}`).toBe(false);
    });
  });

  it('other sensors, another piece; the same sensors, the same piece', () => {
    const style = STYLES[3] as Style;
    const a = playPiece(style, 3);
    const b = playPiece(style, 3);
    const c = playPiece(style, 11);
    const shape = (p: Piece) =>
      (p.view.form?.sections ?? []).map((s) => `${s.kind}${s.bars}`).join();
    const notes = (p: Piece) =>
      p.byBar
        .flat()
        .map((e) => `${e.step}:${e.part}:${e.midi ?? ''}`)
        .join();
    expect(shape(a)).toBe(shape(b));
    expect(notes(a)).toBe(notes(b));
    expect(notes(a)).not.toBe(notes(c));
  });

  it('the voice sings the same line when it comes back', () => {
    // Find a piece with two voice sections and compare the featured track's first bar.
    for (const style of STYLES) {
      for (const seed of [3, 5, 8, 13]) {
        const p = playPiece(style, seed, 0, style.defaultTempo, 0.03);
        const voices = (p.view.form?.sections ?? []).filter(
          (s) => s.kind === 'voice' && s.featured,
        );
        if (voices.length < 2) continue;
        const [a, b] = voices as [(typeof voices)[number], (typeof voices)[number]];
        if (a.featured?.slot !== b.featured?.slot) continue;
        // A new scene between them gives the voice a new line.
        const all = p.view.form?.sections ?? [];
        const between = all.slice(all.indexOf(a) + 1, all.indexOf(b) + 1);
        if (between.some((s) => s.chosenBy?.why === 'moved')) continue;
        const rhythm = (s: typeof a) =>
          (p.byBar[s.startBar] as NoteEvent[])
            .filter((e) => e.part === s.featured?.slot)
            .map((e) => e.step % STEPS_PER_BAR)
            .join();
        expect(rhythm(a).length).toBeGreaterThan(0);
        expect(rhythm(b)).toBe(rhythm(a));
        return;
      }
    }
    throw new Error('no piece with two voice sections found');
  });
});

describe('the record of a piece', () => {
  it('says what each sensor did, bar by bar', () => {
    const p = playPiece(STYLES[4] as Style);
    const { log } = p;
    expect(log.complete).toBe(true);
    expect(log.sections.map((s) => s.kind)).toEqual(p.view.form?.sections.map((s) => s.kind));
    expect(log.sensors.length).toBeGreaterThan(3);
    for (const s of log.sensors) {
      expect(s.level.length).toBe(log.bars);
      for (const d of DOMAINS) expect(s.influence[d].length).toBe(log.bars);
      const sum = DOMAINS.reduce((a, d) => a + s.total[d], 0);
      expect(Number.isFinite(sum)).toBe(true);
      // A sensor only moves the domains of the areas it holds, the dials it drives aside.
    }
    const shares = sensorShares(log);
    expect(shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 5);
    expect(shares[0]?.share ?? 0).toBeGreaterThan(0);
    // Somebody chose a section, and it is on their record.
    const chosen = log.sections.filter((s) => s.chosenBy);
    expect(chosen.length).toBeGreaterThan(0);
    const marks = log.sensors.flatMap((s) => s.marks);
    expect(marks.some((m) => m.what === 'section')).toBe(true);
  });
});

describe('planning', () => {
  it('a piece plans three to five minutes at any tempo', () => {
    for (const bpm of [60, 72, 96, 120, 140, 172, 200]) {
      const bar = stepDuration(bpm) * STEPS_PER_BAR;
      for (const pick of [0, 0.5, 1]) {
        const seconds = planBars(bar, pick) * bar;
        expect(seconds).toBeGreaterThanOrEqual(178);
        expect(seconds).toBeLessThanOrEqual(300);
      }
    }
  });

  it('sections last whole units', () => {
    for (const kind of ['intro', 'riff', 'voice', 'solo', 'break', 'outro'] as SectionKind[]) {
      for (const bar of [1.4, 2, 2.5, 3.3]) {
        expect(sectionBars(kind, bar, 4) % 4).toBe(0);
        const chorus = sectionBars(kind, bar, 12);
        expect(chorus % (kind === 'riff' || kind === 'voice' || kind === 'solo' ? 12 : 4)).toBe(0);
      }
    }
  });

  it('busy sensors bring the riff back, calm ones a break, restless ones a solo', () => {
    const count = (macros: Partial<ReturnType<typeof defaultMacros>>) => {
      const out: Record<string, number> = {};
      for (let i = 0; i < 400; i++) {
        const k = chooseSection({
          history: ['intro', 'riff', 'voice', 'riff', 'voice'],
          barsLeft: 40,
          macros: { ...defaultMacros(), ...macros },
          rng: new Rng(i),
        });
        out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    };
    expect(count({ energy: 0.95 }).riff ?? 0).toBeGreaterThan(count({ energy: 0.05 }).riff ?? 0);
    expect(count({ energy: 0.05 }).break ?? 0).toBeGreaterThan(count({ energy: 0.95 }).break ?? 0);
    expect(count({ variation: 0.95 }).solo ?? 0).toBeGreaterThan(
      count({ variation: 0.05 }).solo ?? 0,
    );
    expect(
      chooseSection({ history: ['intro'], barsLeft: 40, macros: defaultMacros(), rng: new Rng(1) }),
    ).toBe('riff');
    expect(
      chooseSection({
        history: ['intro', 'riff'],
        barsLeft: 0,
        macros: defaultMacros(),
        rng: new Rng(1),
      }),
    ).toBe('outro');
  });
});
