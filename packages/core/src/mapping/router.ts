import { onePoleAlpha } from '../math';
import type { SensorHub } from '../sensors/hub';
import type { Features, Timescale } from '../sensors/types';
import {
  MACRO_INFO,
  MACROS,
  defaultMacros,
  noTriggers,
  type MacroId,
  type Macros,
  type TriggerId,
  type Triggers,
} from './macros';
import { MACRO_AREA, TRIGGER_AREA, owns, type Partition } from './partition';
import { DEFAULT_MAPPING, type FeatureId, type MappingRules } from './rules';

export interface MacroRoute {
  channelId: string;
  feature: FeatureId;
  macro: MacroId;
  weight: number;
  invert: boolean;
  /** Assigned by timescale because no rule matched the channel's kind. */
  auto: boolean;
}

export interface TriggerRoute {
  channelId: string;
  trigger: TriggerId;
  minStrength: number;
  auto: boolean;
}

/** Macros an unknown channel may drive, by timescale, in order of preference. */
const AUTO_TARGETS: Record<Timescale, { feature: FeatureId; macros: MacroId[] }> = {
  fast: { feature: 'activity', macros: ['energy', 'variation'] },
  medium: { feature: 'level', macros: ['brightness', 'texture', 'register', 'color'] },
  slow: { feature: 'level', macros: ['space', 'tension', 'color'] },
};

const AUTO_WEIGHT = 0.5;

/**
 * Connects sensor channels to macros. Channels whose kind matches a rule use
 * it; any other channel is auto-assigned by timescale to the least-used
 * suitable macro, which is how a brand-new sensor joins without code changes.
 *
 * With a partition (see `partitionAreas`), a channel only drives the dials
 * and triggers of the areas it controls, and every dial whose area has an
 * owner gets a driver: one sensor alone moves all eight.
 */
export class Router {
  readonly macros: Macros = defaultMacros();
  readonly targets: Macros = defaultMacros();
  private routes: MacroRoute[] = [];
  private triggerRoutes: TriggerRoute[] = [];
  private builtFor = '';
  private soloId: string | undefined;
  private partition: Partition | undefined;

  constructor(
    private readonly hub: SensorHub,
    private rules: MappingRules = DEFAULT_MAPPING,
  ) {}

  setRules(rules: MappingRules): void {
    this.rules = rules;
    this.builtFor = '';
  }

  /** Shares the dials out by area; `undefined` lets every channel drive its rules' dials. */
  setPartition(partition: Partition | undefined): void {
    // The same channels can be shared out anew (a style change re-deals them): compare the share, not the key.
    if (partition === this.partition) return;
    this.partition = partition;
    this.builtFor = '';
  }

  get currentPartition(): Partition | undefined {
    return this.partition;
  }

  /**
   * Lets a single channel drive the music on its own (others are ignored),
   * to hear what one sensor does. `undefined` turns solo off.
   */
  setSolo(channelId: string | undefined): void {
    this.soloId = channelId;
  }

  get solo(): string | undefined {
    return this.soloId;
  }

  /** Current routes (rebuilt automatically when channels change). */
  getRoutes(): { macros: readonly MacroRoute[]; triggers: readonly TriggerRoute[] } {
    this.ensureRoutes();
    return { macros: this.routes, triggers: this.triggerRoutes };
  }

  /** Advances macros by `dt` seconds and returns the triggers raised since the last update. */
  update(dt: number): { macros: Macros; triggers: Triggers } {
    this.ensureRoutes();
    const sum = {} as Record<MacroId, number>;
    const weight = {} as Record<MacroId, number>;
    for (const id of MACROS) {
      sum[id] = 0;
      weight[id] = 0;
    }
    for (const r of this.routes) {
      if (this.soloId !== undefined && r.channelId !== this.soloId) continue;
      const ch = this.hub.get(r.channelId);
      if (!ch || ch.stale) continue;
      let v = featureValue(ch.features, r.feature);
      if (r.invert) v = 1 - v;
      sum[r.macro] += v * r.weight;
      weight[r.macro] += r.weight;
    }
    for (const id of MACROS) {
      this.targets[id] = weight[id] > 0 ? sum[id] / weight[id] : MACRO_INFO[id].fallback;
      this.macros[id] +=
        (this.targets[id] - this.macros[id]) * onePoleAlpha(dt, MACRO_INFO[id].slewTau);
    }

    const triggers = noTriggers();
    for (const onset of this.hub.consumeOnsets()) {
      if (this.soloId !== undefined && onset.id !== this.soloId) continue;
      for (const r of this.triggerRoutes) {
        if (r.channelId === onset.id && onset.strength >= r.minStrength) {
          triggers[r.trigger] = Math.max(triggers[r.trigger], onset.strength);
        }
      }
    }
    return { macros: this.macros, triggers };
  }

