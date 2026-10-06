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
import { nowSeconds } from './sensors/source';
import { ScreenWakeLock } from './wakeLock';

/** What deterministic mode is set to: the seed, the loop and how inputs act. */
export type SongSettings = Required<
  Pick<DeterministicOptions, 'seed' | 'loopBars' | 'repeat' | 'sensors'>
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
  private style: Style;
  private bpm: number;
  private scope: AnalyserNode | undefined;
  /** Times (sensor clock) of recently scheduled drum hits. */
  private recentHits: number[] = [];
  private soloId: string | undefined;
  private readonly muted = new Set<string>();
  /** Engine views waiting for their step to sound, oldest first. */
  private views: { time: number; view: EngineView }[] = [];
  private current: EngineView | undefined;
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
      this.engine.router.update(dt);
    }
  }

  snapshot(): EngineSnapshot | undefined {
    return this.view()?.snapshot;
  }

  /** What the engine did on the step that is sounding now. */
  view(): EngineView | undefined {
    if (!this.playing || !this.ctx) return undefined;
    const now = this.ctx.currentTime;
    while (this.views.length > 0 && (this.views[0] as { time: number }).time <= now) {
      this.current = this.views.shift()?.view;
    }
    return this.current;
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
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    this.ctx = ctx;
    // Step 0 sounds START_DELAY from now.
    const origin = nowSeconds() + START_DELAY;
    if (this.seeded) this.beforeStart(origin);
    this.engine.dispose();
    this.engine = this.newEngine(this.seeded ? origin : undefined);
    this.views = [];
    this.current = undefined;

    this.scope = ctx.createAnalyser();
    this.scope.fftSize = 2048;
    const out = ctx.createGain();
    out.connect(ctx.destination);
    out.connect(this.scope);
    const renderer = new Renderer(ctx, this.style, out);
    renderer.setTempo(this.bpm);
    for (const slot of this.muted) renderer.setMuted(slot, true);
    this.renderer = renderer;

    let version = -1;
    const scheduler = new LookaheadScheduler(ctx);
    scheduler.onStep = (_step, time, stepSeconds) => {
      this.hub.markStale(nowSeconds());
      const events = this.engine.tick(stepSeconds);
      // The engine changes style on a bar line; follow it there.
      if (this.engine.currentStyle !== this.style) {
        this.style = this.engine.currentStyle;
        renderer.setStyle(this.style);
      }
      if (this.engine.genomeVersion !== version) {
        version = this.engine.genomeVersion;
        renderer.setFx(this.engine.fx);
        renderer.setTracks(this.engine.trackMachines());
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
      this.views.push({ time, view });
      if (this.views.length > MAX_QUEUED_VIEWS) this.views.shift();
      this.noteHits(events, time - ctx.currentTime);
    };
    this.scheduler = scheduler;
    scheduler.start(this.bpm, START_DELAY);
    void this.wakeLock.enable();
  }

  stop(): void {
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
    const ctx = this.ctx;
    this.ctx = undefined;
    if (ctx) setTimeout(() => void ctx.close(), 400);
    void this.wakeLock.disable();
  }

  /** Lets one channel drive the music alone (the Sensor lab's solo switch). */
  setSolo(channelId: string | undefined): void {
    this.soloId = channelId;
    this.engine.router.setSolo(channelId);
  }

  setMuted(slot: string, muted: boolean): void {
    if (muted) this.muted.add(slot);
    else this.muted.delete(slot);
    this.renderer?.setMuted(slot, muted);
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
