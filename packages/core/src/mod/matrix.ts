import { clamp } from '../math';
import type { MacroId } from '../mapping/macros';
import { LogisticMap } from './chaos';
import { Lfo, type LfoSpec } from './lfo';
import type { GlobalParam, TrackParam } from './params';

/**
 * How a source value is shaped before scaling: `exp` is gentle near the
 * center, `step` quantizes to a few levels, `fold` rises then falls again.
 */
export type Curve = 'lin' | 'exp' | 'step' | 'fold';
export const CURVES: readonly Curve[] = ['lin', 'exp', 'step', 'fold'];

/** `amount × curve(source)` is added to `dest` every step. */
export interface Route {
  source: string;
  dest: string;
  /** −1..1. */
  amount: number;
  curve: Curve;
}

export interface RouteView extends Route {
  /** What the route adds to its destination on the latest step. */
  value: number;
}

export type SensorFeature = 'level' | 'activity' | 'trend' | 'onset' | 'jitter';
export type ChaosId = 'a' | 'b';
export type SourceKind = 'sensor' | 'macro' | 'lfo' | 'chaos' | 'env';

/*
 * Source and destination ids. Sources: `s:<channel>:<feature>`, `m:<macro>`,
 * `lfo:<slot>`, `chaos:<a|b>`, `env:<slot>`. Destinations: `<slot>.<param>`,
 * `lfo:<slot>.rate|depth`, `chaos:<a|b>.r`, `g.<global>`.
 */
export const sensorSource = (channelId: string, feature: SensorFeature): string =>
  `s:${channelId}:${feature}`;
export const macroSource = (macro: MacroId): string => `m:${macro}`;
export const lfoSource = (slot: string): string => `lfo:${slot}`;
export const envSource = (slot: string): string => `env:${slot}`;
export const chaosSource = (id: ChaosId): string => `chaos:${id}`;
export const trackDest = (slot: string, param: TrackParam): string => `${slot}.${param}`;
export const lfoDest = (slot: string, what: 'rate' | 'depth'): string => `lfo:${slot}.${what}`;
export const chaosDest = (id: ChaosId): string => `chaos:${id}.r`;
export const globalDest = (param: GlobalParam): string => `g.${param}`;

export function sourceKind(source: string): SourceKind {
  if (source.startsWith('s:')) return 'sensor';
  if (source.startsWith('m:')) return 'macro';
  if (source.startsWith('lfo:')) return 'lfo';
  if (source.startsWith('chaos:')) return 'chaos';
  return 'env';
}

/** Channel id and feature of a sensor source id. */
export function parseSensorSource(source: string): { channelId: string; feature: SensorFeature } {
  const body = source.slice(2);
  const cut = body.lastIndexOf(':');
  return { channelId: body.slice(0, cut), feature: body.slice(cut + 1) as SensorFeature };
}

export function applyCurve(v: number, curve: Curve): number {
  switch (curve) {
    case 'lin':
      return v;
    case 'exp':
      return Math.sign(v) * v * v;
    case 'step':
      return Math.round(v * 3) / 3;
    case 'fold':
      return Math.sin(Math.PI * v);
  }
}

export interface ChaosSpec {
  /** Starting point, 0..1. */
  start: number;
  /** Growth rate 0..1 over the chaotic range, before modulation. */
  r: number;
}

export interface MatrixSpec {
  routes: Route[];
  /** One LFO per track slot. */
  lfos: Record<string, LfoSpec>;
  chaos: Record<ChaosId, ChaosSpec>;
}

/** Per-step decay of a track's trig envelope. */
const ENV_DECAY = 0.72;
/** How strongly chaos map A pushes map B's growth rate. */
const CHAOS_COUPLING = 0.3;

