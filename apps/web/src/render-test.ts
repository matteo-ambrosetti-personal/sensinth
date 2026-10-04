import { renderOffline, type RenderStats } from '@sensinth/audio';
import { STYLES, getStyle } from '@sensinth/core';

declare global {
  interface Window {
    sensinthStyles: string[];
    sensinthRender: (styleId: string, bars: number, bpm?: number) => Promise<RenderStats>;
  }
}

window.sensinthStyles = STYLES.map((s) => s.id);
window.sensinthRender = async (styleId, bars, bpm) => {
  const style = getStyle(styleId);
  if (!style) throw new Error(`Unknown style ${styleId}`);
  const { stats } = await renderOffline({ style, bars, ...(bpm ? { bpm } : {}), seed: 1 });
  return stats;
};
document.body.dataset.ready = 'true';
