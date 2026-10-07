import type { NoteEvent } from './clock/events';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from './clock/grid';
import { Harmony, type HarmonyInputs } from './composer/harmony';
import { FX_IDS, FX_INFO, type FxId } from './fx/effects';
import { genomeDistance, type KeyState, type TrackDistance } from './genome/distance';
import { evolveGenome } from './genome/evolve';
import { Fingerprinter, fingerprintChange, jitterOf, type Fingerprint } from './genome/fingerprint';
import {
  buildGenome,
  cloneGenome,
  firstChain,
  fxTriggers,
  nextChain,
  type FxTrigger,
  type Genome,
} from './genome/genome';
import { mutatePhrase } from './genome/mutate';
import { MACROS, defaultMacros, type Macros, type Triggers } from './mapping/macros';
import {
  domainsOf,
  partitionAreas,
  owns,
  type Area,
  type Partition,
  type PartitionLevel,
} from './mapping/partition';
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
import {
  EditTracker,
  editsVersion,
  type EditView,
  type RepeatMode,
  type SensorMode,
  type SensorZones,
} from './seeded/edits';
import {
  KEY_CODES,
  LEVELS,
  describeEffect,
  effectTargets,
  keyName,
  sensorEffect,
} from './seeded/effects';
import { InputModel } from './seeded/inputs';
import { InputMapper, type InputMap } from './seeded/mapping';
import {
  DEFAULT_LOOP_BARS,
  baseSong,
  buildSong,
  evolveBase,
  generationBars,
  type Song,
  type SongSpec,
} from './seeded/song';
import { Realizer, type HarmonyContext } from './seq/realize';
import { TrackRunner, type FiredTrig } from './seq/runner';
import { cloneTrig, type TrackRole, type TrackSpec, type Trig } from './seq/types';
import { SensorHub, type ChannelState } from './sensors/hub';
import { groupOf, type SensorDescriptor, type SensorEvent, type Timescale } from './sensors/types';
import { driftOf, type FxConfig, type Machine, type Style } from './styles/schema';
import type { Chord } from './theory/chords';
import { noteName } from './theory/notes';
import type { ModeId, Scale } from './theory/scales';

export interface EngineOptions {
  style: Style;
  /** Salt for the hash chain; the sensors decide everything else. */
  seed?: number;
  /** Shared sensor hub; a new one is created if omitted. */
  hub?: SensorHub;
  /** Key (pitch class 0..11) to start in, e.g. from the current place. */
  keyRoot?: number;
  /** Deterministic mode: a looping song the inputs edit (see `DeterministicOptions`). */
  deterministic?: DeterministicOptions;
}

/**
 * Deterministic mode. The seed writes a song that loops for as long as no
 * input changes. Every input has one fixed effect on it (each key its own),
 * and a change turns the song into a new version at the next bar line,
 * which then loops in turn. Several changes combine. It plays with no
 * sensor at all.
 */
export interface DeterministicOptions {
  seed: number;
  /** Sensor-clock seconds at which step 0 starts (default 0). */
  origin?: number;
  /** Seconds behind the music at which inputs are read, so every reading has arrived (default 0.2). */
  inputDelay?: number;
  /** Bars in the loop (default 8). */
  loopBars?: number;
  /** What pressing the same input again does (default `toggle`). */
  repeat?: RepeatMode;
  /** How continuous sensors act (default `zones`). */
  sensors?: SensorMode;
  /** False keeps the seed's instruments: no input swaps or adds one (default true). */
  instruments?: boolean;
  /** Your own effect and repeat for any input (see `INPUT_ROWS`). */
  mapping?: InputMap;
  /**
   * The song evolves a little every generation (whole loops, at least 16
   * bars), the same way every time for the same seed (default false: the
   * loop stays exact until an input changes it).
   */
  evolve?: boolean;
}

/** The song deterministic mode is playing. */
export interface SongView {
  /** A short id of the edits in effect (and the generation); `base` with none. */
  version: string;
  /** Bar within the loop, from 0. */
  loopBar: number;
  loopBars: number;
  edits: readonly EditView[];
  /** Inputs that changed something which lands at the next bar line. */
  pending: readonly PendingEdit[];
  /** Every continuous sensor's zones, for the zone meters. */
  sensors: readonly SensorZones[];
  /** Tracks the edits muted. */
  muted: readonly string[];
  /** Evolve on: the generation playing, from 0, and bars per generation. */
  evolve?: { generation: number; bars: number };
}

/** An edit waiting for the next bar line. */
export interface PendingEdit extends EditView {
  /** Its count now in effect: 0 for an edit that is new, `count` 0 for one being undone. */
  was: number;
  /** The bar (from the start of the piece) it lands on. */
  atBar: number;
}

/** Why the pattern was last rewritten. */
export type RebuildReason = 'start' | 'section' | 'scene' | 'style' | 'resume' | 'edit' | 'evolve';

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
  /** The seed, in deterministic mode. */
  seed?: number;
}

