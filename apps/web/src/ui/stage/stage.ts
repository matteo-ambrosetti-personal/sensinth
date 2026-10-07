import type { EngineView, FxId, NoteEvent, TrackView } from '@sensinth/core';
import { Gfx, noise } from './gfx';
import { drawFloaters, type Floater, type Placed } from './kit';
import { SCENES } from './scenes';

/** The stage's own resolution; the canvas is scaled up by whole pixels. */
export const STAGE_W = 192;
export const STAGE_H = 108;
/** Frames per second the stage draws at. */
const FPS = 30;

/** What a cast member wants to play: a drum voice, a role, or anything. */
export type Want =
  | 'kick'
  | 'snare'
  | 'hats'
  | 'perc'
  | 'bass'
  | 'lead'
  | 'arp'
  | 'chords'
  | 'pad'
  | 'drums'
  | 'tonal'
  | 'any';

/** What one track is doing, as a figure sees it. */
export interface ActorState {
  /** False when no track plays this part: the figure dozes. */
  on: boolean;
  slot: string;
  role: TrackView['role'] | undefined;
  label: string;
  /** 1 on a hit, falling to 0. */
  hit: number;
  /** True on the frame a new hit arrived. */
  fresh: boolean;
  /** Velocity of the latest hit. */
  vel: number;
  /** Hits so far: even and odd hits can alternate hands. */
  count: number;
  /** The latest note, 0 low .. 1 high. */
  pitch: number;
  level: number;
  cutoff: number;
  pan: number;
  timbre: number;
  muted: boolean;
  /** Where the track is in its loop, 0..1. */
  pos: number;
  /** Seconds left of a "!" over it: an edit just landed on it. */
  mark: number;
}

export interface SceneState {
  g: Gfx;
  /** Seconds of music (slows during a tape stop). */
  t: number;
  dt: number;
  playing: boolean;
  /** Beats since the start (fractional), and where in the beat. */
  beats: number;
  beat: number;
  bar: number;
  /** How far the music has drifted, 0..1. */
  drift: number;
  energy: number;
  brightness: number;
  space: number;
  fx: ReadonlySet<FxId>;
  /** The figure playing a part of the cast, or an idle one. */
  actor(key: string): ActorState;
  /** Every bound actor, in cast order (for bands of any size). */
  band(): ActorState[];
  /** Where a figure's head is drawn, for marks above it. */
  place(key: string, at: Placed): void;
  /** Something floating up: a note, a spark. */
  float(f: Omit<Floater, 'age' | 'life'> & { life?: number }): void;
}

export interface CastSlot {
  key: string;
  want: readonly Want[];
}

export interface Scene {
  id: string;
  name: string;
  cast: readonly CastSlot[];
  draw(s: SceneState): void;
}

export interface StageInput {
  view: EngineView | undefined;
  events: readonly NoteEvent[];
  fx: readonly FxId[];
  playing: boolean;
  styleId: string;
  styleName: string;
  bpm: number;
  isMuted(slot: string): boolean;
}

const IDLE: ActorState = {
  on: false,
  slot: '',
  role: undefined,
  label: '',
  hit: 0,
  fresh: false,
  vel: 0,
  count: 0,
  pitch: 0.5,
  level: 0.5,
  cutoff: 0.7,
  pan: 0.5,
  timbre: 0.5,
  muted: false,
  pos: 0,
  mark: 0,
};

/** What kind of part a track is, for casting. */
function kindOf(t: TrackView): Want | undefined {
  switch (t.role) {
    case 'drum': {
      const v = t.voice ?? '';
      if (v === 'kick') return 'kick';
      if (v === 'snare' || v === 'clap' || v === 'rim') return 'snare';
      if (['hat', 'ohat', 'shaker', 'ride', 'brush', 'crash', 'cowbell'].includes(v)) return 'hats';
      return 'perc';
    }
    case 'bass':
      return 'bass';
    case 'lead':
      return 'lead';
    case 'arp':
      return 'arp';
    case 'chords':
      return 'chords';
    case 'pad':
    case 'drone':
      return 'pad';
    default:
      return undefined;
  }
}

function matches(kind: Want, want: Want): boolean {
  if (want === 'any') return true;
  if (want === 'drums')
    return kind === 'kick' || kind === 'snare' || kind === 'hats' || kind === 'perc';
  if (want === 'tonal') return !['kick', 'snare', 'hats', 'perc'].includes(kind);
  return kind === want;
}

