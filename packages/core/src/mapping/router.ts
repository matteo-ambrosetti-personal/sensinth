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
 */
export class Router {
  readonly macros: Macros = defaultMacros();
  readonly targets: Macros = defaultMacros();
  private routes: MacroRoute[] = [];
  private triggerRoutes: TriggerRoute[] = [];
  private builtFor = -1;
  private ranges: Partial<Record<MacroId, [number, number]>> = {};

  constructor(
    private readonly hub: SensorHub,
    private rules: MappingRules = DEFAULT_MAPPING,
  ) {}

  setRules(rules: MappingRules): void {
    this.rules = rules;
    this.builtFor = -1;
  }

  /** Per-macro output range (from the style); targets are scaled into it. */
  setRanges(ranges: Partial<Record<MacroId, [number, number]>> = {}): void {
    this.ranges = ranges;
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
      const ch = this.hub.get(r.channelId);
      if (!ch || ch.stale) continue;
      let v = featureValue(ch.features, r.feature);
      if (r.invert) v = 1 - v;
      sum[r.macro] += v * r.weight;
      weight[r.macro] += r.weight;
    }
    for (const id of MACROS) {
      const raw = weight[id] > 0 ? sum[id] / weight[id] : MACRO_INFO[id].fallback;
      const [lo, hi] = this.ranges[id] ?? [0, 1];
      this.targets[id] = lo + (hi - lo) * raw;
      this.macros[id] +=
        (this.targets[id] - this.macros[id]) * onePoleAlpha(dt, MACRO_INFO[id].slewTau);
    }

    const triggers = noTriggers();
    for (const onset of this.hub.consumeOnsets()) {
      for (const r of this.triggerRoutes) {
        if (r.channelId === onset.id && onset.strength >= r.minStrength) {
          triggers[r.trigger] = Math.max(triggers[r.trigger], onset.strength);
        }
      }
    }
    return { macros: this.macros, triggers };
  }

  private ensureRoutes(): void {
    if (this.builtFor === this.hub.version) return;
    this.builtFor = this.hub.version;
    const routes: MacroRoute[] = [];
    const triggerRoutes: TriggerRoute[] = [];
    const unmatched: { id: string; timescale: Timescale }[] = [];

    for (const ch of this.hub.list()) {
      const { id, kind } = ch.desc;
      const rules = this.rules.macros.filter((r) => r.kind === kind);
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
      for (const r of this.rules.triggers.filter((t) => t.kind === kind)) {
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
      const macro = leastUsed(target.macros, routes);
      routes.push({
        channelId: id,
        feature: target.feature,
        macro,
        weight: AUTO_WEIGHT,
        invert: false,
        auto: true,
      });
      if (timescale === 'fast') {
        triggerRoutes.push({ channelId: id, trigger: 'accent', minStrength: 0.3, auto: true });
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