export interface TrackView {
  slot: string;
  role: TrackRole;
  machine: string;
  label: string;
  voice?: string;
  /** The palette slot it fills: what the track is, whatever its slot id. */
  option?: number;
  length: number;
  scale: number;
  /** A copy of the pattern; `version` changes whenever it does. */
  trigs: readonly (Trig | undefined)[];
  /** Changes whenever any pattern is rewritten, mutated or evolves. */
  version: number;
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
  keySource: 'place' | 'sensors' | 'colour' | 'seed';
  /** Changes made at the latest phrase start. */
  mutations: readonly string[];
  /** Which effect each sensor's events fire. */
  fxTriggers: readonly FxTrigger[];
  /** Deterministic mode: the song version, its loop and its edits. */
  song?: SongView;
  /** Which source and channel controls which areas. */
  partition: PartitionView;
  /** How far the music has moved from where it started. */
  drift: DriftView;
}

/** The partition as the app shows it. */
export interface PartitionView {
  level: PartitionLevel;
  groups: {
    group: string;
    areas: readonly Area[];
    channels: { id: string; label: string; areas: readonly Area[] }[];
  }[];
}

/** How far the music has come from where it started (the first genome, or the seed's song). */
export interface DriftView {
  /** Bars since the start it is measured from. */
  bar: number;
  /** 0 where it started .. 1 nothing in common. */
  total: number;
  harmony: number;
  tracks: readonly TrackDistance[];
  /** `total` at every bar so far (the latest 512). */
  history: readonly number[];
  /** Bars where the pattern was rewritten, and why. */
  marks: readonly { bar: number; reason: RebuildReason }[];
}

const DEFAULT_INPUT_DELAY = 0.2;
/** Bars of drift history kept. */
const DRIFT_HISTORY = 512;
/** How far one evolution goes: a section going by (scaled by variation), a scene, a resume. */
const EVOLVE_SECTION = 0.2;
const EVOLVE_SCENE = 0.65;
const EVOLVE_RESUME = 0.5;
/** Steps an effect may wait for its turn before it is dropped. */
const FX_WAIT = 4;

/** Deterministic mode's state. */
interface Seeded {
  seed: number;
  origin: number;
  delay: number;
  loopBars: number;
  model: InputModel;
  mapper: InputMapper;
  tracker: EditTracker;
  /** Musical seconds at the start of the next step. */
  clock: number;
  /** Sensor-clock time up to which inputs have been read. */
  readT: number;
  base: SongSpec;
  song: Song | undefined;
  version: string;
  edits: EditView[];
  /** Step within the loop of the latest step. */
  pos: number;
  /** The clock skipped: start the loop over at the position reached. */
  resync: boolean;
  /** Evolve on: bars per generation, and the generation reached with its song. */
  evolve: { bars: number; k: number; spec: SongSpec } | undefined;
  instruments: boolean;
  /** Pending edits, worked out once per change of the tracker. */
  pending: { version: number; atBar: number; list: PendingEdit[] };
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
  /** Salt for the hash chain in the sensor-driven mode. */
  private readonly seed0: number;
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
  private fxQueue: { fx: FxId; depth: number; steps: number; until: number }[] = [];
  /** Step until which an exclusive effect (stutter, tape stop, …) holds the mix. */
  private fxBusyUntil = -1;
  /** The step effects are queued at: the absolute step, or the loop position in deterministic mode. */
  private fxNow = 0;
  private readonly fxCooldown = new Map<FxId, number>();
  /** The lid closing fires a tape stop once until it settles again. */
  private lidLatch = false;
  private globals: GlobalParams = { tension: 0.5, brightness: 0.5, swing: 0, space: 0.5, fx: 0.5 };
  private rebuildInfo: EngineView['rebuild'] = { reason: 'start', step: 0 };
  private keySource: EngineView['keySource'] = 'sensors';
  private mutations: string[] = [];
  /** Increments whenever tracks or machines are rebuilt. */
  genomeVersion = 0;
  /** Increments whenever any pattern changes (rebuilt, mutated, evolved). */
  private patternVersion = 0;
  private trigCopies = new Map<string, (Trig | undefined)[]>();
  private trigCopiesFor = -1;
  private readonly det: Seeded | undefined;
  /** Who controls what, for the live channels. */
  private partition: Partition | undefined;
  /** The last partition of every live channel (not a Sensor lab solo): the next one sticks to it. */
  private settled: Partition | undefined;
  private partitionKey = '';
  private partitionView: PartitionView = { level: 'all', groups: [] };
  /** Bar line at which a new scene takes over, once one is due. */
  private sceneAt: number | undefined;
  private sceneRisen = false;
  /** Where the music started: the first genome and its key, for the drift. */
  private origin: { genome: Genome; key: KeyState; bar: number } | undefined;
  private drift: DriftView = { bar: 0, total: 0, harmony: 0, tracks: [], history: [], marks: [] };
  private driftHistory: number[] = [];
  private driftMarks: { bar: number; reason: RebuildReason }[] = [];

