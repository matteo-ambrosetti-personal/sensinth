import type { NoteEvent } from './clock/events';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from './clock/grid';
import { Harmony, type HarmonyInputs } from './composer/harmony';
import { FX_IDS, FX_INFO, type FxId } from './fx/effects';
import { Fingerprinter, fingerprintChange, jitterOf, type Fingerprint } from './genome/fingerprint';
import { buildGenome, firstChain, nextChain, type Genome } from './genome/genome';
import { mutatePhrase } from './genome/mutate';
import { MACROS, type Macros, type Triggers } from './mapping/macros';
import { Router } from './mapping/router';
import { DEFAULT_MAPPING, mergeRules } from './mapping/rules';
import { clamp, lerp, mod } from './math';
import {
  ModMatrix,
  globalDest,
  macroSource,
  sensorSource,
  trackDest,
  type RouteView,
} from './mod/matrix';
import { TRACK_PARAMS, type GlobalParams, type TrackParams } from './mod/params';
import { Rng, hashInts } from './random';
import { Realizer, type HarmonyContext } from './seq/realize';
import { TrackRunner, type FiredTrig } from './seq/runner';
import type { TrackRole, TrackSpec, Trig } from './seq/types';
import { SensorHub, type ChannelState } from './sensors/hub';
import type { FxConfig, Machine, Style } from './styles/schema';
import type { Chord } from './theory/chords';
import type { ModeId, Scale } from './theory/scales';

export interface EngineOptions {
  style: Style;
  /** Salt for the hash chain; the sensors decide everything else. */
  seed?: number;
  /** Shared sensor hub; a new one is created if omitted. */
  hub?: SensorHub;
  /** Key (pitch class 0..11) to start in, e.g. from the current place. */
  keyRoot?: number;
}

/** Why the pattern was last rewritten. */
export type RebuildReason = 'start' | 'section' | 'scene' | 'style' | 'resume';

export interface EngineSnapshot {
  step: number;
  bar: number;
  beat: number;
  styleId: string;
  keyName: string;
  mode: ModeId;
  chord: Chord;
  chordRoman: string;
  chordName: string;
  macros: Readonly<Macros>;
  /** No live sensor: no music until one is on. */
  waiting: boolean;
  /** Sections since the music started. */
  section: number;
  /** Phrase within the section, from 0. */
  phrase: number;
  /** Short hex id of the current genome. */
  genome: string;
}

export interface TrackView {
  slot: string;
  role: TrackRole;
  machine: string;
  label: string;
  voice?: string;
  length: number;
  scale: number;
  trigs: readonly (Trig | undefined)[];
  /** Step reached on the latest tick, −1 before the first. */
  position: number;
  loop: number;
  /** Values on the latest tick (base or p-lock, plus modulation). */
  params: Readonly<TrackParams>;
  base: Readonly<TrackParams>;
  /** Velocity of the trig played on the latest tick, 0 if none. */
  fired: number;
}

export interface EngineView {
  snapshot: EngineSnapshot;
  tracks: TrackView[];
  routes: RouteView[];
  globals: Readonly<GlobalParams>;
  /** Swing in effect, 0.5 straight .. 0.66. */
  swing: number;
  rebuild: { reason: RebuildReason; channel?: string; step: number };
  /** Where the key came from. */
  keySource: 'place' | 'sensors' | 'colour';
  /** Changes made at the latest phrase start. */
  mutations: readonly string[];
}

/** Fingerprint distance that counts as a new scene. */
const SCENE_DISTANCE = 0.35;
/** Steps the distance must hold before the pattern is rewritten. */
const SCENE_HOLD = STEPS_PER_BEAT;
/** How a section may end, by weight. */
const SECTION_ENDINGS: readonly [FxId, number][] = [
  ['stutter', 3],
  ['brake', 1],
  ['tapeStop', 1],
];
/** Fewest bars between two scene changes. */
const SCENE_MIN_BARS = 8;
/** Per-step decay of a sensor's onset envelope. */
const ONSET_DECAY = 0.6;
/** Voices an accent prefers, in order. */
const ACCENT_VOICES = [
  'ohat',
  'clap',
  'rim',
  'snare',
  'perc',
  'hat',
  'shaker',
  'tom',
  'zap',
  'noise',
  'kick',
];

