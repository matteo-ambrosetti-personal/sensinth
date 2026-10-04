import type { RenderStats } from '@sensinth/audio';

/** Hooks exposed by render-test.html (see src/render-test.ts). */
declare global {
  interface Window {
    sensinthStyles: string[];
    sensinthRender: (styleId: string, bars: number, bpm?: number) => Promise<RenderStats>;
  }
}