  constructor(opts: EngineOptions) {
    this.style = opts.style;
    this.seed0 = opts.seed ?? 0;
    this.keyRoot = opts.keyRoot;
    this.hub = opts.hub ?? new SensorHub();
    this.router = new Router(this.hub, mergeRules(DEFAULT_MAPPING, opts.style.mapping));
    const d = opts.deterministic;
    if (d) {
      const seed = Math.floor(d.seed) >>> 0;
      const loopBars = Math.max(1, Math.round(d.loopBars ?? DEFAULT_LOOP_BARS));
      const origin = d.origin ?? 0;
      this.det = {
        seed,
        origin,
        delay: d.inputDelay ?? DEFAULT_INPUT_DELAY,
        loopBars,
        model: new InputModel(this.hub, { origin }),
        mapper: new InputMapper({
          ...(d.mapping ? { mapping: d.mapping } : {}),
          ...(d.instruments !== undefined ? { instruments: d.instruments } : {}),
        }),
        tracker: new EditTracker({ repeat: d.repeat ?? 'toggle', sensors: d.sensors ?? 'zones' }),
        clock: 0,
        readT: -Infinity,
        base: baseSong(opts.style, seed, loopBars),
        song: undefined,
        version: '',
        edits: [],
        pos: 0,
        resync: false,
        evolve: undefined,
        instruments: d.instruments ?? true,
        pending: { version: -1, atBar: -1, list: [] },
      };
      if (d.evolve) {
        const det = this.det as Seeded;
        det.evolve = { bars: generationBars(loopBars), k: 0, spec: det.base };
      }
      this.keySource = 'seed';
    }
  }

  /** Which source and channel controls which areas, for the channels live now. */
  get partitionInfo(): PartitionView {
    return this.partitionView;
  }

  /** The seed in deterministic mode, else undefined. */
  get seed(): number | undefined {
    return this.det?.seed;
  }

  /** Stops listening to the hub (deterministic mode keeps a log of it). */
  dispose(): void {
    this.det?.model.dispose();
  }

  get currentStyle(): Style {
    return this.style;
  }

  /** Scale in effect for the most recent step. */
  get scale(): Scale | undefined {
    return this.det ? this.songChord()?.scale : this.harmony?.scale;
  }

  /** Chord in effect for the most recent step. */
  get chord(): Chord | undefined {
    return this.det ? this.songChord()?.chord : this.harmony?.chord;
  }

  /** The key's root pitch class, once the music has started. */
  get key(): number | undefined {
    return this.det ? this.det.song?.root : this.harmony?.root;
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
    if (this.det) return this.det.song?.fx ?? this.style.fx;
    return this.genome?.fx ?? this.style.fx;
  }

  /** Every track's slot and machine, for the renderer. */
  trackMachines(): { slot: string; machineId: string; machine: Machine }[] {
    return ((this.det ? this.det.song?.tracks : this.genome?.tracks) ?? [])
      .filter((t) => t.role !== 'fx')
      .map((t) => ({
        slot: t.slot,
        machineId: t.machine,
        machine: this.style.palette.machines[t.machine] as Machine,
      }));
  }

  /** Generates the notes for the next step. `stepSeconds` drives macro smoothing. */
  tick(stepSeconds: number): NoteEvent[] {
    if (this.det) return this.tickSong(this.det, stepSeconds);
    const step = this.step++;
    const live = this.liveChannels();
    this.updatePartition(live);
    const { macros, triggers } = this.router.update(stepSeconds);
    const stepInBar = step % STEPS_PER_BAR;
    this.trackOnsets(live);

    if (live.length === 0) {
      this.waiting = true;
      this.trackState.clear();
      this.pendingAccent = 0;
      return [];
    }
    if (this.waiting) {
      // Start (or resume) on the next bar line.
      if (stepInBar !== 0) return [];
      this.waiting = false;
      this.pendingAccent = 0;
      const resume = this.genome !== undefined;
      if (this.applyPendingStyle()) {
        this.rebuild(step, this.fingerprinter.take(live), live, macros, resume ? 'style' : 'start');
      } else {
        this.rebuild(
          step,
          this.fingerprinter.take(live),
          live,
          macros,
          resume ? 'resume' : 'start',
        );
      }
    } else if (stepInBar === 0 && this.applyPendingStyle()) {
      this.rebuild(step, this.fingerprinter.take(live), live, macros, 'style');
    } else {
      this.boundaries(step, live, macros);
    }
    if (stepInBar === 0) this.measureDrift(step);
    return this.play(step, live, macros, triggers);
  }

  /**
   * While stopped: keeps the dials following the sensors, shared out as the
   * music would share them.
   */
  idle(dt: number): void {
    this.updatePartition(this.det ? sharing(this.det, this.det.readT) : this.liveChannels());
    this.router.update(dt);
  }

  /**
   * The clock skipped `steps` steps (the page stalled): deterministic mode
   * moves its own clock and position on with it, so inputs keep being read
   * on time. The sensor-driven mode just carries on.
   */
  skip(steps: number, stepSeconds: number): void {
    const det = this.det;
    if (!det || steps <= 0) return;
    this.step += steps;
    det.clock += steps * stepSeconds;
    det.resync = true;
  }

  private applyPendingStyle(): boolean {
    const style = this.pendingStyle;
    if (!style) return false;
    this.style = style;
    this.pendingStyle = undefined;
    this.router.setRules(mergeRules(DEFAULT_MAPPING, style.mapping));
    this.partitionKey = '';
    return true;
  }