/**
 * The music brain. Call `tick` once per 16th-note step, in order; it returns
 * the notes that start on that step. Pure TypeScript with no timers or
 * audio: the caller owns the clock.
 *
 * Sensors drive four things at once:
 * - the genome (machines, patterns, lengths, routings, harmony settings),
 *   rebuilt every section and when the sensors move far ("scene change");
 * - phrase mutations, seeded by the fine fingerprint;
 * - the modulation matrix, every step;
 * - chaos maps whose growth rate sensors set.
 * With no live sensor there is no music.
 */
export class Engine {
  readonly hub: SensorHub;
  readonly router: Router;
  private style: Style;
  private pendingStyle: Style | undefined;
  private readonly seed: number;
  private readonly keyRoot: number | undefined;
  private readonly fingerprinter = new Fingerprinter();
  private genome: Genome | undefined;
  private matrix: ModMatrix | undefined;
  private harmony: Harmony | undefined;
  private runners: TrackRunner[] = [];
  private realizers = new Map<string, Realizer>();
  private chain = 0;
  private step = 0;
  private sectionStart = 0;
  private section = 0;
  private waiting = true;
  private anchor: Fingerprint | undefined;
  private farSteps = 0;
  private farChannel: string | undefined;
  private fillUntilStep = -1;
  private pendingAccent = 0;
  private readonly onsetEnv = new Map<string, number>();
  private readonly onsetSeen = new Map<string, number>();
  private trackState = new Map<string, { params: TrackParams; fired: number }>();
  /** Channels with an onset on the latest step. */
  private readonly freshOnsets = new Set<string>();
  /** Effects waiting to fire, in priority order; at most one fires per step. */
  private fxQueue: { fx: FxId; depth: number; steps: number }[] = [];
  /** Step until which an exclusive effect (stutter, tape stop, …) holds the mix. */
  private fxBusyUntil = -1;
  private readonly fxCooldown = new Map<FxId, number>();
  /** The lid closing fires a tape stop once until it settles again. */
  private lidLatch = false;
  private globals: GlobalParams = { tension: 0.5, brightness: 0.5, swing: 0, space: 0.5, fx: 0.5 };
  private rebuildInfo: EngineView['rebuild'] = { reason: 'start', step: 0 };
  private keySource: EngineView['keySource'] = 'sensors';
  private mutations: string[] = [];
  /** Increments whenever tracks or machines are rebuilt. */
  genomeVersion = 0;

  constructor(opts: EngineOptions) {
    this.style = opts.style;
    this.seed = opts.seed ?? 0;
    this.keyRoot = opts.keyRoot;
    this.hub = opts.hub ?? new SensorHub();
    this.router = new Router(this.hub, mergeRules(DEFAULT_MAPPING, opts.style.mapping));
  }

  get currentStyle(): Style {
    return this.style;
  }

  /** Scale in effect for the most recent step. */
  get scale(): Scale | undefined {
    return this.harmony?.scale;
  }

  /** Chord in effect for the most recent step. */
  get chord(): Chord | undefined {
    return this.harmony?.chord;
  }

  /** The key's root pitch class, once the music has started. */
  get key(): number | undefined {
    return this.harmony?.root;
  }

  /** True while no sensor is live, so nothing plays. */
  get isWaiting(): boolean {
    return this.waiting;
  }

  /** Switches style at the next bar line. */
  setStyle(style: Style): void {
    this.pendingStyle = style;
  }

  /** Effects in effect: the genome's choice (Free mode) or the style's. */
  get fx(): FxConfig {
    return this.genome?.fx ?? this.style.fx;
  }

  /** Every track's slot and machine, for the renderer. */
  trackMachines(): { slot: string; machineId: string; machine: Machine }[] {
    return (this.genome?.tracks ?? [])
      .filter((t) => t.role !== 'fx')
      .map((t) => ({
        slot: t.slot,
        machineId: t.machine,
        machine: this.style.palette.machines[t.machine] as Machine,
      }));
  }

