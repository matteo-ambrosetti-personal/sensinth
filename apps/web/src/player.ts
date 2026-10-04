import { LookaheadScheduler, Renderer } from '@sensinth/audio';
import { Engine, SensorHub, type EngineSnapshot, type Style } from '@sensinth/core';
import { nowSeconds, type WebSensorSource } from './sensors/source';
import { ScreenWakeLock } from './wakeLock';

/**
 * Wires sensors, the engine, the renderer and the clock together. Every press
 * of Play starts a new piece (new seed, new key) from the live sensors.
 */
export class Player {
  readonly hub = new SensorHub();
  private engine: Engine;
  private ctx: AudioContext | undefined;
  private renderer: Renderer | undefined;
  private scheduler: LookaheadScheduler | undefined;
  private readonly sources = new Map<string, WebSensorSource>();
  private readonly wakeLock = new ScreenWakeLock();
  private style: Style;
  private bpm: number;
  private scope: AnalyserNode | undefined;

  constructor(style: Style, bpm: number) {
    this.style = style;
    this.bpm = bpm;
    this.engine = this.newEngine();
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

  /** While stopped, keeps the dials following the sensors. */
  idleUpdate(dt: number): void {
    if (!this.playing) {
      this.hub.markStale(nowSeconds());
      this.engine.router.update(dt);
    }
  }

  snapshot(): EngineSnapshot | undefined {
    return this.playing ? this.engine.snapshot() : undefined;
  }

  async addSource(source: WebSensorSource): Promise<void> {
    if (this.sources.has(source.id)) return;
    this.sources.set(source.id, source);
    await source.start(this.hub);
  }

  removeSource(id: string): void {
    this.sources.get(id)?.stop(this.hub);
    this.sources.delete(id);
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  async start(): Promise<void> {
    if (this.playing) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    this.ctx = ctx;
    this.engine = this.newEngine();

    this.scope = ctx.createAnalyser();
    this.scope.fftSize = 2048;
    const out = ctx.createGain();
    out.connect(ctx.destination);
    out.connect(this.scope);
    const renderer = new Renderer(ctx, this.style, out);
    renderer.setTempo(this.bpm);
    this.renderer = renderer;

    const scheduler = new LookaheadScheduler(ctx);
    scheduler.onStep = (_step, time, stepSeconds) => {
      this.hub.markStale(nowSeconds());
      const events = this.engine.tick(stepSeconds);
      // The engine changes style on a bar line; follow it there.
      if (this.engine.currentStyle !== this.style) {
        this.style = this.engine.currentStyle;
        renderer.loadStyle(this.style);
      }
      renderer.update(this.engine.router.macros, time);
      renderer.schedule(events, time, stepSeconds);
    };
    this.scheduler = scheduler;
    scheduler.start(this.bpm);
    void this.wakeLock.enable();
  }

  stop(): void {
    this.scheduler?.stop();
    this.scheduler = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    const ctx = this.ctx;
    this.ctx = undefined;
    if (ctx) setTimeout(() => void ctx.close(), 400);
    void this.wakeLock.disable();
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
      this.engine = this.newEngine();
    }
  }

  private newEngine(): Engine {
    return new Engine({
      style: this.style,
      hub: this.hub,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
  }
}
