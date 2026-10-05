import type { RenderStats } from '@sensinth/audio';
import type { RenderTestOptions } from '../src/render-test';

/** Hooks exposed by render-test.html (see src/render-test.ts). */
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