  /** Generates the notes for the next step. `stepSeconds` drives macro smoothing. */
  tick(stepSeconds: number): NoteEvent[] {
    const step = this.step++;
    const { macros, triggers } = this.router.update(stepSeconds);
    const live = this.liveChannels();
    const stepInBar = step % STEPS_PER_BAR;
    this.trackOnsets(live);

    if (live.length === 0) {
      this.waiting = true;
      this.trackState.clear();
      return [];
    }
    if (this.waiting) {
      // Start (or resume) on the next bar line.
      if (stepInBar !== 0) return [];
      this.waiting = false;
      const fp = this.fingerprinter.take(live);
      this.rebuild(step, fp, macros, this.genome ? 'resume' : 'start');
    } else if (stepInBar === 0 && this.pendingStyle) {
      this.style = this.pendingStyle;
      this.pendingStyle = undefined;
      this.router.setRules(mergeRules(DEFAULT_MAPPING, this.style.mapping));
      this.rebuild(step, this.fingerprinter.take(live), macros, 'style');
    } else {
      this.boundaries(step, live, macros);
    }
    return this.play(step, live, macros, triggers);
  }

  snapshot(): EngineSnapshot {
    const step = Math.max(0, this.step - 1);
    const h = this.harmony;
    const chord = h?.chord ?? { degree: 0, size: 3 };
    const sym = h ? h.chordLabel : { roman: '–', name: '–' };
    const rel = Math.max(0, step - this.sectionStart);
    const phraseBars = Math.max(1, this.style.palette.phraseBars);
    return {
      step,
      bar: Math.floor(step / STEPS_PER_BAR),
      beat: Math.floor((step % STEPS_PER_BAR) / STEPS_PER_BEAT),
      styleId: this.style.id,
      keyName: h?.keyName ?? '–',
      mode: h?.mode ?? 'ionian',
      chord,
      chordRoman: sym.roman,
      chordName: sym.name,
      macros: this.router.macros,
      waiting: this.waiting,
      section: this.section,
      phrase: Math.floor(rel / STEPS_PER_BAR / phraseBars),
      genome: (this.genome?.chain ?? 0).toString(16).padStart(8, '0').slice(0, 6),
    };
  }

  /** Tracks, routes and decisions on the latest step, for display. */
  view(): EngineView {
    const tracks: TrackView[] = this.runners.map((r) => {
      const t = r.spec;
      const state = this.trackState.get(t.slot);
      const machine = this.style.palette.machines[t.machine];
      return {
        slot: t.slot,
        role: t.role,
        machine: t.machine,
        label: machine?.label ?? (t.role === 'fx' ? 'FX lane' : t.machine),
        ...(t.voice ? { voice: t.voice } : {}),
        length: t.length,
        scale: t.scale,
        trigs: t.trigs,
        position: r.position,
        loop: r.loop,
        params: state?.params ?? t.base,
        base: t.base,
        fired: state?.fired ?? 0,
      };
    });
    const [lo, hi] = this.style.palette.swing;
    return {
      snapshot: this.snapshot(),
      tracks,
      routes: this.matrix?.view() ?? [],
      globals: { ...this.globals },
      swing: lerp(lo, hi, this.globals.swing),
      rebuild: { ...this.rebuildInfo },
      keySource: this.keySource,
      mutations: this.mutations,
    };
  }

  /** Live channels, or only the soloed one while the Sensor lab solos a channel. */
  private liveChannels(): ChannelState[] {
    const solo = this.router.solo;
    return this.hub.list().filter((c) => !c.stale && (solo === undefined || c.desc.id === solo));
  }

  private trackOnsets(live: readonly ChannelState[]): void {
    this.freshOnsets.clear();
    for (const [id, e] of this.onsetEnv) this.onsetEnv.set(id, e * ONSET_DECAY);
    for (const ch of live) {
      const id = ch.desc.id;
      const seen = this.onsetSeen.get(id);
      // Onsets from before the channel was first seen do not count.
      if (seen === undefined) this.onsetEnv.set(id, 0);
      else if (ch.lastOnsetT > seen) {
        this.onsetEnv.set(id, 1);
        this.freshOnsets.add(id);
      }
      this.onsetSeen.set(id, ch.lastOnsetT);
    }
  }