  private ensureRoutes(): void {
    const p = this.partition;
    const key = `${this.hub.version}|${p?.key ?? '-'}`;
    if (this.builtFor === key) return;
    this.builtFor = key;
    const routes: MacroRoute[] = [];
    const triggerRoutes: TriggerRoute[] = [];
    const unmatched: { id: string; timescale: Timescale }[] = [];
    const channels = this.hub.list().filter((ch) => !p || ch.desc.id in p.channels);

    for (const ch of channels) {
      const { id, kind } = ch.desc;
      const rules = this.rules.macros.filter(
        (r) => r.kind === kind && owns(p, id, MACRO_AREA[r.macro]),
      );
      for (const r of rules) {
        routes.push({
          channelId: id,
          feature: r.feature,
          macro: r.macro,
          weight: r.weight ?? 1,
          invert: r.invert ?? false,
          auto: false,
        });
      }
      for (const r of this.rules.triggers) {
        if (r.kind !== kind || !owns(p, id, TRIGGER_AREA[r.trigger])) continue;
        triggerRoutes.push({
          channelId: id,
          trigger: r.trigger,
          minStrength: r.minStrength ?? 0,
          auto: false,
        });
      }
      if (rules.length === 0) unmatched.push({ id, timescale: ch.timescale });
    }

    for (const { id, timescale } of unmatched) {
      const target = AUTO_TARGETS[timescale];
      const allowed = target.macros.filter((m) => owns(p, id, MACRO_AREA[m]));
      const fallback = MACROS.filter((m) => owns(p, id, MACRO_AREA[m]));
      const pool = allowed.length > 0 ? allowed : fallback;
      if (pool.length > 0) {
        routes.push({
          channelId: id,
          feature: target.feature,
          macro: leastUsed(pool, routes),
          weight: AUTO_WEIGHT,
          invert: false,
          auto: true,
        });
      }
      if (timescale === 'fast' && owns(p, id, TRIGGER_AREA.accent)) {
        if (!triggerRoutes.some((r) => r.channelId === id && r.trigger === 'accent')) {
          triggerRoutes.push({ channelId: id, trigger: 'accent', minStrength: 0.3, auto: true });
        }
      }
    }

    // Every dial whose area has an owner gets a driver, so a sensor alone moves them all.
    if (p) {
      for (const m of MACROS) {
        if (routes.some((r) => r.macro === m)) continue;
        const owner = p.owners[MACRO_AREA[m]][0];
        const ch = owner !== undefined ? this.hub.get(owner) : undefined;
        if (!ch) continue;
        routes.push({
          channelId: owner as string,
          feature: AUTO_TARGETS[ch.timescale].feature,
          macro: m,
          weight: AUTO_WEIGHT,
          invert: false,
          auto: true,
        });
      }
    }
    this.routes = routes;
    this.triggerRoutes = triggerRoutes;
  }
}

function featureValue(f: Features, feature: FeatureId): number {
  switch (feature) {
    case 'level':
      return f.level;
    case 'activity':
      return f.activity;
    case 'trend':
      return 0.5 + 0.5 * f.trend;
  }
}

function leastUsed(candidates: readonly MacroId[], routes: readonly MacroRoute[]): MacroId {
  let best = candidates[0] as MacroId;
  let bestCount = Infinity;
  for (const m of candidates) {
    const count = routes.filter((r) => r.macro === m).length;
    if (count < bestCount) {
      best = m;
      bestCount = count;
    }
  }
  return best;
}
