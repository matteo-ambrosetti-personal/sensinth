import { renderOffline, type RenderStats } from '@sensinth/audio';
import { STYLES, getStyle } from '@sensinth/core';

export interface RenderTestOptions {
  bpm?: number;
  /** Mute every track but this slot. */
  only?: string;
  /** Mute every track. */
  none?: boolean;
}

declare global {
  interface Window {
    sensinthStyles: string[];
    sensinthRender: (
      styleId: string,
      bars: number,
      opts?: RenderTestOptions,
    ) => Promise<RenderStats>;
  }
}

window.sensinthStyles = STYLES.map((s) => s.id);
window.sensinthRender = async (styleId, bars, opts = {}) => {
  const style = getStyle(styleId);
  if (!style) throw new Error(`Unknown style ${styleId}`);
  const { only, none, bpm } = opts;
  const mute = none ? () => true : only ? (slot: string) => slot !== only : undefined;
  const { stats } = await renderOffline({
    style,
    bars,
    ...(bpm ? { bpm } : {}),
    ...(mute ? { mute } : {}),
  });
  return stats;
};
document.body.dataset.ready = 'true';