  /** Section ends, scene changes and phrase mutations, all on bar lines. */
  private boundaries(step: number, live: readonly ChannelState[], macros: Readonly<Macros>): void {
    const fp = this.fingerprinter.take(live);
    const change = this.anchor
      ? fingerprintChange(this.anchor, fp)
      : { distance: 0, channel: undefined };
    if (change.distance > SCENE_DISTANCE) {
      this.farSteps++;
      this.farChannel = change.channel?.label;
      // A new scene is coming at the next bar line: rise into it.
      const barsAtNextBar = Math.floor((step - this.sectionStart) / STEPS_PER_BAR) + 1;
      const left = STEPS_PER_BAR - (step % STEPS_PER_BAR);
      if (this.farSteps === SCENE_HOLD && barsAtNextBar >= SCENE_MIN_BARS && left >= 2) {
        this.queueFx('sweep', 0.8, left);
      }
    } else {
      this.farSteps = 0;
    }
    if (step % STEPS_PER_BAR !== 0) return;
    const { palette } = this.style;
    const barsIn = Math.floor((step - this.sectionStart) / STEPS_PER_BAR);
    if (barsIn >= palette.sectionBars) {
      this.section++;
      this.rebuild(step, fp, macros, 'section');
    } else if (this.farSteps >= SCENE_HOLD && barsIn >= SCENE_MIN_BARS) {
      this.rebuild(step, fp, macros, 'scene');
    } else if (barsIn > 0 && barsIn % Math.max(1, palette.phraseBars) === 0 && this.genome) {
      const amount = clamp(0.25 + 0.75 * macros.variation);
      const rng = new Rng(hashInts(this.chain, barsIn, fp.fineHash));
      this.mutations = mutatePhrase(this.genome, rng, amount);
      this.harmony?.onPhraseStart(this.harmonyInputs(macros));
    }
  }

  private rebuild(
    step: number,
    fp: Fingerprint,
    macros: Readonly<Macros>,
    reason: RebuildReason,
  ): void {
    const first = this.genome === undefined;
    this.chain = first ? firstChain(this.seed, fp) : nextChain(this.chain, fp, this.section);
    const genome = buildGenome(this.style, fp, this.chain, this.section, macros);
    this.genome = genome;
    this.matrix = new ModMatrix(genome.matrix);
    this.runners = genome.tracks.map(
      (t) => new TrackRunner(t, new Rng(hashInts(this.chain, Number(t.slot.slice(1)), 0x5eed))),
    );
    this.realizers = new Map(
      genome.tracks.map((t) => [t.slot, this.realizers.get(t.slot) ?? new Realizer()]),
    );
    this.sectionStart = step;
    this.anchor = fp;
    this.farSteps = 0;
    this.mutations = [];
    this.genomeVersion++;
    const channel = reason === 'scene' ? this.farChannel : undefined;
    this.rebuildInfo = { reason, step, ...(channel ? { channel } : {}) };

    const inputs = this.harmonyInputs(macros);
    if (!this.harmony) {
      const root = this.keyRoot ?? hashInts(fp.coarseHash, 12) % 12;
      this.keySource = this.keyRoot !== undefined ? 'place' : 'sensors';
      this.harmony = new Harmony(
        this.style.palette,
        new Rng(hashInts(this.chain, 0x4a11)),
        genome.harmony,
        inputs,
        root,
      );
      return;
    }
    const harmony = this.harmony;
    harmony.setGenes(this.style.palette, genome.harmony, inputs);
    if (reason === 'scene' || reason === 'resume') {
      // A new scene starts in a new key: next to the place's key, or one the sensors pick.
      const root =
        this.keyRoot !== undefined
          ? mod(harmony.root + (hashInts(this.chain) % 2 === 0 ? 7 : 5), 12)
          : hashInts(fp.coarseHash, this.chain) % 12;
      harmony.setRoot(root, inputs);
      this.keySource = this.keyRoot !== undefined ? 'place' : 'sensors';
    } else {
      const before = harmony.root;
      harmony.onSectionStart(inputs);
      if (harmony.root !== before) this.keySource = 'colour';
      harmony.advance(inputs, true);
    }
  }

