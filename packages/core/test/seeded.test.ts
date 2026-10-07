import { describe, expect, it } from 'vitest';
import {
  Engine,
  INPUT_ROWS,
  INSTRUMENT_EFFECTS,
  InputMapper,
  KEY_EFFECTS,
  LOOP_BARS,
  ReplaySource,
  STEPS_PER_BAR,
  STYLES,
  SensorHub,
  SensorRecorder,
  chiptune,
  keyCodeIndex,
  keyEffect,
  lofi,
  minimal,
  stepDuration,
  techno,
  zoneOf,
  type DeterministicOptions,
  type NoteEvent,
  type SensorDescriptor,
  type SensorEvent,
  type SensorSample,
  type Style,
} from '../src';

const KEYS: SensorDescriptor = {
  id: 'computer.keys',
  kind: 'keys.rate',
  label: 'Typing',
  range: [0, 15],
  rateHz: 30,
};
const TILT: SensorDescriptor = {
  id: 'mac.pitch',
  kind: 'orientation.pitch',
  label: 'Tilt forward–back',
  range: [-90, 90],
  rateHz: 50,
};
const LIGHT: SensorDescriptor = {
  id: 'mac.light',
  kind: 'light',
  label: 'Light',
  range: [0, 10000],
  adaptive: true,
  minSpan: 30,
  rateHz: 2,
};

/** A key pressed at a time. */
const key = (code: string, t: number): SensorEvent => ({
  id: KEYS.id,
  t,
  kind: 'key',
  value: keyCodeIndex(code),
  velocity: 0.8,
});

interface Script {
  descriptors?: readonly SensorDescriptor[];
  /** Readings at a time (called every 0.05 s). */
  sampleAt?: (t: number) => SensorSample[];
  presses?: readonly SensorEvent[];
  /** Called after every step with its notes. */
  onStep?: (events: readonly NoteEvent[], engine: Engine) => void;
}

interface Take {
  events: NoteEvent[];
  /** The song version at the start of each bar. */
  versions: string[];
  /** The key (pitch class) at the start of each bar. */
  keys: (number | undefined)[];
  engine: Engine;
}

/** Plays a script in deterministic mode, feeding readings and presses in time order. */
function take(
  style: Style,
  bars: number,
  opts: Omit<DeterministicOptions, 'origin'>,
  script: Script = {},
): Take {
  const hub = new SensorHub();
  for (const d of [KEYS, ...(script.descriptors ?? [])]) hub.announce(d);
  const engine = new Engine({ style, hub, deterministic: { ...opts, origin: 0 } });
  const dt = stepDuration(style.defaultTempo);
  const presses = [...(script.presses ?? [])].sort((a, b) => a.t - b.t);
  const out: Take = { events: [], versions: [], keys: [], engine };
  let sampleT = 0;
  for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
    const t = step * dt;
    for (; sampleT <= t; sampleT = Math.round((sampleT + 0.05) * 1000) / 1000) {
      hub.pushAll(script.sampleAt?.(sampleT) ?? []);
      while (presses.length > 0 && (presses[0] as SensorEvent).t <= sampleT) {
        hub.emit(presses.shift() as SensorEvent);
      }
    }
    const events = engine.tick(dt);
    script.onStep?.(events, engine);
    out.events.push(...events);
    if (step % STEPS_PER_BAR === 0) {
      out.versions.push(engine.view().song?.version ?? '');
      out.keys.push(engine.key);
    }
  }
  engine.dispose();
  return out;
}

/** The notes of bars [from, to), with steps counted from `from`. */
function bars(events: readonly NoteEvent[], from: number, to: number): string[] {
  const lo = from * STEPS_PER_BAR;
  const hi = to * STEPS_PER_BAR;
  return events
    .filter((e) => e.step >= lo && e.step < hi)
    .map((e) => JSON.stringify({ ...e, step: e.step - lo }));
}

/** Seconds at the middle of a bar. */
const midBar = (style: Style, bar: number) =>
  (bar + 0.5) * STEPS_PER_BAR * stepDuration(style.defaultTempo);