  /** Shares the areas out again when the set of live channels changes. */
  private updatePartition(live: readonly { desc: SensorDescriptor; timescale: Timescale }[]): void {
    const key = live
      .map((c) => `${groupOf(c.desc)}/${c.desc.id}`)
      .sort()
      .join('|');
    if (key === this.partitionKey && this.partition) return;
    this.partitionKey = key;
    const rules = mergeRules(DEFAULT_MAPPING, this.style.mapping);
    const channels = live.map((c) => ({
      id: c.desc.id,
      kind: c.desc.kind,
      group: groupOf(c.desc),
      timescale: c.timescale,
    }));
    const p = partitionAreas(channels, rules, this.settled);
    this.partition = p;
    if (this.det || this.router.solo === undefined) this.settled = p;
    this.router.setPartition(p);
    const labels = new Map(live.map((c) => [c.desc.id, c.desc.label]));
    const groupOfId = new Map(channels.map((c) => [c.id, c.group]));
    this.partitionView = {
      level: p.level,
      groups: p.groups.map((g) => ({
        group: g.group,
        areas: [...g.areas],
        channels: Object.keys(p.channels)
          .filter((id) => groupOfId.get(id) === g.group)
          .sort()
          .map((id) => ({ id, label: labels.get(id) ?? id, areas: [...(p.channels[id] ?? [])] })),
      })),
    };
    // Sensor events follow the new owners of the effects at once.
    const genome = this.genome;
    if (genome && !this.det) {
      genome.fxTriggers = fxTriggers(
        channels,
        genome.chain,
        this.style.palette.effects ?? FX_IDS,
        p,
      );
    }
  }

