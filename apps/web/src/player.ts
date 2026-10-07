import { LookaheadScheduler, Renderer, type BusId } from '@sensinth/audio';
import {
  Engine,
  SensorHub,
  type DeterministicOptions,
  type EngineSnapshot,
  type EngineView,
  type FxId,
  type NoteEvent,
  type Style,
} from '@sensinth/core';
import { BackgroundPlayback } from './playback';
import { nowSeconds } from './sensors/source';
import { ScreenWakeLock } from './wakeLock';

/** What deterministic mode is set to: the seed, the loop and how inputs act. */
export type SongSettings = Required<
  Pick<
    DeterministicOptions,
    'seed' | 'loopBars' | 'repeat' | 'sensors' | 'instruments' | 'mapping' | 'evolve'
  >
>;

/** Seconds after one of our own drum hits during which mic onsets are ignored. */
const SELF_HIT_WINDOW: [number, number] = [-0.05, 0.3];
/** Views kept for steps scheduled ahead of the audio clock. */
const MAX_QUEUED_VIEWS = 32;
/** Seconds from pressing Play to the first step. */
const START_DELAY = 0.08;

/**
 * Wires sensors, the engine, the renderer and the clock together. Every
 * press of Play starts a new piece; the sensors pick everything in it. With
 * no live sensor, nothing plays.
 *
 * In deterministic mode the seed writes a song that loops until an input
 * changes; each input edits it its own way, read on the music's own clock
 * from the moment Play is pressed. It plays with no sensor too.
 */
export class Player {
  readonly hub = new SensorHub();
  private engine: Engine;
  private ctx: AudioContext | undefined;
  private renderer: Renderer | undefined;
  private scheduler: LookaheadScheduler | undefined;
  private readonly wakeLock = new ScreenWakeLock();
  /** In the Android app, keeps the music going with the screen off. */
  readonly background = new BackgroundPlayback();
  private style: Style;
  private bpm: number;
  private scope: AnalyserNode | undefined;
  /** Times (sensor clock) of recently scheduled drum hits. */
  private recentHits: number[] = [];
  private soloId: string | undefined;
  /** Muted track slots, with the instrument each held when it was muted. */
  private readonly muted = new Map<string, string | undefined>();
  /** Engine views waiting for their step to sound, oldest first, with the step's notes. */
  private views: { time: number; view: EngineView; events: readonly NoteEvent[] }[] = [];
  private current: EngineView | undefined;
  private currentEvents: readonly NoteEvent[] = [];
  /** A start in progress (the audio context resuming), so a second click does not start twice. */
  private starting: Promise<void> | undefined;
  /** Each track slot's instrument, as the renderer was last told. */
  private machines = new Map<string, string>();
  /** Pitch class to start each new piece in, e.g. from the current place. */
  keyHint: () => number | undefined = () => undefined;
  /** Deterministic mode and its settings, applied at the next Play. */
  private seeded: SongSettings | undefined;
  /**
   * Called just before a piece starts, with the sensor-clock time of its
   * first step: deterministic mode rewinds replays to it.
   */
  beforeStart: (origin: number) => void = () => {};

  constructor(style: Style, bpm: number) {
    this.style = style;
    this.bpm = bpm;
    this.engine = this.newEngine();
    this.hub.onsetGate = (id, t) => this.allowOnset(id, t);
  }

  get playing(): boolean {
    return this.scheduler?.running ?? false;
  }

  get router() {
    return this.engine.router;
  }

  /** The output analyser for the oscilloscope, while playing. */
  get analyserNode(): AnalyserNode | undefined {
    return this.playing ? this.scope : undefined;
  }

  /** A return's or the mix's analyser, while playing. */
  busAnalyser(bus: BusId): AnalyserNode | undefined {
    return this.playing ? this.renderer?.busAnalyser(bus) : undefined;
  }

  /** A track's analyser (after its mute), while playing. */
  trackAnalyser(slot: string): AnalyserNode | undefined {
    return this.playing ? this.renderer?.analyser(slot) : undefined;
  }

