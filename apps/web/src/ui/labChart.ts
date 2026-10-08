import { theme } from './theme';

/** One recorded moment of the channel under test. */
export interface LabSample {
  t: number;
  raw: number;
  normalized: number;
  level: number;
  activity: number;
  trend: number;
  onset: boolean;
}

export const WINDOW_SECONDS = 15;

interface Palette {
  ink: string;
  muted: string;
  grid: string;
  surface: string;
  level: string;
  activity: string;
  normalized: string;
  onset: string;
}

const PAD = { left: 52, right: 10, top: 14, bottom: 22 };

/**
 * A live 15-second chart on a canvas. `raw` plots the reading in its own
 * units on an auto-scaled axis; `processed` plots the 0..1 signals the
 * engine uses: normalized, smoothed level, activity (area) and onsets.
 */
export class LabChart {
  private readonly g: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly kind: 'raw' | 'processed',
  ) {
    this.g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const resize = () => {
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      this.width = Math.max(1, Math.round(rect.width));
      this.height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
  }

  /** Time (seconds, sensor clock) under a client x coordinate. */
  timeAt(clientX: number, now: number): number | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const plotW = this.width - PAD.left - PAD.right;
    if (x < PAD.left || x > PAD.left + plotW) return undefined;
    return now - WINDOW_SECONDS + ((x - PAD.left) / plotW) * WINDOW_SECONDS;
  }

  draw(samples: readonly LabSample[], now: number, hoverT: number | undefined): void {
    const { g, width: w, height: h } = this;
    const c = palette();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const t0 = now - WINDOW_SECONDS;
    const xOf = (t: number) => PAD.left + ((t - t0) / WINDOW_SECONDS) * plotW;

    // Y scale.
    let lo = 0;
    let hi = 1;
    if (this.kind === 'raw') {
      const values = samples.filter((s) => s.t >= t0 && Number.isFinite(s.raw)).map((s) => s.raw);
      if (values.length > 0) {
        lo = Math.min(...values);
        hi = Math.max(...values);
      }
      const span = hi - lo;
      const pad = span > 1e-9 ? span * 0.12 : Math.max(Math.abs(hi) * 0.05, 0.5);
      lo -= pad;
      hi += pad;
    }
    const yOf = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

    // Grid and axis labels (hairline, recessive).
    g.font = `11px ${theme().fontMono}`;
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    g.strokeStyle = c.grid;
    g.fillStyle = c.muted;
    for (const f of [0, 0.5, 1]) {
      const v = lo + (hi - lo) * f;
      const y = Math.round(yOf(v)) + 0.5;
      g.beginPath();
      g.moveTo(PAD.left, y);
      g.lineTo(PAD.left + plotW, y);
      g.stroke();
      g.textAlign = 'right';
      g.fillText(this.kind === 'raw' ? formatTick(v, hi - lo) : f.toFixed(1), PAD.left - 6, y);
    }
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (let s = 0; s <= WINDOW_SECONDS; s += 5) {
      const x = xOf(t0 + s);
      g.fillText(s === WINDOW_SECONDS ? 'now' : `−${WINDOW_SECONDS - s} s`, x, h - 6);
    }

    const visible = samples.filter((s) => s.t >= t0 - 0.5);
    g.save();
    g.beginPath();
    g.rect(PAD.left, PAD.top - 1, plotW, plotH + 2);
    g.clip();
    g.lineJoin = 'round';
    g.lineCap = 'round';

    if (this.kind === 'raw') {
      this.line(visible, (s) => s.raw, xOf, yOf, c.ink, 2);
    } else {
      // Activity as a 10% wash with a 2px edge, then the normalized input, then the level on top.
      g.beginPath();
      visible.forEach((s, i) => {
        const x = xOf(s.t);
        if (i === 0) g.moveTo(x, yOf(0));
        g.lineTo(x, yOf(s.activity));
      });
      const last = visible.at(-1);
      if (last) g.lineTo(xOf(last.t), yOf(0));
      g.closePath();
      g.globalAlpha = 0.12;
      g.fillStyle = c.activity;
      g.fill();
      g.globalAlpha = 1;
      this.line(visible, (s) => s.activity, xOf, yOf, c.activity, 2);
      this.line(visible, (s) => s.normalized, xOf, yOf, c.normalized, 1.5);
      this.line(visible, (s) => s.level, xOf, yOf, c.level, 2);
      // Onsets: a tick from the top with a ringed dot.
      for (const s of visible) {
        if (!s.onset) continue;
        const x = xOf(s.t);
        g.strokeStyle = c.onset;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, PAD.top);
        g.lineTo(x, PAD.top + 14);
        g.stroke();
        g.beginPath();
        g.arc(x, PAD.top + 4, 4, 0, Math.PI * 2);
        g.fillStyle = c.onset;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = c.surface;
        g.stroke();
      }
    }
    g.restore();

    // Hover crosshair.
    if (hoverT !== undefined) {
      const x = Math.round(xOf(hoverT)) + 0.5;
      g.strokeStyle = c.muted;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, PAD.top);
      g.lineTo(x, PAD.top + plotH);
      g.stroke();
    }
  }

  private line(
    samples: readonly LabSample[],
    value: (s: LabSample) => number,
    xOf: (t: number) => number,
    yOf: (v: number) => number,
    color: string,
    width: number,
  ): void {
    const g = this.g;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    let started = false;
    for (const s of samples) {
      const v = value(s);
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      const x = xOf(s.t);
      const y = yOf(v);
      if (!started) g.moveTo(x, y);
      else g.lineTo(x, y);
      started = true;
    }
    g.stroke();
  }
}

function palette(): Palette {
  const t = theme();
  return {
    ink: t.ink,
    muted: t.muted,
    grid: t.line,
    surface: '#000',
    level: t.chartLevel,
    activity: t.chartActivity,
    normalized: t.muted,
    onset: t.chartOnset,
  };
}

/** Axis label with as many decimals as the visible span needs. */
export function formatTick(v: number, span: number): string {
  const digits = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
  // A slow sensor (the time of day) can move less than 0.001 in the window:
  // keep enough decimals that the half-span ticks read differently.
  const fine = span > 0 ? Math.min(6, Math.ceil(-Math.log10(span / 2))) : 0;
  return v.toFixed(Math.max(digits, fine));
}