/**
 * The screen: a little scene per style where a figure plays each track,
 * hitting, strumming and jumping with its notes, while effects shake, fog
 * or freeze the picture. Like a Pocket Operator's display: you see the
 * music as well as hear it.
 */
export class Stage {
  private readonly g: Gfx;
  private scene: Scene;
  private states = new Map<string, ActorState>();
  private binding = new Map<string, string>();
  private signature = '';
  private lastStep = -1;
  private stepAt = 0;
  private lastFrame = 0;
  private t = 0;
  private floaters: Floater[] = [];
  private places = new Map<string, Placed>();
  private wipe = 0;
  private lastRebuild = -1;
  private zTimer = 0;
  private label = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    this.g = new Gfx(ctx, STAGE_W, STAGE_H);
    this.scene = SCENES.free as Scene;
    const fit = () => {
      const box = canvas.parentElement?.clientWidth ?? STAGE_W;
      // Whole pixels where there is room for at least twice the size; else fill the width.
      const scale = Math.min(4, Math.floor(box / STAGE_W));
      canvas.style.width = scale >= 2 ? `${STAGE_W * scale}px` : '100%';
    };
    if (canvas.parentElement) new ResizeObserver(fit).observe(canvas.parentElement);
    fit();
  }

  /** An edit just landed on these tracks: a "!" over their figures. */
  react(slots: readonly string[]): void {
    for (const slot of slots) {
      const s = this.states.get(slot);
      if (s) s.mark = 1.6;
    }
  }

  frame(input: StageInput, now: number): void {
    if (now - this.lastFrame < 1000 / FPS - 2) return;
    const dt = Math.min(0.1, this.lastFrame ? (now - this.lastFrame) / 1000 : 1 / FPS);
    this.lastFrame = now;
    const view = input.playing ? input.view : undefined;
    const sceneId = view?.snapshot.styleId ?? input.styleId;
    const scene = SCENES[sceneId] ?? (SCENES.free as Scene);
    if (scene !== this.scene) {
      this.scene = scene;
      this.signature = '';
      this.wipe = 1;
    }
    const fx = new Set(input.fx);
    // A tape stop or a brake slows the whole picture down.
    const slow = fx.has('tapeStop') || fx.has('brake') ? 0.25 : 1;
    this.t += dt * slow;
    this.follow(view, input, now, dt);

    const g = this.g;
    const ctx = g.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const shake = fx.has('stutter') ? Math.round((noise(Math.floor(now / 40)) - 0.5) * 4) : 0;
    ctx.translate(shake, 0);
    this.places.clear();
    const stepSeconds = 60 / Math.max(20, input.bpm) / 4;
    const step = view
      ? view.snapshot.step + Math.min(1, (now - this.stepAt) / 1000 / stepSeconds)
      : this.t / stepSeconds;
    const snap = view?.snapshot;
    const state: SceneState = {
      g,
      t: this.t,
      dt: dt * slow,
      playing: !!view && !snap?.waiting,
      beats: step / 4,
      beat: (step / 4) % 1,
      bar: Math.floor(step / 16),
      drift: view?.drift.total ?? 0,
      energy: snap?.macros.energy ?? 0.4,
      brightness: view?.globals.brightness ?? 0.5,
      space: view?.globals.space ?? 0.5,
      fx,
      actor: (key) => {
        const slot = this.binding.get(key);
        return (slot && this.states.get(slot)) || IDLE;
      },
      band: () =>
        this.scene.cast
          .map((c) => this.binding.get(c.key))
          .flatMap((slot) =>
            slot && this.states.get(slot) ? [this.states.get(slot) as ActorState] : [],
          ),
      place: (key, at) => this.places.set(key, at),
      float: (f) => this.floaters.push({ ...f, age: 0, life: f.life ?? 1.2 }),
    };
    scene.draw(state);
    ctx.restore();
    this.floaters = drawFloaters(g, this.floaters, dt);
    this.marks(dt);
    this.effects(fx, now, state.beats);
    this.transition(view, dt);
    this.hud(input, view);
    this.describe(input);
  }

  /** Follows the tracks: who plays which part, and every new hit. */
  private follow(view: EngineView | undefined, input: StageInput, now: number, dt: number): void {
    const tracks = view?.tracks.filter((t) => t.role !== 'fx') ?? [];
    const signature = tracks.map((t) => `${t.slot}:${t.machine}`).join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.cast(tracks);
    }
    const newStep = view !== undefined && view.snapshot.step !== this.lastStep;
    if (newStep) {
      this.lastStep = view.snapshot.step;
      this.stepAt = now;
    }
    const decay = Math.exp(-dt * 7);
    for (const s of this.states.values()) {
      s.hit *= decay;
      s.fresh = false;
      s.mark = Math.max(0, s.mark - dt);
    }
    for (const t of tracks) {
      const s = this.states.get(t.slot);
      if (!s) continue;
      s.level = t.params.level;
      s.cutoff = t.params.cutoff;
      s.pan = t.params.pan;
      s.timbre = t.params.timbre;
      s.muted = input.isMuted(t.slot);
      s.pos = t.length > 0 ? Math.max(0, t.position) / t.length : 0;
      if (newStep && t.fired > 0 && !s.muted) {
        s.hit = 1;
        s.fresh = true;
        s.vel = t.fired;
        s.count++;
      }
    }
    if (newStep) {
      for (const e of input.events) {
        const s = this.states.get(e.part);
        if (s && e.midi !== undefined) s.pitch = Math.max(0, Math.min(1, (e.midi - 36) / 60));
      }
    }
  }

  /** Gives each part of the cast a track that suits it, in cast order. */
  private cast(tracks: readonly TrackView[]): void {
    const states = new Map<string, ActorState>();
    for (const t of tracks) {
      const old = this.states.get(t.slot);
      states.set(t.slot, {
        ...(old ?? IDLE),
        on: true,
        slot: t.slot,
        role: t.role,
        label: t.label,
      });
    }
    this.states = states;
    this.binding.clear();
    const free = tracks.map((t) => ({ t, kind: kindOf(t) })).filter((x) => x.kind !== undefined);
    for (const slot of this.scene.cast) {
      for (const want of slot.want) {
        const i = free.findIndex((x) => matches(x.kind as Want, want));
        if (i < 0) continue;
        const [taken] = free.splice(i, 1);
        if (taken) this.binding.set(slot.key, taken.t.slot);
        break;
      }
    }
  }

  /** "!" over figures an edit just landed on, "z" over muted ones. */
  private marks(dt: number): void {
    const g = this.g;
    this.zTimer += dt;
    const blink = Math.floor(this.lastFrame / 150) % 2 === 0;
    for (const [key, at] of this.places) {
      const slot = this.binding.get(key);
      const s = slot ? this.states.get(slot) : undefined;
      if (!s) continue;
      if (s.mark > 0 && blink) {
        g.rect(at.x - 2, at.y - 9, 5, 7, '#000');
        g.text('!', at.x, at.y - 8, '#f8d030');
      }
      if (s.muted && this.zTimer > 0.9) {
        this.floaters.push({
          x: at.x + 3,
          y: at.y - 2,
          age: 0,
          life: 1.4,
          color: '#c0c8ff',
          kind: 'z',
        });
      }
    }
    if (this.zTimer > 0.9) this.zTimer = 0;
  }

  /** The whole-mix effects, on the whole picture. */
  private effects(fx: ReadonlySet<FxId>, now: number, beats: number): void {
    const { ctx, w, h } = this.g;
    const g = this.g;
    if (fx.has('stutter')) {
      for (let i = 0; i < 5; i++) {
        const y = Math.floor(noise(Math.floor(now / 60) * 7 + i) * h);
        const bh = 2 + Math.floor(noise(i + Math.floor(now / 60)) * 6);
        ctx.drawImage(this.canvas, 0, y, w, bh, i % 2 ? 4 : -4, y, w, bh);
      }
    }
    if (fx.has('dubThrow')) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(this.canvas, 3, 1);
      ctx.globalAlpha = 1;
    }
    if (fx.has('tapeStop') || fx.has('brake')) {
      ctx.globalCompositeOperation = 'saturation';
      g.rect(0, 0, w, h, '#000000');
      ctx.globalCompositeOperation = 'source-over';
    }
    if (fx.has('ring')) {
      ctx.globalCompositeOperation = 'hue';
      ctx.globalAlpha = 0.5;
      g.rect(0, 0, w, h, ['#ff40a0', '#40ffa0', '#40a0ff'][Math.floor(now / 120) % 3] as string);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (fx.has('wash')) {
      for (let y = 0; y < h; y += 2)
        for (let x = (y / 2) % 2; x < w; x += 2) g.px(x, y, 'rgba(255,255,255,0.35)');
    }
    if (fx.has('dive')) {
      ctx.globalAlpha = 0.45;
      g.rect(0, 0, w, h, '#000030');
      ctx.globalAlpha = 1;
    }
    if (fx.has('sweep')) {
      const k = (now / 900) % 1;
      for (let i = 0; i < 4; i++) {
        const y = Math.round(h - ((k + i / 4) % 1) * h);
        g.rect(0, y, w, 1, 'rgba(255,255,220,0.5)');
      }
    }
    if (fx.has('crush')) {
      for (let i = 0; i < 40; i++) {
        const n = Math.floor(now / 50) * 97 + i;
        g.rect(
          Math.floor(noise(n) * w),
          Math.floor(noise(n + 1) * h),
          2,
          2,
          noise(n + 2) > 0.5 ? '#000' : '#fff',
        );
      }
    }
    if (fx.has('gate') && (beats * 4) % 1 > 0.5) {
      ctx.globalAlpha = 0.55;
      g.rect(0, 0, w, h, '#000');
      ctx.globalAlpha = 1;
    }
  }

  /** A wipe when the pattern is rewritten: a new section, scene, style or edit. */
  private transition(view: EngineView | undefined, dt: number): void {
    const r = view?.rebuild.step ?? -1;
    if (view && r !== this.lastRebuild) {
      if (this.lastRebuild >= 0 && view.rebuild.reason !== 'start') this.wipe = 1;
      this.lastRebuild = r;
    }
    if (!view) this.lastRebuild = -1;
    if (this.wipe <= 0) return;
    const g = this.g;
    // Diamonds closing then opening, like a level change.
    const k = 1 - this.wipe;
    const size = Math.round((k < 0.5 ? k * 2 : (1 - k) * 2) * 9);
    if (size > 0) {
      for (let y = 0; y < g.h; y += 8) {
        for (let x = 0; x < g.w; x += 8) g.circle(x + 4, y + 4, size, '#000', size);
      }
    }
    this.wipe = Math.max(0, this.wipe - dt * 2.6);
  }

  private hud(input: StageInput, view: EngineView | undefined): void {
    const g = this.g;
    const name = (view ? this.scene.name : input.styleName).toUpperCase();
    g.text(name, 3, 3, '#ffffff', 1, '#000000');
    if (!input.playing) {
      if (Math.floor(this.lastFrame / 500) % 2 === 0) {
        const msg = 'PRESS ▶ PLAY';
        const w = g.textWidth(msg, 1);
        g.rect((g.w - w) / 2 - 3, 46, w + 6, 9, '#000');
        g.text(msg, (g.w - w) / 2, 48, '#f8d030');
      }
      return;
    }
    if (view?.snapshot.waiting) {
      const msg = 'WAITING FOR A SENSOR...';
      const w = g.textWidth(msg);
      g.rect((g.w - w) / 2 - 3, 46, w + 6, 9, '#000');
      g.text(msg, (g.w - w) / 2, 48, '#ffffff');
      return;
    }
    const song = view?.song;
    const right = song
      ? `LOOP ${song.loopBar + 1}/${song.loopBars}`
      : `SEC ${(view?.snapshot.section ?? 0) + 1}`;
    g.text(right, g.w - g.textWidth(right) - 3, 3, '#ffffff', 1, '#000000');
  }

  /** The screen in words, for screen readers, now and then. */
  private describe(input: StageInput): void {
    const band = this.scene.cast
      .map((c) => this.binding.get(c.key))
      .flatMap((slot) => (slot ? [this.states.get(slot)?.label ?? slot] : []));
    const label = !input.playing
      ? `${input.styleName}: the band waits for Play`
      : `${this.scene.name}: ${band.length > 0 ? band.join(', ') : 'nobody'} playing`;
    if (label !== this.label) {
      this.label = label;
      this.canvas.setAttribute('aria-label', label);
    }
  }
}