  private harmonyInputs(macros: Readonly<Macros>): HarmonyInputs {
    return {
      tension: this.globals.tension,
      brightness: this.globals.brightness,
      texture: macros.texture,
      color: macros.color,
    };
  }

  private play(
    step: number,
    live: readonly ChannelState[],
    macros: Readonly<Macros>,
    triggers: Readonly<Triggers>,
  ): NoteEvent[] {
    const genome = this.genome;
    const matrix = this.matrix;
    const harmony = this.harmony;
    if (!genome || !matrix || !harmony) return [];
    const { palette } = this.style;
    const stepInBar = step % STEPS_PER_BAR;
    const rel = step - this.sectionStart;

    // External sources for the matrix.
    matrix.clearExternal();
    for (const ch of live) {
      const id = ch.desc.id;
      const f = ch.features;
      matrix.setSource(sensorSource(id, 'level'), 2 * f.level - 1);
      matrix.setSource(sensorSource(id, 'activity'), f.activity);
      matrix.setSource(sensorSource(id, 'trend'), f.trend);
      matrix.setSource(sensorSource(id, 'onset'), this.onsetEnv.get(id) ?? 0);
      matrix.setSource(sensorSource(id, 'jitter'), 2 * jitterOf(ch.raw) - 1);
    }
    for (const m of MACROS) matrix.setSource(macroSource(m), 2 * macros[m] - 1);
    const offsets = matrix.evaluate();
    const off = (id: string) => offsets.get(id) ?? 0;
    this.globals = {
      tension: clamp(macros.tension + off(globalDest('tension'))),
      brightness: clamp(macros.brightness + off(globalDest('brightness'))),
      space: clamp(macros.space + off(globalDest('space'))),
      swing: clamp(genome.swing + off(globalDest('swing'))),
      fx: clamp(0.5 + off(globalDest('fx'))),
    };

    // Harmony: chords change on the genome's chord rate, counted from the section start.
    const chordSteps = Math.max(1, Math.round(genome.harmony.chordRateBars * STEPS_PER_BAR));
    if (rel > 0 && rel % chordSteps === 0) {
      const phraseSteps = Math.max(1, palette.phraseBars) * STEPS_PER_BAR;
      harmony.advance(this.harmonyInputs(macros), (rel + chordSteps) % phraseSteps === 0);
    }
    const h: HarmonyContext = {
      scale: harmony.scale,
      chord: harmony.chord,
      nextRoot: harmony.nextRoot,
      chordMoves: harmony.chordMoves,
      key: harmony.root,
      stepsUntilChordChange: chordSteps - (rel % chordSteps),
      stepInBar,
    };

    // Fills: the last bar of a phrase sometimes, the end of a section always, or on request.
    if (stepInBar === 0) {
      const barsIn = Math.floor(rel / STEPS_PER_BAR);
      const phraseBars = Math.max(1, palette.phraseBars);
      const lastOfPhrase = barsIn % phraseBars === phraseBars - 1;
      const lastOfSection = barsIn === palette.sectionBars - 1;
      const auto = new Rng(hashInts(this.chain, barsIn, 0xf111)).chance(macros.variation * 0.6);
      if (lastOfSection || (lastOfPhrase && auto)) this.fillUntilStep = step + STEPS_PER_BAR;
    }
    if (triggers.fill > 0)
      this.fillUntilStep = Math.max(this.fillUntilStep, step + STEPS_PER_BAR - stepInBar);
    const fill = step < this.fillUntilStep;
    if (triggers.accent > 0) this.pendingAccent = Math.max(this.pendingAccent, triggers.accent);

    const events: NoteEvent[] = [];
    const fired = new Map<string, number>();
    const sectionLeft = palette.sectionBars * STEPS_PER_BAR - rel;
    let nei = false;
    // Sensor events fire effects first, so a shake or a clap answers at once.
    this.sensorFx(live);
    // The end of a section sometimes stutters, brakes or stops into the next one.
    if (rel % STEPS_PER_BAR === 12 && Math.floor(rel / STEPS_PER_BAR) === palette.sectionBars - 1) {
      const rng = new Rng(hashInts(this.chain, 0x57a7));
      const allowed = palette.effects ?? FX_IDS;
      const endings = SECTION_ENDINGS.filter(([fx]) => allowed.includes(fx));
      if (endings.length > 0 && rng.chance(0.3 + 0.5 * macros.variation)) {
        const [ending] = endings[rng.weightedIndex(endings.map(([, w]) => w))] as [FxId, number];
        this.queueFx(ending, 0.8, Math.min(4, FX_INFO[ending].steps));
      }
    }
    for (const runner of this.runners) {
      const spec = runner.spec;
      const params = {} as TrackParams;
      for (const p of TRACK_PARAMS) params[p] = clamp(spec.base[p] + off(trackDest(spec.slot, p)));
      let trigs = runner.step(rel, params, { fill, nei });
      if (spec.role === 'fx') {
        for (const f of trigs) if (f.trig.fx) this.queueFx(f.trig.fx, f.trig.vel, f.len);
        this.trackState.set(spec.slot, { params, fired: 0 });
        continue;
      }
      nei = runner.lastCond;
      const realizer = this.realizers.get(spec.slot) as Realizer;
      // A drone whose note left the key restarts on the bar line.
      if (
        spec.role === 'drone' &&
        stepInBar === 0 &&
        trigs.length === 0 &&
        realizer.droneStale(h.scale)
      ) {
        const fallback: Trig = {
          vel: 0.7,
          len: spec.length,
          prob: 1,
          cond: { kind: 'always' },
          micro: 0,
        };
        trigs = [
          {
            trig: spec.trigs.find((t) => t) ?? fallback,
            index: 0,
            micro: 0,
            len: spec.length / spec.scale,
          },
        ];
      }
      let firedVel = 0;
      for (const f of trigs) {
        const evs = this.realize(spec, f, params, h, macros, step, sectionLeft, realizer);
        events.push(...evs);
        for (const e of evs) firedVel = Math.max(firedVel, e.vel);
      }
      if (firedVel > 0) fired.set(spec.slot, firedVel);
      this.trackState.set(spec.slot, { params, fired: firedVel });
    }

    // A sensor onset asked for an accent: play it on the next eighth-note slot.
    if (this.pendingAccent > 0 && stepInBar % 2 === 0) {
      this.accent(events, step, fired);
      this.pendingAccent = 0;
    }

    const fx = this.emitFx(step);
    if (fx) {
      const lane = this.trackState.get('fx');
      if (lane) lane.fired = fx.vel;
    }

    matrix.advance(offsets, fired);
    const out = capEvents(events, palette.maxEventsPerStep);
    if (fx) out.push(fx);
    return out;
  }

