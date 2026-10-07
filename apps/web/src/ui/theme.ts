/**
 * The colour tokens canvases draw with, read once from the page's CSS (one
 * theme: the console's), so nothing calls `getComputedStyle` every frame.
 */
export interface Theme {
  bg: string;
  panel: string;
  inset: string;
  ink: string;
  muted: string;
  line: string;
  frame: string;
  accent: string;
  go: string;
  stop: string;
  cyan: string;
  magenta: string;
  orange: string;
  scopeGrid: string;
  chartLevel: string;
  chartActivity: string;
  chartOnset: string;
  /** Track colours, by slot number (t1 → tracks[0]). */
  tracks: string[];
  /** Area colours, by domain. */
  areas: Record<'rhythm' | 'harmony' | 'sound' | 'space' | 'motion', string>;
  fontMono: string;
  fontDisplay: string;
}

let cached: Theme | undefined;

export function theme(): Theme {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  cached = {
    bg: v('--bg', '#06061a'),
    panel: v('--panel', '#121c6c'),
    inset: v('--inset', '#050a30'),
    ink: v('--ink', '#f4f4ff'),
    muted: v('--muted', '#a9b2ec'),
    line: v('--line', '#3d4cbc'),
    frame: v('--frame', '#eeeefa'),
    accent: v('--accent', '#f8d030'),
    go: v('--go', '#48d860'),
    stop: v('--stop', '#f04848'),
    cyan: v('--cyan', '#40c8f8'),
    magenta: v('--magenta', '#e060f0'),
    orange: v('--orange', '#f89838'),
    scopeGrid: v('--scope-grid', 'rgba(255,255,255,0.08)'),
    chartLevel: v('--chart-level', '#48d860'),
    chartActivity: v('--chart-activity', '#e060f0'),
    chartOnset: v('--chart-onset', '#f89838'),
    tracks: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--t${i}`, '#f4f4ff')),
    areas: {
      rhythm: v('--a-rhythm', '#f05858'),
      harmony: v('--a-harmony', '#f8d030'),
      sound: v('--a-sound', '#40c8f8'),
      space: v('--a-space', '#e070f0'),
      motion: v('--a-motion', '#58d860'),
    },
    fontMono: v('--font-mono', 'monospace'),
    fontDisplay: v('--font-display', 'monospace'),
  };
  return cached;
}

/** A track's colour, by its slot (`t3` → the third colour; the FX lane is muted). */
export function trackColor(slot: string): string {
  const t = theme();
  const n = Number(slot.slice(1));
  return Number.isFinite(n) && n >= 1 ? (t.tracks[(n - 1) % t.tracks.length] as string) : t.muted;
}

/** The CSS custom property holding a track's colour, for inline styles. */
export function trackColorVar(slot: string): string {
  const n = Number(slot.slice(1));
  return Number.isFinite(n) && n >= 1 ? `var(--t${((n - 1) % 8) + 1})` : 'var(--muted)';
}