describe('Deterministic songs', () => {
  it('loop exactly while nothing changes, in every style and loop length', () => {
    for (const style of STYLES) {
      for (const loopBars of [2, 8]) {
        const t = take(style, loopBars * 3, { seed: 42, loopBars });
        const first = bars(t.events, 0, loopBars);
        expect(first.length, `${style.id} ${loopBars}`).toBeGreaterThan(5);
        expect(bars(t.events, loopBars, 2 * loopBars), `${style.id} ${loopBars}`).toEqual(first);
        expect(bars(t.events, 2 * loopBars, 3 * loopBars), `${style.id} ${loopBars}`).toEqual(
          first,
        );
      }
    }
  });

  it('play from the first step with no sensor, the same every time', () => {
    const a = take(lofi, 4, { seed: 7, loopBars: 4 });
    const b = take(lofi, 4, { seed: 7, loopBars: 4 });
    expect(a.events.filter((e) => e.step < STEPS_PER_BAR).length).toBeGreaterThan(0);
    expect(b.events).toEqual(a.events);
    expect(a.versions.every((v) => v === 'base')).toBe(true);
  });

  it('let the seed pick the song', () => {
    const songs = [1, 2, 3, 4].map((seed) =>
      bars(take(techno, 2, { seed, loopBars: 2 }).events, 0, 2),
    );
    expect(new Set(songs.map((s) => s.join())).size).toBe(songs.length);
  });

  it('turn into a new song at the bar after a press, which then loops', () => {
    const loopBars = 4;
    const base = take(chiptune, 16, { seed: 42, loopBars });
    const edited = take(
      chiptune,
      16,
      { seed: 42, loopBars },
      { presses: [key('KeyQ', midBar(chiptune, 1))] },
    );
    // Unchanged until the press is read, at the start of bar 2.
    expect(bars(edited.events, 0, 2)).toEqual(bars(base.events, 0, 2));
    expect(edited.versions[1]).toBe('base');
    expect(edited.versions[2]).not.toBe('base');
    expect(bars(edited.events, 2, 4)).not.toEqual(bars(base.events, 2, 4));
    // From then on the new song loops exactly.
    expect(bars(edited.events, 8, 12)).toEqual(bars(edited.events, 4, 8));
    expect(bars(edited.events, 12, 16)).toEqual(bars(edited.events, 4, 8));
  });

  it('sound the same at the same point of the loop whenever the press came', () => {
    const loopBars = 4;
    const early = take(
      lofi,
      12,
      { seed: 3, loopBars },
      { presses: [key('KeyA', midBar(lofi, 0))] },
    );
    const late = take(lofi, 12, { seed: 3, loopBars }, { presses: [key('KeyA', midBar(lofi, 2))] });
    expect(late.versions[8]).toBe(early.versions[8]);
    expect(bars(late.events, 8, 12)).toEqual(bars(early.events, 8, 12));
    // Already in the bar after the late press, mid-loop.
    expect(bars(late.events, 3, 4)).toEqual(bars(early.events, 3, 4));
  });

  it('toggle: a second press undoes the first, and order does not matter', () => {
    const o = { seed: 42, loopBars: 4, repeat: 'toggle' } as const;
    const base = take(chiptune, 12, o);
    const twice = take(chiptune, 12, o, {
      presses: [key('KeyA', midBar(chiptune, 1)), key('KeyA', midBar(chiptune, 4))],
    });
    expect(twice.versions[3]).not.toBe('base');
    expect(twice.versions[8]).toBe('base');
    expect(bars(twice.events, 8, 12)).toEqual(bars(base.events, 8, 12));
    const as = take(chiptune, 8, o, {
      presses: [key('KeyA', midBar(chiptune, 0)), key('KeyO', midBar(chiptune, 1))],
    });
    const sa = take(chiptune, 8, o, {
      presses: [key('KeyO', midBar(chiptune, 0)), key('KeyA', midBar(chiptune, 1))],
    });
    expect(sa.versions[4]).toBe(as.versions[4]);
    expect(bars(sa.events, 4, 8)).toEqual(bars(as.events, 4, 8));
  });

  it('accumulate: every press moves the song on', () => {
    const o = { seed: 42, loopBars: 4, repeat: 'accumulate' } as const;
    const presses = [1, 2, 3].map((b) => key('KeyO', midBar(chiptune, b)));
    const t = take(chiptune, 6, o, { presses });
    const [v1, v2, v3] = [t.versions[2], t.versions[3], t.versions[4]];
    expect(new Set(['base', v1, v2, v3]).size).toBe(4);
    // O moves the key up a fifth each time.
    const k0 = t.keys[0] as number;
    expect(t.keys[2]).toBe((k0 + 7) % 12);
    expect(t.keys[3]).toBe((k0 + 14) % 12);
  });

  it('once: only the first press counts', () => {
    const o = { seed: 42, loopBars: 4, repeat: 'once' } as const;
    const one = take(chiptune, 8, o, { presses: [key('KeyR', midBar(chiptune, 0))] });
    const three = take(chiptune, 8, o, {
      presses: [0, 1, 2].map((b) => key('KeyR', midBar(chiptune, b))),
    });
    expect(three.versions[4]).toBe(one.versions[4]);
    expect(bars(three.events, 4, 8)).toEqual(bars(one.events, 4, 8));
  });

  it('give every key one fixed effect, whatever the seed', () => {
    expect(keyEffect(keyCodeIndex('KeyO'))).toEqual(KEY_EFFECTS.KeyO);
    expect(keyEffect(keyCodeIndex('KeyA'))).toEqual({ id: 'rotate', target: 1, dir: 1 });
    // Any other key still has one, always the same.
    expect(keyEffect(keyCodeIndex('F13'))).toEqual(keyEffect(keyCodeIndex('F13')));
    for (const seed of [1, 99, 12345]) {
      const t = take(lofi, 4, { seed, loopBars: 2 }, { presses: [key('KeyO', midBar(lofi, 0))] });
      expect(t.keys[2]).toBe(((t.keys[0] as number) + 7) % 12);
      expect(t.engine.view().song?.edits.map((e) => e.effect.id)).toEqual(['fifth']);
    }
  });

  it('read continuous sensors in zones: noise changes nothing, coming back restores the song', () => {
    const o = { seed: 42, loopBars: 4, sensors: 'zones' } as const;
    const dt = STEPS_PER_BAR * stepDuration(chiptune.defaultTempo);
    // Flat with a little noise, tilted forward for bars 4–7, then flat again.
    const tilt = (t: number): SensorSample[] => {
      const bar = t / dt;
      const angle = bar >= 4 && bar < 8 ? 60 : 3 * Math.sin(t * 7);
      return [{ id: TILT.id, t, v: angle }];
    };
    const base = take(chiptune, 16, o);
    const tilted = take(chiptune, 16, o, { descriptors: [TILT], sampleAt: tilt });
    expect(tilted.versions.slice(0, 5).every((v) => v === 'base')).toBe(true);
    expect(tilted.versions[5]).not.toBe('base');
    expect(tilted.keys[5]).toBe(((tilted.keys[0] as number) + 14) % 12);
    expect(tilted.versions[12]).toBe('base');
    expect(bars(tilted.events, 12, 16)).toEqual(bars(base.events, 12, 16));
  });

  it('combine a sensor and a key, whatever came first', () => {
    const o = { seed: 42, loopBars: 4, sensors: 'zones' } as const;
    // The light is dark at Play, then turns bright: zones count from where a sensor started.
    const brightAfter =
      (at: number) =>
      (t: number): SensorSample[] => [{ id: LIGHT.id, t, v: t > at ? 3000 : 0 }];
    const keyThenLight = take(chiptune, 8, o, {
      descriptors: [LIGHT],
      sampleAt: brightAfter(midBar(chiptune, 1)),
      presses: [key('KeyW', midBar(chiptune, 0))],
    });
    const lightThenKey = take(chiptune, 8, o, {
      descriptors: [LIGHT],
      sampleAt: brightAfter(midBar(chiptune, 0)),
      presses: [key('KeyW', midBar(chiptune, 1))],
    });
    const lightOnly = take(chiptune, 8, o, {
      descriptors: [LIGHT],
      sampleAt: brightAfter(midBar(chiptune, 0)),
    });
    const keyOnly = take(chiptune, 8, o, { presses: [key('KeyW', midBar(chiptune, 0))] });
    const both = keyThenLight.versions[4];
    expect(lightThenKey.versions[4]).toBe(both);
    expect(new Set([both, lightOnly.versions[4], keyOnly.versions[4], 'base']).size).toBe(4);
    expect(bars(lightThenKey.events, 4, 8)).toEqual(bars(keyThenLight.events, 4, 8));
  });

  it('count steps along the way in steps mode', () => {
    const o = { seed: 42, loopBars: 4, sensors: 'steps', repeat: 'accumulate' } as const;
    const dt = STEPS_PER_BAR * stepDuration(chiptune.defaultTempo);
    const tilt = (t: number): SensorSample[] => {
      const bar = t / dt;
      return [{ id: TILT.id, t, v: bar >= 2 && bar < 4 ? 60 : 0 }];
    };
    const t = take(chiptune, 8, o, { descriptors: [TILT], sampleAt: tilt });
    // Two zones up, then two back down: four steps, not back where it started.
    expect(t.versions[1]).toBe('base');
    expect(t.versions[3]).not.toBe('base');
    expect(t.versions[6]).not.toBe('base');
    expect(t.versions[6]).not.toBe(t.versions[3]);
    expect(t.engine.view().song?.edits[0]?.count).toBe(4);
  });

  it('keep every note in the scale, whatever is pressed', () => {
    // Every key but the mutes, which would silence everything.
    const codes = Object.keys(KEY_EFFECTS).filter((c) => KEY_EFFECTS[c]?.id !== 'mute');
    for (const style of STYLES) {
      const presses = codes.map((c, i) => key(c, 0.3 + i * 0.37));
      const outside: string[] = [];
      const t = take(
        style,
        24,
        { seed: 5, loopBars: 8, repeat: 'accumulate' },
        {
          presses,
          onStep: (events, engine) => {
            const scale = engine.scale;
            for (const e of events) {
              if (e.midi === undefined || !scale || scale.contains(e.midi)) continue;
              // Blue notes: a lead may bend to the key's ♭3 or ♭5 on a weak step.
              const rel = (((e.midi - (engine.key ?? 0)) % 12) + 12) % 12;
              if (e.role === 'lead' && e.step % 2 === 1 && (rel === 3 || rel === 6)) continue;
              outside.push(`${e.part}@${e.step}:${e.midi}`);
            }
          },
        },
      );
      expect(t.events.length, style.id).toBeGreaterThan(50);
      expect(outside, style.id).toEqual([]);
      for (const e of t.events) {
        expect(Number.isFinite(e.vel) && e.vel > 0 && e.vel <= 1, style.id).toBe(true);
        expect(e.durSteps, style.id).toBeGreaterThan(0);
      }
    }
  });

  it('replays a recording with presses to the identical piece', () => {
    const hub = new SensorHub();
    hub.announce(KEYS);
    hub.announce(TILT);
    const recorder = new SensorRecorder();
    recorder.start(hub);
    for (let i = 0; i < 60; i++) {
      const t = i * 0.1;
      hub.push({ id: TILT.id, t, v: i < 30 ? 0 : 50 });
      if (i % 10 === 5) hub.emit(key(i % 20 === 5 ? 'KeyA' : 'KeyO', t));
    }
    const rec = recorder.stop();
    expect(rec.events?.length).toBe(6);
    const replayed = () => {
      const replay = new ReplaySource(rec, { loop: false, idPrefix: '' });
      return take(
        chiptune,
        8,
        { seed: 9, loopBars: 4 },
        {
          descriptors: replay.descriptors,
          sampleAt: (t) => replay.samplesUntil(t),
          presses: new ReplaySource(rec, { loop: false, idPrefix: '' }).eventsUntil(100),
        },
      );
    };
    const a = replayed();
    const b = replayed();
    expect(a.versions[7]).not.toBe('base');
    expect(b.events).toEqual(a.events);
  });

  it('keep the seed’s instruments when they may not change', () => {
    const o = { seed: 42, loopBars: 4 };
    const presses = [key('Backspace', midBar(lofi, 0)), key('Enter', midBar(lofi, 0))];
    const free = take(lofi, 4, o, { presses });
    const fixed = take(lofi, 4, { ...o, instruments: false }, { presses });
    const machines = (t: { engine: Engine }) =>
      t.engine.trackMachines().map((m) => `${m.slot}:${m.machine}`);
    const base = take(lofi, 4, o);
    expect(machines(free)).not.toEqual(machines(base));
    expect(machines(fixed)).toEqual(machines(base));
    expect(fixed.versions.every((v) => v === 'base')).toBe(true);
    // Keys without an effect of their own never pick one that changes instruments.
    const mapper = new InputMapper({ instruments: false });
    for (let v = 1000; v < 2000; v++) {
      const e = mapper.press({ id: KEYS.id, t: 0, kind: 'key', value: v, velocity: 1 }, KEYS.kind);
      expect(e && INSTRUMENT_EFFECTS.has(e.effect.id)).toBeFalsy();
    }
    // A sensor given areas whose effects change instruments takes another of their effects.
    for (let i = 0; i < 40; i++) {
      const d: SensorDescriptor = {
        id: `y.${i}`,
        kind: 'pointer.y',
        label: 'Y',
        range: [0, 1],
        rateHz: 30,
      };
      const m = mapper.sensor(d, 'medium', ['motion']);
      expect(m && !INSTRUMENT_EFFECTS.has(m.map.effect.id), d.id).toBe(true);
    }
  });

  it('give inputs the effects you choose, and their own repeat', () => {
    const o = { seed: 42, loopBars: 4 };
    // O off: nothing happens.
    const off = take(
      chiptune,
      4,
      { ...o, mapping: { 'key:KeyO': { effect: 'none' } } },
      {
        presses: [key('KeyO', midBar(chiptune, 0))],
      },
    );
    expect(off.versions.every((v) => v === 'base')).toBe(true);
    // The number row rotates instead of muting: 2 now does what S does.
    const rotate = { 'keys:mute': { effect: { id: 'rotate', dir: 1 } } } as const;
    const two = take(
      chiptune,
      4,
      { ...o, mapping: rotate },
      {
        presses: [key('Digit2', midBar(chiptune, 0))],
      },
    );
    const s = take(chiptune, 4, o, { presses: [key('KeyS', midBar(chiptune, 0))] });
    expect(two.engine.view().song?.edits[0]?.effect).toEqual({ id: 'rotate', target: 2, dir: 1 });
    expect(bars(two.events, 2, 4)).toEqual(bars(s.events, 2, 4));
    // O adds up while every other key toggles.
    const twice = [key('KeyO', midBar(chiptune, 0)), key('KeyO', midBar(chiptune, 1))];
    const toggled = take(chiptune, 4, o, { presses: twice });
    const added = take(
      chiptune,
      4,
      { ...o, mapping: { 'key:KeyO': { repeat: 'accumulate' } } },
      {
        presses: twice,
      },
    );
    expect(toggled.versions[3]).toBe('base');
    expect(added.engine.view().song?.edits[0]?.count).toBe(2);
    expect(added.keys[3]).toBe(((added.keys[0] as number) + 14) % 12);
  });

  it('let one sensor act in steps while the others act by zone', () => {
    const dt = STEPS_PER_BAR * stepDuration(chiptune.defaultTempo);
    const tilt = (t: number): SensorSample[] => {
      const bar = t / dt;
      return [{ id: TILT.id, t, v: bar >= 2 && bar < 4 ? 60 : 0 }];
    };
    const o = {
      seed: 42,
      loopBars: 4,
      sensors: 'zones',
      mapping: { 'sensor:orientation.pitch': { sensors: 'steps', repeat: 'accumulate' } },
    } as const;
    const t = take(chiptune, 8, o, { descriptors: [TILT], sampleAt: tilt });
    expect(t.engine.view().song?.edits[0]?.count).toBe(4);
    expect(t.engine.view().song?.edits[0]?.zone).toBeUndefined();
  });

  it('lists every input once, with keys acting on tracks grouped', () => {
    const ids = INPUT_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const rotate = INPUT_ROWS.find((r) => r.id === 'keys:rotate');
    expect(rotate?.name).toBe('A–K');
    expect(rotate?.perTrack).toHaveLength(8);
    expect(INPUT_ROWS.find((r) => r.id === 'key:KeyO')?.effect).toEqual({ id: 'fifth' });
    expect(INPUT_ROWS.find((r) => r.id === 'sensor:orientation.pitch')?.continuous).toBe(true);
  });

  it('offers the loop lengths and keeps zones steady near an edge', () => {
    expect(LOOP_BARS).toEqual([2, 4, 8, 12, 16]);
    expect(zoneOf(0.41, undefined)).toBe(2);
    expect(zoneOf(0.385, 2)).toBe(2);
    expect(zoneOf(0.35, 2)).toBe(1);
  });

  it('sound the same on every pass of the loop, humanized timing and noise included', () => {
    const t = take(lofi, 8, { seed: 7, loopBars: 2 });
    const pass = (from: number) =>
      t.events
        .filter((e) => e.step >= from * STEPS_PER_BAR && e.step < (from + 2) * STEPS_PER_BAR)
        .map((e) => ({ ...e, step: 0 }));
    expect(pass(2)).toEqual(pass(4));
    expect(pass(4)).toEqual(pass(6));
    expect(t.events.every((e) => e.loopStep === e.step % (2 * STEPS_PER_BAR))).toBe(true);
  });

  it('catch up after the clock stalls, as if it never had', () => {
    const o = { seed: 3, loopBars: 4 };
    const press = key('KeyQ', midBar(chiptune, 5));
    const whole = take(chiptune, 8, o, { presses: [press] });
    // The same run, with 11 steps skipped in bar 2.
    const hub = new SensorHub();
    hub.announce(KEYS);
    const engine = new Engine({ style: chiptune, hub, deterministic: { ...o, origin: 0 } });
    const dt = stepDuration(chiptune.defaultTempo);
    const events: NoteEvent[] = [];
    let pressed = false;
    for (let step = 0; step < 8 * STEPS_PER_BAR; step++) {
      if (step === 2 * STEPS_PER_BAR + 3) {
        engine.skip(11, dt);
        step += 11;
      }
      if (!pressed && step * dt >= press.t) {
        hub.emit(press);
        pressed = true;
      }
      events.push(...engine.tick(dt));
    }
    engine.dispose();
    expect(bars(events, 3, 8)).toEqual(bars(whole.events, 3, 8));
  });

  it('hear the seed’s own song while sensors stay where they were at Play', () => {
    const o = { seed: 42, loopBars: 4, sensors: 'zones' } as const;
    const tilted = take(chiptune, 8, o, {
      descriptors: [TILT],
      sampleAt: (t) => [{ id: TILT.id, t, v: 60 }],
    });
    expect(tilted.versions.every((v) => v === 'base')).toBe(true);
    const off = take(
      chiptune,
      8,
      { ...o, sensors: 'off' },
      {
        descriptors: [TILT],
        sampleAt: (t) => [{ id: TILT.id, t, v: t > 1 ? 80 : -80 }],
      },
    );
    expect(off.versions.every((v) => v === 'base')).toBe(true);
  });

  it('keep a compass steady around north', () => {
    const HEADING: SensorDescriptor = {
      id: 'phone.heading',
      kind: 'heading',
      label: 'Compass',
      range: [0, 360],
      circular: true,
      rateHz: 20,
    };
    const t = take(
      chiptune,
      8,
      { seed: 42, loopBars: 4 },
      {
        descriptors: [HEADING],
        sampleAt: (time) => [
          { id: HEADING.id, t: time, v: Math.round(time * 20) % 2 === 0 ? 359 : 1 },
        ],
      },
    );
    expect(t.versions.every((v) => v === 'base')).toBe(true);
  });

  it('give every continuous sensor an effect when several sources share the areas', () => {
    const at = (d: SensorDescriptor, v: number) => ({ ...d, label: d.id, rateHz: 30, v });
    const pointer = [
      at(
        {
          id: 'computer.pointerSpeed',
          kind: 'pointer.speed',
          group: 'pointer',
          range: [0, 1],
        } as SensorDescriptor,
        0,
      ),
      at(
        {
          id: 'computer.pointerX',
          kind: 'pointer.x',
          group: 'pointer',
          range: [0, 1],
        } as SensorDescriptor,
        0.5,
      ),
      at(
        {
          id: 'computer.pointerY',
          kind: 'pointer.y',
          group: 'pointer',
          range: [0, 1],
        } as SensorDescriptor,
        0.5,
      ),
      at(
        {
          id: 'computer.force',
          kind: 'pointer.force',
          group: 'pointer',
          range: [0, 1],
        } as SensorDescriptor,
        0,
      ),
    ];
    const motion = [
      at(
        {
          id: 'phone.roll',
          kind: 'orientation.roll',
          group: 'motion',
          range: [-90, 90],
        } as SensorDescriptor,
        0,
      ),
      at(
        {
          id: 'phone.tilt',
          kind: 'orientation.pitch',
          group: 'motion',
          range: [-90, 90],
        } as SensorDescriptor,
        0,
      ),
      at(
        {
          id: 'phone.shake',
          kind: 'motion.accel',
          group: 'motion',
          range: [0, 30],
        } as SensorDescriptor,
        0,
      ),
    ];
    // Announced, but no fix yet: it can do nothing, so it takes nothing.
    const place = at(
      {
        id: 'phone.place',
        kind: 'geo.place',
        group: 'location',
        range: [0, 1],
      } as SensorDescriptor,
      0,
    );
    const live = [...pointer, ...motion];
    for (const instruments of [true, false]) {
      const t = take(
        chiptune,
        4,
        { seed: 42, loopBars: 4, instruments },
        {
          descriptors: [...live, place],
          sampleAt: (time) =>
            live.map((d) => ({
              id: d.id,
              t: time,
              v: d.id === 'computer.pointerY' && time > 1 ? 0.95 : d.v,
            })),
        },
      );
      const view = t.engine.view();
      const listed = view.song?.sensors.map((x) => x.id) ?? [];
      for (const id of ['computer.pointerX', 'computer.pointerY', 'phone.roll', 'phone.tilt']) {
        expect(listed, `${id}, instruments ${instruments}`).toContain(id);
      }
      const sharing = view.partition.groups.flatMap((g) => g.channels.map((c) => c.id)).sort();
      expect(sharing).toEqual([
        'computer.pointerX',
        'computer.pointerY',
        'phone.roll',
        'phone.tilt',
      ]);
      expect(
        t.versions.slice(1).some((v) => v !== 'base'),
        `instruments ${instruments}`,
      ).toBe(true);
    }
  });

  it('give number keys past the last track nothing to do', () => {
    let seed = 1;
    let tracks = 0;
    for (; seed < 200; seed++) {
      const probe = take(minimal, 1, { seed, loopBars: 2 });
      tracks = probe.engine.view().tracks.filter((x) => x.role !== 'fx').length;
      if (tracks < 6) break;
    }
    expect(tracks).toBeLessThan(6);
    const o = { seed, loopBars: 2 };
    const base = take(minimal, 6, o);
    const pressed = take(minimal, 6, o, { presses: [key('Digit6', midBar(minimal, 0))] });
    expect(bars(pressed.events, 2, 6)).toEqual(bars(base.events, 2, 6));
    expect(pressed.engine.view().song?.edits[0]?.description).toMatch(/no such track/);
  });

  it('show an edit as pending, with what it does, until the bar it lands on', () => {
    const o = { seed: 42, loopBars: 4 };
    const pendings: { step: number; pending: number; atBar?: number; text?: string }[] = [];
    const t = take(chiptune, 4, o, {
      presses: [key('KeyQ', midBar(chiptune, 0))],
      onStep: (_e, engine) => {
        const song = engine.view().song;
        const p = song?.pending[0];
        pendings.push({
          step: engine.snapshot().step,
          pending: song?.pending.length ?? 0,
          ...(p ? { atBar: p.atBar, ...(p.description ? { text: p.description } : {}) } : {}),
        });
      },
    });
    const waiting = pendings.filter((p) => p.pending > 0);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((p) => p.step < STEPS_PER_BAR && p.atBar === 1)).toBe(true);
    expect(waiting[0]?.text).toMatch(/^Rewrite T1 · /);
    expect(pendings.filter((p) => p.step >= STEPS_PER_BAR).every((p) => p.pending === 0)).toBe(
      true,
    );
    expect(t.engine.view().song?.edits[0]?.description).toMatch(/^Rewrite T1 · /);
  });

  it('evolve the same way every time, each generation looping exactly', () => {
    const o = { seed: 9, loopBars: 4, evolve: true };
    const a = take(lofi, 40, o);
    const b = take(lofi, 40, o);
    expect(a.events).toEqual(b.events);
    expect(a.versions[0]).toBe('base');
    expect(a.versions[16]).toBe('base.g1');
    expect(a.versions[32]).toBe('base.g2');
    expect(bars(a.events, 16, 20)).toEqual(bars(a.events, 20, 24));
    expect(bars(a.events, 16, 20)).not.toEqual(bars(a.events, 12, 16));
    // Evolve off: the seed's song all the way.
    const still = take(lofi, 40, { seed: 9, loopBars: 4 });
    expect(still.versions.every((v) => v === 'base')).toBe(true);
    // A press lands the same whenever it came, evolution or not.
    const early = take(lofi, 28, o, { presses: [key('KeyW', midBar(lofi, 17))] });
    const late = take(lofi, 28, o, { presses: [key('KeyW', midBar(lofi, 18))] });
    expect(bars(early.events, 20, 28)).toEqual(bars(late.events, 20, 28));
  });
});