  private queueFx(fx: FxId, depth: number, steps: number): void {
    const allowed = this.style.palette.effects ?? FX_IDS;
    if (allowed.includes(fx)) this.fxQueue.push({ fx, depth, steps: Math.max(1, steps) });
  }

  /** Effects fired by sensor events: onsets, or the lid closing fast. */
  private sensorFx(live: readonly ChannelState[]): void {
    const triggers = this.genome?.fxTriggers ?? [];
    for (const t of triggers) {
      if (this.freshOnsets.has(t.channelId)) this.queueFx(t.fx, 0.9, FX_INFO[t.fx].steps);
    }
    for (const ch of live) {
      if (ch.desc.kind !== 'lid.angle') continue;
      if (!this.lidLatch && ch.features.trend < -0.6) {
        this.lidLatch = true;
        this.queueFx('tapeStop', 1, FX_INFO.tapeStop.steps);
      } else if (ch.features.trend > -0.2) {
        this.lidLatch = false;
      }
    }
  }

  /**
   * Fires at most one queued effect: the first that is not cooling down and,
   * if it takes over the mix, does not clash with one already playing.
   */
  private emitFx(step: number): NoteEvent | undefined {
    const queue = this.fxQueue;
    this.fxQueue = [];
    for (const c of queue) {
      const info = FX_INFO[c.fx];
      if ((this.fxCooldown.get(c.fx) ?? -1) > step) continue;
      if (info.exclusive && step < this.fxBusyUntil) continue;
      this.fxCooldown.set(c.fx, step + c.steps + info.rest);
      if (info.exclusive) this.fxBusyUntil = step + c.steps;
      return {
        part: 'fx',
        role: 'fx',
        step,
        durSteps: c.steps,
        vel: clamp(c.depth * (0.5 + this.globals.fx), 0.1, 1),
        fx: c.fx,
      };
    }
    return undefined;
  }