/**
 * The modulation matrix. Sources are sensor features, macros, LFOs, two
 * cross-coupled chaos maps and per-track trig envelopes; destinations are
 * track params, LFO rates and depths, chaos rates and global params.
 *
 * Every step: the caller sets the external sources, `evaluate` sums each
 * route into its destination, then `advance` moves the LFOs, chaos maps and
 * envelopes using this step's modulated values. Internal sources are read one
 * step later, so feedback loops (LFO A → LFO B rate → LFO A depth) are
 * allowed and stay bounded.
 */
export class ModMatrix {
  readonly routes: Route[];
  private readonly lfos = new Map<string, Lfo>();
  private readonly chaosMaps: Record<ChaosId, { map: LogisticMap; r: number }>;
  private readonly env = new Map<string, number>();
  private readonly values = new Map<string, number>();
  private contributions: number[] = [];

  constructor(spec: MatrixSpec) {
    this.routes = spec.routes;
    for (const [slot, lfo] of Object.entries(spec.lfos)) {
      this.lfos.set(slot, new Lfo(lfo));
      this.env.set(slot, 0);
    }
    this.chaosMaps = {
      a: { map: new LogisticMap(spec.chaos.a.start), r: spec.chaos.a.r },
      b: { map: new LogisticMap(spec.chaos.b.start), r: spec.chaos.b.r },
    };
    this.refreshInternal();
  }

  /** Sets an external source (sensor feature or macro). Non-finite values are ignored. */
  setSource(id: string, value: number): void {
    if (Number.isFinite(value)) this.values.set(id, clamp(value, -1, 1));
  }

  /** Forgets every sensor and macro value, before setting the ones that are live now. */
  clearExternal(): void {
    for (const id of this.values.keys()) {
      if (id.startsWith('s:') || id.startsWith('m:')) this.values.delete(id);
    }
  }

  /** Current value of a source, −1..1 (unipolar sources 0..1), or undefined if not present. */
  source(id: string): number | undefined {
    return this.values.get(id);
  }

  /** Sum of every route's contribution, per destination. Missing sources contribute 0. */
  evaluate(): Map<string, number> {
    const offsets = new Map<string, number>();
    this.contributions = this.routes.map((r) => {
      const v = this.values.get(r.source);
      if (v === undefined) return 0;
      const c = clamp(r.amount, -1, 1) * applyCurve(v, r.curve);
      offsets.set(r.dest, (offsets.get(r.dest) ?? 0) + c);
      return c;
    });
    return offsets;
  }

  /**
   * Moves the internal sources one step. `fired` holds the velocity of every
   * track that played a trig on this step.
   */
  advance(offsets: ReadonlyMap<string, number>, fired: ReadonlyMap<string, number>): void {
    const off = (id: string) => offsets.get(id) ?? 0;
    for (const [slot, lfo] of this.lfos) {
      lfo.advance(0.5 + off(lfoDest(slot, 'rate')), 0.5 + off(lfoDest(slot, 'depth')));
    }
    const a = this.chaosMaps.a;
    const b = this.chaosMaps.b;
    const xa = a.map.step(a.r + off(chaosDest('a')));
    b.map.step(b.r + off(chaosDest('b')) + CHAOS_COUPLING * (xa - 0.5));
    for (const [slot, e] of this.env) this.env.set(slot, e * ENV_DECAY);
    for (const [slot, vel] of fired) {
      this.env.set(slot, Math.max(this.env.get(slot) ?? 0, clamp(vel)));
    }
    this.refreshInternal();
  }

  view(): RouteView[] {
    return this.routes.map((r, i) => ({ ...r, value: this.contributions[i] ?? 0 }));
  }

  private refreshInternal(): void {
    for (const [slot, lfo] of this.lfos) this.values.set(lfoSource(slot), lfo.value);
    for (const id of ['a', 'b'] as const) {
      this.values.set(chaosSource(id), this.chaosMaps[id].map.x * 2 - 1);
    }
    for (const [slot, e] of this.env) this.values.set(envSource(slot), e);
  }
}
