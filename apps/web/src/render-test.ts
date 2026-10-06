import { renderOffline, type RenderStats } from '@sensinth/audio';
import {
  FX_IDS,
  STYLES,
  getStyle,
  type FxId,
  type InputMap,
  type RepeatMode,
  type SensorMode,
} from '@sensinth/core';

export interface RenderTestOptions {
  bpm?: number;
  /** Mute every track but this slot. */
  only?: string;
  /** Mute every track. */
  none?: boolean;
  /** Fire this effect every other bar. */
  fx?: FxId;
  /** Deterministic mode with this seed (no sensors; presses from `keys`). */
  seed?: number;
  loopBars?: number;
  repeat?: RepeatMode;
  sensors?: SensorMode;
  instruments?: boolean;
  mapping?: InputMap;
  /** Keys pressed at given times: `KeyboardEvent.code` and seconds from the start. */
  keys?: { code: string; at: number }[];
}

declare global {
  interface Window {
    sensinthStyles: string[];
    sensinthEffects: string[];
    sensinthRender: (
      styleId: string,
      bars: number,
      opts?: RenderTestOptions,
    ) => Promise<RenderStats>;
  }
}

window.sensinthStyles = STYLES.map((s) => s.id);
window.sensinthEffects = [...FX_IDS];
window.sensinthRender = async (styleId, bars, opts = {}) => {
  const style = getStyle(styleId);
  if (!style) throw new Error(`Unknown style ${styleId}`);
  const { only, none, bpm, fx, seed, keys, loopBars, repeat, sensors, instruments, mapping } = opts;
  const mute = none ? () => true : only ? (slot: string) => slot !== only : undefined;
  const { stats } = await renderOffline({
    style,
    bars,
    ...(bpm ? { bpm } : {}),
    ...(mute ? { mute } : {}),
    ...(fx ? { forceFx: fx } : {}),
    ...(seed !== undefined
      ? {
          deterministic: {
            seed,
            ...(loopBars ? { loopBars } : {}),
            ...(repeat ? { repeat } : {}),
            ...(sensors ? { sensors } : {}),
            ...(instruments !== undefined ? { instruments } : {}),
            ...(mapping ? { mapping } : {}),
          },
        }
      : {}),
    ...(keys ? { keys } : {}),
  });
  return stats;
};
document.body.dataset.ready = 'true';