  private realize(
    spec: TrackSpec,
    f: FiredTrig,
    params: Readonly<TrackParams>,
    h: HarmonyContext,
    macros: Readonly<Macros>,
    step: number,
    sectionLeft: number,
    realizer: Realizer,
  ): NoteEvent[] {
    const { trig } = f;
    const locked = { ...params };
    if (trig.locks) {
      for (const [p, v] of Object.entries(trig.locks) as [keyof TrackParams, number][]) {
        locked[p] = clamp(v + (params[p] - spec.base[p]));
      }
    }
    const vel = clamp(trig.vel * (0.75 + 0.5 * macros.energy), 0.05, 1);
    let len = f.len;
    if (
      spec.role === 'bass' ||
      spec.role === 'chords' ||
      spec.role === 'pad' ||
      spec.role === 'lead'
    ) {
      len = Math.min(len, h.stepsUntilChordChange);
    } else if (spec.role === 'drone') {
      len = Math.min(len, sectionLeft);
    }
    const base: Omit<NoteEvent, 'midi'> = {
      part: spec.slot,
      role: spec.role,
      step,
      durSteps: Math.max(0.25, len),
      vel,
      params: locked,
      ...(Math.abs(f.micro) > 1e-6 ? { micro: f.micro } : {}),
      ...(f.retrig ? { retrig: f.retrig } : {}),
      ...(trig.slide ? { slide: true } : {}),
    };
    if (spec.role === 'drum') return [{ ...base, voice: spec.voice ?? 'perc' }];
    return realizer.notes(spec, trig.note, h, locked.tune, len).map((midi) => ({ ...base, midi }));
  }

  private accent(events: NoteEvent[], step: number, fired: Map<string, number>): void {
    const drums = this.runners.map((r) => r.spec).filter((t) => t.role === 'drum');
    if (drums.length === 0) return;
    const rank = (t: TrackSpec) => {
      const i = ACCENT_VOICES.indexOf(t.voice ?? '');
      return i < 0 ? ACCENT_VOICES.length : i;
    };
    const track = [...drums].sort((a, b) => rank(a) - rank(b))[0] as TrackSpec;
    const vel = Math.min(1, 0.6 + 0.4 * this.pendingAccent);
    const existing = events.find((e) => e.part === track.slot);
    if (existing) {
      existing.vel = Math.max(existing.vel, vel);
    } else {
      const params = this.trackState.get(track.slot)?.params ?? track.base;
      events.push({
        part: track.slot,
        role: 'drum',
        step,
        durSteps: 1,
        vel,
        voice: track.voice ?? 'perc',
        params: { ...params },
      });
    }
    fired.set(track.slot, Math.max(fired.get(track.slot) ?? 0, vel));
    const state = this.trackState.get(track.slot);
    if (state) state.fired = Math.max(state.fired, vel);
  }
}

/**
 * Keeps at most `max` notes on one step. When there are too many, chord
 * notes go first, highest first, so the texture thins without losing a line.
 */
export function capEvents(events: NoteEvent[], max: number): NoteEvent[] {
  if (events.length <= max) return events;
  const out = [...events];
  while (out.length > max) {
    const counts = new Map<string, number>();
    for (const e of out) counts.set(e.part, (counts.get(e.part) ?? 0) + 1);
    let part = '';
    let most = 1;
    for (const [p, c] of counts) if (c > most) [part, most] = [p, c];
    if (!part) {
      out.sort((a, b) => b.vel - a.vel);
      out.length = max;
      break;
    }
    let drop = -1;
    out.forEach((e, i) => {
      if (e.part === part && (drop < 0 || (e.midi ?? 0) > ((out[drop] as NoteEvent).midi ?? 0)))
        drop = i;
    });
    out.splice(drop, 1);
  }
  return out;
}