  /** Triggered effects sounding now. */
  fxNow(): FxId[] {
    if (!this.playing || !this.ctx || !this.renderer) return [];
    return this.renderer.fxAt(this.ctx.currentTime).map((p) => p.fx);
  }

  /** While stopped, keeps the dials following the sensors. */
  idleUpdate(dt: number): void {
    if (!this.playing) {
      this.hub.markStale(nowSeconds());
      this.engine.idle(dt);
    }
  }

  /** Who controls what, while stopped too. */
  partition(): EngineView['partition'] {
    return this.engine.partitionInfo;
  }

  snapshot(): EngineSnapshot | undefined {
    return this.view()?.snapshot;
  }

  /** What the engine did on the step that is sounding now. */
  view(): EngineView | undefined {
    if (!this.playing || !this.ctx) return undefined;
    const now = this.ctx.currentTime;
    while (this.views.length > 0 && (this.views[0] as { time: number }).time <= now) {
      const next = this.views.shift();
      this.current = next?.view;
      this.currentEvents = next?.events ?? [];
    }
    return this.current;
  }

  /** The notes of the step sounding now. */
  events(): readonly NoteEvent[] {
    this.view();
    return this.playing ? this.currentEvents : [];
  }

  /** True while a deterministic song plays (not just while the setting is on). */
  get playingDeterministic(): boolean {
    return this.playing && this.engine.seed !== undefined;
  }

  /** Turns deterministic mode on with its settings, or off; takes effect at the next Play. */
  setDeterministic(settings: SongSettings | undefined): void {
    this.seeded = settings ? { ...settings } : undefined;
  }

  get deterministic(): SongSettings | undefined {
    return this.seeded;
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  async start(): Promise<void> {
    if (this.playing) return;
    if (this.starting) return this.starting;
    this.starting = this.begin().finally(() => (this.starting = undefined));
    await this.starting;
    void this.wakeLock.enable();
    this.background.enable();
  }

  /**
   * Starts over: a new piece from its first step, or, in deterministic mode,
   * the seed's own song with every change undone. Also from a user gesture.
   */
  async restart(): Promise<void> {
    if (this.starting) await this.starting;
    if (!this.playing) return this.start();
    this.halt();
    this.starting = this.begin().finally(() => (this.starting = undefined));
    await this.starting;
  }

  stop(): void {
    this.halt();
    void this.wakeLock.disable();
    this.background.disable();
  }

  private async begin(): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
      await ctx.resume();
    } catch (err) {
      void ctx.close();
      throw err;
    }
    this.ctx = ctx;
    // Step 0 sounds START_DELAY from now.
    const origin = nowSeconds() + START_DELAY;
    if (this.seeded) this.beforeStart(origin);
    this.engine.dispose();
    this.engine = this.newEngine(this.seeded ? origin : undefined);
    this.views = [];
    this.current = undefined;
    this.currentEvents = [];

    this.scope = ctx.createAnalyser();
    this.scope.fftSize = 2048;
    const out = ctx.createGain();
    out.connect(ctx.destination);
    out.connect(this.scope);
    const renderer = new Renderer(ctx, this.style, out);
    renderer.setTempo(this.bpm);
    for (const slot of this.muted.keys()) renderer.setMuted(slot, true);
    this.renderer = renderer;