  snapshot(): EngineSnapshot {
    const step = Math.max(0, this.step - 1);
    if (this.det) return this.songSnapshot(this.det, step);
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
      macros: { ...this.router.macros },
      waiting: this.waiting,
      section: this.section,
      phrase: Math.floor(rel / STEPS_PER_BAR / phraseBars),
      genome: (this.genome?.chain ?? 0).toString(16).padStart(8, '0').slice(0, 6),
    };
  }

  /** Tracks, routes and decisions on the latest step, for display. Nothing in it changes later. */
  view(): EngineView {
    if (this.trigCopiesFor !== this.patternVersion) {
      this.trigCopiesFor = this.patternVersion;
      this.trigCopies = new Map(
        this.runners.map((r) => [
          r.spec.slot,
          r.spec.trigs.slice(0, r.spec.length).map((t) => (t ? cloneTrig(t) : undefined)),
        ]),
      );
    }
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
        ...(t.option !== undefined ? { option: t.option } : {}),
        length: t.length,
        scale: t.scale,
        trigs: this.trigCopies.get(t.slot) ?? [],
        version: this.patternVersion,
        position: r.position,
        loop: r.loop,
        params: { ...(state?.params ?? t.base) },
        base: { ...t.base },
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
      mutations: [...this.mutations],
      fxTriggers: (this.genome?.fxTriggers ?? []).map((t) => ({ ...t })),
      ...(this.det ? { song: this.songView(this.det) } : {}),
      partition: this.partitionView,
      drift: this.drift,
    };
  }

  // Deterministic mode ------------------------------------------------------

  /**
   * One step of deterministic mode: read the inputs up to this moment, and
   * on a bar line turn the song into the version their edits call for. The
   * loop starts over every `loopBars` bars, playing exactly the same notes.
   */
  private tickSong(det: Seeded, stepSeconds: number): NoteEvent[] {
    const step = this.step++;
    const start = det.clock;
    det.clock += stepSeconds;
    // Sensors share out their effects among the channels in the log: the same log, the same share.
    const t = det.origin + start - det.delay;
    this.updatePartition(sharing(det, t));
    this.readInputs(det, t);
    this.waiting = false;
    const pos = step % (det.loopBars * STEPS_PER_BAR);
    det.pos = pos;
    let restarted = false;
    if (step % STEPS_PER_BAR === 0) {
      let reason: RebuildReason | undefined = step === 0 ? 'start' : undefined;
      if (this.pendingStyle) {
        this.style = this.pendingStyle;
        this.pendingStyle = undefined;
        this.router.setRules(mergeRules(DEFAULT_MAPPING, this.style.mapping));
        det.base = baseSong(this.style, det.seed, det.loopBars);
        if (det.evolve) det.evolve = { ...det.evolve, k: 0, spec: det.base };
        reason ??= 'style';
      }
      // Evolve: a new generation starts on a loop start.
      const ev = det.evolve;
      if (ev) {
        const k = Math.floor(Math.floor(step / STEPS_PER_BAR) / ev.bars);
        if (k !== ev.k) reason ??= 'evolve';
        while (ev.k < k) {
          ev.k++;
          ev.spec = evolveBase(ev.spec, ev.k, det.instruments);
        }
      }
      const edits = det.tracker.edits();
      const version = editsVersion(edits) + (ev && ev.k > 0 ? `.g${ev.k}` : '');
      if (version !== det.version) reason ??= 'edit';
      if (reason) {
        const song = buildSong(ev?.spec ?? det.base, edits);
        det.edits = edits.map((e) => ({ ...e, ...describeEdit(song, e) }));
        det.version = version;
        det.song = song;
        this.genomeVersion++;
        this.patternVersion++;
        this.rebuildInfo = { reason, step };
        this.markDrift(step, reason);
        this.startLoop(det, pos);
        restarted = true;
      } else if (pos === 0) {
        this.startLoop(det, 0);
        restarted = true;
      }
      this.measureSongDrift(det, step);
    }
    // After a stall the loop starts over where the clock now is.
    if (det.resync) {
      det.resync = false;
      if (!restarted) this.startLoop(det, pos);
    }
    return this.playSong(det, pos, step);
  }

  /** How far the song playing is from the seed's own. */
  private measureSongDrift(det: Seeded, step: number): void {
    const song = det.song;
    if (!song) return;
    const shape = (x: SongSpec) => ({ tracks: x.tracks, harmony: x.genes });
    const key = (x: SongSpec) => ({ root: x.root, mode: String(x.modeIndex) });
    const d = genomeDistance(shape(det.base), shape(song), { a: key(det.base), b: key(song) });
    this.pushDrift(Math.floor(step / STEPS_PER_BAR), d);
  }

  /** Edits registered since the last bar line, waiting for the next. */
  private pendingEdits(det: Seeded): PendingEdit[] {
    const atBar = Math.floor(Math.max(0, this.step - 1) / STEPS_PER_BAR) + 1;
    const cache = det.pending;
    if (cache.version === det.tracker.version && cache.atBar === atBar) return cache.list;
    const song = det.song;
    const now = new Map(det.tracker.edits().map((e) => [e.input, e]));
    const applied = new Map(det.edits.map((e) => [e.input, e]));
    const list: PendingEdit[] = [];
    for (const input of new Set([...now.keys(), ...applied.keys()])) {
      const next = now.get(input);
      const was = applied.get(input);
      if (next && was && next.count === was.count) continue;
      const e = (next ?? was) as EditView;
      list.push({
        ...e,
        count: next?.count ?? 0,
        was: was?.count ?? 0,
        atBar,
        ...(song ? describeEdit(song, e) : {}),
      });
    }
    list.sort((a, b) => (a.input < b.input ? -1 : a.input > b.input ? 1 : 0));
    det.pending = { version: det.tracker.version, atBar, list };
    return list;
  }

  /** Hands every press and reading up to time `t` to the edit tracker. */
  private readInputs(det: Seeded, t: number): void {
    for (const e of det.model.presses(det.readT, t)) {
      const desc = det.model.describe(e.id);
      const mapped = desc && det.mapper.press(e, desc.kind);
      if (!desc || !mapped) continue;
      det.tracker.press(pressInput(e), pressSource(e, desc.label), mapped.effect, mapped.repeat);
    }
    for (const id of det.model.takeRemoved()) det.tracker.forget(id);
    for (const r of det.model.readings(t)) {
      const desc = det.model.describe(r.id);
      const mapped = desc && det.mapper.sensor(desc, r.timescale, domainsOf(this.partition, r.id));
      if (mapped) {
        det.tracker.reading(r.id, r.label, r.x, mapped.map, {
          ...mapped,
          ...(desc.circular ? { circular: true } : {}),
        });
      }
    }
    det.readT = t;
  }

  /**
   * Starts the loop over with fresh runners, LFOs, chaos maps and effects,
   * then plays it silently up to `pos`, so the song sounds at `pos` exactly
   * as if it had been playing from the start of the loop.
   */
  private startLoop(det: Seeded, pos: number): void {
    const song = det.song;
    if (!song) return;
    this.runners = song.tracks.map(
      (t) => new TrackRunner(t, new Rng(hashInts(det.seed, slotSeed(t.slot), 0x5eed))),
    );
    this.realizers = new Map(song.tracks.map((t) => [t.slot, new Realizer()]));
    this.matrix = new ModMatrix(song.matrix);
    this.fxQueue = [];
    this.fxCooldown.clear();
    this.fxBusyUntil = -1;
    this.trackState.clear();
    for (let p = 0; p < pos; p++) this.playSong(det, p, -1);
  }

  /** The notes of step `pos` of the loop, stamped with the absolute `step`. */
  private playSong(det: Seeded, pos: number, step: number): NoteEvent[] {
    const song = det.song;
    const matrix = this.matrix;
    if (!song || !matrix) return [];
    const { palette } = song.style;
    const stepInBar = pos % STEPS_PER_BAR;
    const loopSteps = det.loopBars * STEPS_PER_BAR;
    this.fxNow = pos;
    const macros = songMacros(song);

    matrix.clearExternal();
    for (const m of MACROS) matrix.setSource(macroSource(m), 2 * macros[m] - 1);
    const offsets = matrix.evaluate();
    const off = (id: string) => offsets.get(id) ?? 0;
    this.globals = {
      tension: clamp(macros.tension + off(globalDest('tension'))),
      brightness: clamp(macros.brightness + off(globalDest('brightness'))),
      space: clamp(macros.space + off(globalDest('space'))),
      swing: clamp(song.swingLevel / (LEVELS - 1) + off(globalDest('swing'))),
      fx: clamp(0.5 + off(globalDest('fx'))),
    };

    const slot = song.chords[Math.floor(pos / song.chordSteps) % song.chords.length];
    if (!slot) return [];
    const h: HarmonyContext = {
      scale: slot.scale,
      chord: slot.chord,
      nextRoot: slot.nextRoot,
      chordMoves: slot.chordMoves,
      key: song.root,
      stepsUntilChordChange: song.chordSteps - (pos % song.chordSteps),
      stepInBar,
    };
    // The last bar of a loop of four bars or more plays its fills: a turnaround.
    const fill = det.loopBars >= 4 && pos >= loopSteps - STEPS_PER_BAR;

    const events: NoteEvent[] = [];
    const fired = new Map<string, number>();
    let nei = false;
    for (const runner of this.runners) {
      const spec = runner.spec;
      const params = {} as TrackParams;
      for (const p of TRACK_PARAMS) params[p] = clamp(spec.base[p] + off(trackDest(spec.slot, p)));
      let trigs = runner.step(pos, params, { fill, nei });
      if (spec.role === 'fx') {
        for (const f of trigs) if (f.trig.fx) this.queueFx(f.trig.fx, f.trig.vel, f.len);
        this.trackState.set(spec.slot, { params, fired: 0 });
        continue;
      }
      nei = runner.lastCond;
      const realizer = this.realizers.get(spec.slot) as Realizer;
      if (
        spec.role === 'drone' &&
        stepInBar === 0 &&
        trigs.length === 0 &&
        realizer.droneStale(h.scale)
      ) {
        const first = spec.trigs.find((t) => t);
        if (first) trigs = [{ trig: first, index: 0, micro: 0, len: spec.length / spec.scale }];
      }
      let firedVel = 0;
      if (!song.muted.has(spec.slot)) {
        for (const f of trigs) {
          const evs = this.realize(spec, f, params, h, macros, step, loopSteps - pos, realizer);
          for (const e of evs) e.loopStep = pos;
          events.push(...evs);
          for (const e of evs) firedVel = Math.max(firedVel, e.vel);
        }
      }
      if (firedVel > 0) fired.set(spec.slot, firedVel);
      this.trackState.set(spec.slot, { params, fired: firedVel });
    }

    const fx = this.emitFx(pos);
    if (fx) {
      fx.step = step;
      fx.loopStep = pos;
      const lane = this.trackState.get('fx');
      if (lane) lane.fired = fx.vel;
    }
    matrix.advance(offsets, fired);
    const out = capEvents(events, palette.maxEventsPerStep);
    if (fx) out.push(fx);
    return out;
  }

  private songChord() {
    const det = this.det;
    const song = det?.song;
    if (!det || !song) return undefined;
    return song.chords[Math.floor(det.pos / song.chordSteps) % song.chords.length];
  }

  private songSnapshot(det: Seeded, step: number): EngineSnapshot {
    const slot = this.songChord();
    return {
      step,
      bar: Math.floor(step / STEPS_PER_BAR),
      beat: Math.floor((step % STEPS_PER_BAR) / STEPS_PER_BEAT),
      styleId: this.style.id,
      keyName: slot?.keyName ?? '–',
      mode: slot?.mode ?? 'ionian',
      chord: slot?.chord ?? { degree: 0, size: 3 },
      chordRoman: slot?.roman ?? '–',
      chordName: slot?.name ?? '–',
      macros: { ...this.router.macros },
      waiting: this.waiting,
      section: 0,
      phrase: Math.floor(det.pos / STEPS_PER_BAR),
      genome: det.version,
      seed: det.seed,
    };
  }

  private songView(det: Seeded): SongView {
    return {
      version: det.version,
      loopBar: Math.floor(det.pos / STEPS_PER_BAR),
      loopBars: det.loopBars,
      edits: det.edits,
      pending: this.pendingEdits(det),
      sensors: det.tracker.sensors(),
      muted: [...(det.song?.muted ?? [])],
      ...(det.evolve ? { evolve: { generation: det.evolve.k, bars: det.evolve.bars } } : {}),
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
      if (this.farSteps >= SCENE_HOLD && this.sceneAt === undefined) {
        // The next bar line with time to rise into it, once the scene has had its bars,
        // and never past the section's end, where it would be lost in the section's rebuild.
        let at = (Math.floor(step / STEPS_PER_BAR) + 1) * STEPS_PER_BAR;
        if (at - step < 4) at += STEPS_PER_BAR;
        const end = this.sectionStart + this.style.palette.sectionBars * STEPS_PER_BAR;
        this.sceneAt = Math.min(
          Math.max(at, this.sectionStart + SCENE_MIN_BARS * STEPS_PER_BAR),
          end,
        );
        this.sceneRisen = false;
      }
    } else {
      this.farSteps = 0;
      this.sceneAt = undefined;
    }
    // A new scene is coming: rise into it during the bar before.
    const left = this.sceneAt !== undefined ? this.sceneAt - step : 0;
    if (this.sceneAt !== undefined && !this.sceneRisen && left <= STEPS_PER_BAR && left >= 2) {
      this.sceneRisen = true;
      this.queueFx('sweep', 0.8, left);
    }
    if (step % STEPS_PER_BAR !== 0) return;
    const { palette } = this.style;
    const barsIn = Math.floor((step - this.sectionStart) / STEPS_PER_BAR);
    // A section that ends while the sensors are far from where it started ends in a new
    // scene, even if they have not held there long enough to call one yet.
    if (
      (this.sceneAt !== undefined && step >= this.sceneAt) ||
      (barsIn >= palette.sectionBars && this.farSteps > 0)
    ) {
      this.section++;
      this.rebuild(step, fp, live, macros, 'scene');
    } else if (barsIn >= palette.sectionBars) {
      this.section++;
      this.rebuild(step, fp, live, macros, 'section');
    } else if (barsIn > 0 && barsIn % Math.max(1, palette.phraseBars) === 0 && this.genome) {
      const amount = clamp(0.25 + 0.75 * macros.variation);
      const rng = new Rng(hashInts(this.chain, barsIn, fp.fineHash));
      this.mutations = mutatePhrase(this.genome, rng, amount, palette);
      this.patternVersion++;
      this.harmony?.onPhraseStart(this.harmonyInputs(macros));
    }
  }

  /**
   * Writes the next genome. A section going by, a new scene or a resume
   * evolve the one playing (a little, more, quite a lot), so the music keeps
   * its identity and drifts; the start and a new style write a fresh one.
   */
  private rebuild(
    step: number,
    fp: Fingerprint,
    live: readonly ChannelState[],
    macros: Readonly<Macros>,
    reason: RebuildReason,
  ): void {
    const prev = this.genome;
    this.chain = prev ? nextChain(this.chain, fp, this.section) : firstChain(this.seed0, fp);
    const fresh = buildGenome(this.style, fp, this.chain, this.section, macros, this.partition);
    let genome = fresh;
    if (prev && (reason === 'section' || reason === 'scene' || reason === 'resume')) {
      const rate =
        reason === 'scene'
          ? EVOLVE_SCENE
          : reason === 'resume'
            ? EVOLVE_RESUME
            : EVOLVE_SECTION * (0.5 + macros.variation);
      const evolved = evolveGenome(prev, fresh, new Rng(hashInts(this.chain, 0xe701)), {
        rate,
        drift: driftOf(this.style),
        palette: this.style.palette,
      });
      genome = evolved.genome;
      this.mutations = evolved.changes;
    } else {
      this.mutations = [];
    }
    this.genome = genome;
    this.matrix = new ModMatrix(genome.matrix);
    this.runners = genome.tracks.map(
      (t) => new TrackRunner(t, new Rng(hashInts(this.chain, slotSeed(t.slot), 0x5eed))),
    );
    // A track keeps its voicing only while it is the same instrument in the same slot.
    const before = new Map((prev?.tracks ?? []).map((t) => [t.slot, t]));
    this.realizers = new Map(
      genome.tracks.map((t) => {
        const old = before.get(t.slot);
        const same = old && old.role === t.role && old.machine === t.machine;
        return [t.slot, (same && this.realizers.get(t.slot)) || new Realizer()];
      }),
    );
    this.sectionStart = step;
    this.anchor = fp;
    this.farSteps = 0;
    this.sceneAt = undefined;
    this.genomeVersion++;
    this.patternVersion++;
    const channel = reason === 'scene' ? this.farChannel : undefined;
    this.rebuildInfo = { reason, step, ...(channel ? { channel } : {}) };
    this.markDrift(step, reason);

    // The harmony reads this step's modulated tension and brightness.
    this.evaluateGlobals(live, macros);
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
    } else {
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
        const chordSteps = Math.max(1, Math.round(genome.harmony.chordRateBars * STEPS_PER_BAR));
        harmony.advance(inputs, this.chordStartsPhrase(0, chordSteps));
      }
    }
    if (!prev || reason === 'start' || reason === 'style') {
      const h = this.harmony as Harmony;
      this.origin = {
        genome: cloneGenome(genome),
        key: { root: h.root, mode: h.mode },
        bar: Math.floor(step / STEPS_PER_BAR),
      };
      this.driftHistory = [];
      this.driftMarks = [{ bar: 0, reason }];
    }
  }

  /** True when the chord after the one starting at `rel` starts a phrase. */
  private chordStartsPhrase(rel: number, chordSteps: number): boolean {
    const phraseSteps = Math.max(1, this.style.palette.phraseBars) * STEPS_PER_BAR;
    return (rel + chordSteps) % phraseSteps === 0;
  }

  /** Sets this step's sources and works out the globals, without moving the matrix on. */
  private evaluateGlobals(live: readonly ChannelState[], macros: Readonly<Macros>): void {
    const matrix = this.matrix;
    const genome = this.genome;
    if (!matrix || !genome) return;
    this.setSources(matrix, live, macros);
    const offsets = matrix.evaluate();
    this.globals = globalsFrom(macros, genome.swing, offsets);
  }

  private setSources(matrix: ModMatrix, live: readonly ChannelState[], macros: Readonly<Macros>) {
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
  }

  private markDrift(step: number, reason: RebuildReason): void {
    const bar = Math.floor(step / STEPS_PER_BAR) - (this.origin?.bar ?? 0);
    this.driftMarks = [...this.driftMarks, { bar, reason }].slice(-64);
  }

  /** At every bar line: how far the genome playing is from the first one. */
  private measureDrift(step: number): void {
    const origin = this.origin;
    const genome = this.genome;
    const harmony = this.harmony;
    if (!origin || !genome || !harmony) return;
    const d = genomeDistance(origin.genome, genome, {
      a: origin.key,
      b: { root: harmony.root, mode: harmony.mode },
    });
    this.pushDrift(Math.floor(step / STEPS_PER_BAR) - origin.bar, d);
  }

  private pushDrift(bar: number, d: { total: number; harmony: number; tracks: TrackDistance[] }) {
    this.driftHistory = [...this.driftHistory, d.total].slice(-DRIFT_HISTORY);
    this.drift = {
      bar,
      total: d.total,
      harmony: d.harmony,
      tracks: d.tracks,
      history: this.driftHistory,
      marks: this.driftMarks,
    };
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
    this.fxNow = step;

    // External sources for the matrix.
    this.setSources(matrix, live, macros);
    const offsets = matrix.evaluate();
    const off = (id: string) => offsets.get(id) ?? 0;
    this.globals = globalsFrom(macros, genome.swing, offsets);

    // Harmony: chords change on the genome's chord rate, counted from the section start.
    const chordSteps = Math.max(1, Math.round(genome.harmony.chordRateBars * STEPS_PER_BAR));
    if (rel > 0 && rel % chordSteps === 0) {
      harmony.advance(this.harmonyInputs(macros), this.chordStartsPhrase(rel, chordSteps));
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
    if (!allowed.includes(fx)) return;
    this.fxQueue.push({ fx, depth, steps: Math.max(1, steps), until: this.fxNow + FX_WAIT });
  }

  /** Effects fired by sensor events: onsets, or the lid closing fast. */
  private sensorFx(live: readonly ChannelState[]): void {
    const triggers = this.genome?.fxTriggers ?? [];
    for (const t of triggers) {
      if (this.freshOnsets.has(t.channelId)) this.queueFx(t.fx, 0.9, FX_INFO[t.fx].steps);
    }
    for (const ch of live) {
      if (ch.desc.kind !== 'lid.angle' || !owns(this.partition, ch.desc.id, 'space.fx')) continue;
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
    // Effects that could not fire wait a beat for their turn, then drop.
    this.fxQueue = this.fxQueue.filter((c) => c.until >= step);
    const i = this.fxQueue.findIndex((c) => {
      const info = FX_INFO[c.fx];
      if ((this.fxCooldown.get(c.fx) ?? -1) > step) return false;
      return !(info.exclusive && step < this.fxBusyUntil);
    });
    if (i >= 0) {
      const c = this.fxQueue.splice(i, 1)[0] as (typeof this.fxQueue)[number];
      const info = FX_INFO[c.fx];
      // The same effect queued twice fires once.
      this.fxQueue = this.fxQueue.filter((q) => q.fx !== c.fx);
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

/** The globals of a step: the dials plus what the matrix routes into them. */
function globalsFrom(
  macros: Readonly<Macros>,
  swing: number,
  offsets: ReadonlyMap<string, number>,
): GlobalParams {
  const off = (id: string) => offsets.get(id) ?? 0;
  return {
    tension: clamp(macros.tension + off(globalDest('tension'))),
    brightness: clamp(macros.brightness + off(globalDest('brightness'))),
    space: clamp(macros.space + off(globalDest('space'))),
    swing: clamp(swing + off(globalDest('swing'))),
    fx: clamp(0.5 + off(globalDest('fx'))),
  };
}

/** Macros of a song: the defaults, with its space and brightness levels. */
function songMacros(song: SongSpec): Macros {
  return {
    ...defaultMacros(),
    space: (song.spaceLevel + 0.5) / LEVELS,
    brightness: (song.brightnessLevel + 0.5) / LEVELS,
  };
}

/** What an edit does to a song, and the tracks it lands on. */
function describeEdit(song: SongSpec, e: EditView): { description: string; slots: string[] } {
  return {
    description: describeEffect(song, e.effect),
    slots: e.effect.target === undefined ? [] : effectTargets(song, e.effect).map((t) => t.slot),
  };
}

/** A number per track slot, for seeding its rolls. */
/**
 * The channels deterministic mode shares the areas among: the continuous
 * sensors heard by `t`. Keys, buttons and shakes act through their presses
 * wherever they are, and a sensor that has not read yet can do nothing with
 * an area, so neither takes one from a sensor that can.
 */
function sharing(det: Seeded, t: number): { desc: SensorDescriptor; timescale: Timescale }[] {
  const heard = new Set(det.model.readings(t).map((r) => r.id));
  return det.model
    .channels()
    .filter((c) => heard.has(c.desc.id) && sensorEffect(c.desc, c.timescale) !== undefined);
}

function slotSeed(slot: string): number {
  return Number(slot.slice(1)) || slot.length;
}

/** Which input a press belongs to: a key, a MIDI key or button of a channel, or a channel's onsets. */
function pressInput(e: SensorEvent): string {
  const v = Math.round(e.value);
  switch (e.kind) {
    case 'key':
      return `key:${KEY_CODES[v] ?? v}`;
    case 'onset':
      return `onset:${e.id}`;
    default:
      return `${e.kind}:${e.id}:${v}`;
  }
}

/** A press as the user would name it: "Key A", "Shake", "Keys C4", "Buttons 3". */
function pressSource(e: SensorEvent, label: string): string {
  const v = Math.round(e.value);
  switch (e.kind) {
    case 'key': {
      const code = KEY_CODES[v];
      return code ? `Key ${keyName(code)}` : 'Another key';
    }
    case 'note':
      return `${label} ${noteName(v)}`;
    case 'button':
      return `${label} ${v + 1}`;
    case 'onset':
      return label;
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
