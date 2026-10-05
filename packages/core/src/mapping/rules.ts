import type { MacroId, TriggerId } from './macros';

export type FeatureId = 'level' | 'trend' | 'activity';

/** "Channels of this kind drive this macro through this feature." */
export interface MacroRule {
  kind: string;
  feature: FeatureId;
  macro: MacroId;
  /** Relative weight when several channels drive the same macro (default 1). */
  weight?: number;
  /** Use 1 - value. */
  invert?: boolean;
}

/** "Onsets on channels of this kind raise this trigger." */
export interface TriggerRule {
  kind: string;
  trigger: TriggerId;
  /** Ignore onsets weaker than this (default 0). */
  minStrength?: number;
}

export interface MappingRules {
  macros: MacroRule[];
  triggers: TriggerRule[];
}

/** Default mapping from the shared sensor vocabulary to macros. */
export const DEFAULT_MAPPING: MappingRules = {
  macros: [
    { kind: 'motion.accel', feature: 'activity', macro: 'energy', weight: 1 },
    { kind: 'rotation.rate', feature: 'activity', macro: 'energy', weight: 0.5 },
    { kind: 'rotation.rate', feature: 'activity', macro: 'texture', weight: 0.3 },
    { kind: 'sound.level', feature: 'level', macro: 'energy', weight: 0.5 },
    { kind: 'geo.speed', feature: 'level', macro: 'energy', weight: 0.7 },
    { kind: 'orientation.pitch', feature: 'level', macro: 'register' },
    { kind: 'orientation.roll', feature: 'level', macro: 'texture' },
    { kind: 'heading', feature: 'level', macro: 'color' },
    { kind: 'camera.hue', feature: 'level', macro: 'color', weight: 0.5 },
    { kind: 'light', feature: 'level', macro: 'brightness' },
    { kind: 'camera.luma', feature: 'level', macro: 'brightness' },
    { kind: 'sound.brightness', feature: 'level', macro: 'brightness', weight: 0.3 },
    { kind: 'time.daylight', feature: 'level', macro: 'brightness', weight: 0.3 },
    { kind: 'temperature', feature: 'level', macro: 'brightness', weight: 0.4 },
    { kind: 'camera.motion', feature: 'activity', macro: 'variation' },
    { kind: 'pressure', feature: 'level', macro: 'tension', invert: true },
    { kind: 'pressure', feature: 'trend', macro: 'tension', invert: true, weight: 0.5 },
    { kind: 'humidity', feature: 'level', macro: 'space' },
    { kind: 'geo.altitude', feature: 'level', macro: 'space', weight: 0.3 },
    { kind: 'battery', feature: 'level', macro: 'texture', invert: true, weight: 0.2 },
    // Laptops: the pointer and keyboard stand in for motion and tilt.
    { kind: 'pointer.speed', feature: 'level', macro: 'energy' },
    { kind: 'pointer.y', feature: 'level', macro: 'register' },
    { kind: 'pointer.x', feature: 'level', macro: 'texture' },
    { kind: 'keys.rate', feature: 'activity', macro: 'variation' },
    { kind: 'pointer.force', feature: 'level', macro: 'energy', weight: 0.5 },
    // Hinges, covers and the body.
    { kind: 'lid.angle', feature: 'level', macro: 'space', weight: 0.6 },
    { kind: 'lid.angle', feature: 'activity', macro: 'variation', weight: 0.5 },
    { kind: 'proximity', feature: 'activity', macro: 'variation', weight: 0.5 },
    { kind: 'magnetic.field', feature: 'level', macro: 'color', weight: 0.5 },
    { kind: 'steps.rate', feature: 'level', macro: 'energy', weight: 0.8 },
    // The machine itself: heat, load and power make it tenser and busier.
    { kind: 'battery.power', feature: 'level', macro: 'tension', weight: 0.3 },
    { kind: 'battery.temperature', feature: 'level', macro: 'brightness', weight: 0.3 },
    { kind: 'temperature.device', feature: 'level', macro: 'texture', weight: 0.3 },
    { kind: 'thermal', feature: 'level', macro: 'tension', weight: 0.5 },
    { kind: 'cpu.load', feature: 'level', macro: 'variation', weight: 0.4 },
    { kind: 'memory.pressure', feature: 'level', macro: 'tension', weight: 0.3 },
    { kind: 'fan.speed', feature: 'level', macro: 'texture', weight: 0.4 },
    { kind: 'network.rate', feature: 'level', macro: 'variation', weight: 0.3 },
    { kind: 'wifi.rssi', feature: 'level', macro: 'color', weight: 0.4 },
    { kind: 'bluetooth.devices', feature: 'level', macro: 'space', weight: 0.3 },
    { kind: 'idle', feature: 'level', macro: 'energy', invert: true, weight: 0.4 },
    { kind: 'screen.brightness', feature: 'level', macro: 'brightness', weight: 0.4 },
    { kind: 'volume', feature: 'level', macro: 'energy', weight: 0.3 },
    // Controllers: triggers push energy; sticks and knobs are spread over the
    // dials by timescale, so each one moves something different.
    { kind: 'controller.trigger', feature: 'level', macro: 'energy', weight: 0.7 },
    { kind: 'controller.buttons', feature: 'activity', macro: 'variation', weight: 0.5 },
  ],
  triggers: [
    { kind: 'motion.accel', trigger: 'accent' },
    { kind: 'motion.accel', trigger: 'fill', minStrength: 0.7 },
    { kind: 'sound.level', trigger: 'accent' },
    { kind: 'camera.motion', trigger: 'fill', minStrength: 0.4 },
    { kind: 'keys.rate', trigger: 'accent' },
    { kind: 'pointer.speed', trigger: 'fill', minStrength: 0.8 },
    { kind: 'pointer.force', trigger: 'accent' },
    { kind: 'proximity', trigger: 'accent' },
    { kind: 'cover', trigger: 'fill' },
    { kind: 'lid.angle', trigger: 'fill', minStrength: 0.5 },
    { kind: 'motion.event', trigger: 'fill' },
    { kind: 'controller.buttons', trigger: 'accent' },
    { kind: 'midi.note', trigger: 'accent' },
  ],
};

/** Style rules first; a style rule replaces the default rule with the same kind and target. */
export function mergeRules(base: MappingRules, override?: Partial<MappingRules>): MappingRules {
  if (!override) return base;
  const macros = override.macros ?? [];
  const triggers = override.triggers ?? [];
  return {
    macros: [
      ...macros,
      ...base.macros.filter((r) => !macros.some((o) => o.kind === r.kind && o.macro === r.macro)),
    ],
    triggers: [
      ...triggers,
      ...base.triggers.filter(
        (r) => !triggers.some((o) => o.kind === r.kind && o.trigger === r.trigger),
      ),
    ],
  };
}