    let version = -1;
    const scheduler = new LookaheadScheduler(ctx);
    scheduler.onStep = (_step, time, stepSeconds, skipped) => {
      // Away from the screen the system may pause some sensors: they hold their last reading.
      if (document.visibilityState !== 'hidden') this.hub.markStale(nowSeconds());
      // The page stalled and the clock jumped: the music's own clock jumps with it.
      if (skipped > 0) this.engine.skip(skipped, stepSeconds);
      const events = this.engine.tick(stepSeconds);
      // The engine changes style on a bar line; follow it there.
      if (this.engine.currentStyle !== this.style) {
        this.style = this.engine.currentStyle;
        renderer.setStyle(this.style);
      }
      if (this.engine.genomeVersion !== version) {
        version = this.engine.genomeVersion;
        renderer.setFx(this.engine.fx);
        const machines = this.engine.trackMachines();
        renderer.setTracks(machines);
        this.followMachines(machines);
      }
      const view = this.engine.view();
      renderer.update(
        {
          macros: view.snapshot.macros,
          globals: view.globals,
          swing: view.swing,
          tracks: view.tracks,
        },
        time,
      );
      renderer.schedule(events, time, stepSeconds);
      this.views.push({ time, view, events });
      if (this.views.length > MAX_QUEUED_VIEWS) this.views.shift();
      this.noteHits(events, time - ctx.currentTime);
    };
    this.scheduler = scheduler;
    scheduler.start(this.bpm, START_DELAY);
  }

  /** Stops the sound and the clock, keeping the screen and background locks. */
  private halt(): void {
    this.scheduler?.stop();
    this.scheduler = undefined;
    // A deterministic engine keeps a log of the sensors: let it go.
    if (this.engine.seed !== undefined) {
      this.engine.dispose();
      this.engine = this.newEngine();
    }
    this.renderer?.dispose();
    this.renderer = undefined;
    this.views = [];
    this.current = undefined;
    this.currentEvents = [];
    const ctx = this.ctx;
    this.ctx = undefined;
    if (ctx) setTimeout(() => void ctx.close(), 400);
  }

  /** Lets one channel drive the music alone (the Sensor lab's solo switch). */
  setSolo(channelId: string | undefined): void {
    this.soloId = channelId;
    this.engine.router.setSolo(channelId);
  }

  setMuted(slot: string, muted: boolean): void {
    if (muted) this.muted.set(slot, this.machines.get(slot));
    else this.muted.delete(slot);
    this.renderer?.setMuted(slot, muted);
  }

  /**
   * A mute belongs to the instrument that was muted: when a slot gets
   * another instrument (a new piece, a new scene), it plays again.
   */
  private followMachines(machines: readonly { slot: string; machineId: string }[]): void {
    this.machines = new Map(machines.map((m) => [m.slot, m.machineId]));
    for (const [slot, machine] of [...this.muted]) {
      const now = this.machines.get(slot);
      if (machine === undefined) this.muted.set(slot, now);
      else if (now !== machine) this.setMuted(slot, false);
    }
  }

  isMuted(slot: string): boolean {
    return this.muted.has(slot);
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.scheduler?.setTempo(bpm);
    this.renderer?.setTempo(bpm);
  }

  setStyle(style: Style): void {
    if (this.playing) this.engine.setStyle(style);
    else {
      this.style = style;
      this.engine.dispose();
      this.engine = this.newEngine();
    }
  }

  /** A sensor-driven engine, or a deterministic one starting at `origin`. */
  private newEngine(origin?: number): Engine {
    const seeded = origin !== undefined ? this.seeded : undefined;
    // The seed alone picks the key in deterministic mode, not the place.
    const keyRoot = seeded ? undefined : this.keyHint();
    const engine = new Engine({
      style: this.style,
      hub: this.hub,
      ...(keyRoot !== undefined ? { keyRoot } : {}),
      ...(seeded && origin !== undefined ? { deterministic: { ...seeded, origin } } : {}),
    });
    engine.router.setSolo(this.soloId);
    return engine;
  }

  private noteHits(events: readonly NoteEvent[], secondsAhead: number): void {
    if (!events.some((e) => e.voice)) return;
    this.recentHits.push(nowSeconds() + secondsAhead);
    if (this.recentHits.length > 64) this.recentHits.shift();
  }

  /**
   * The microphone hears the music too. While playing, ignore sound onsets
   * that line up with our own drum hits, so the music does not trigger itself.
   */
  private allowOnset(id: string, t: number): boolean {
    if (!this.playing) return true;
    if (!this.hub.get(id)?.desc.kind.startsWith('sound.')) return true;
    const [before, after] = SELF_HIT_WINDOW;
    return !this.recentHits.some((h) => t - h > before && t - h < after);
  }
}
