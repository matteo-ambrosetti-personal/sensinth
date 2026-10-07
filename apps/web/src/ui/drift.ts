import type { EngineView } from '@sensinth/core';
import { theme, trackColor } from './theme';

/** Drawn at half the screen's resolution and scaled up, for chunky pixels. */
const PIXEL = 2;
/** Bars always shown, so the first minutes do not stretch across the chart. */
const MIN_BARS = 32;

interface Series {
  /** Distance at each bar, by bar index (gaps while a track was absent). */
  values: (number | undefined)[];
}

/**
 * How far the music has moved from where it started, bar by bar: a thin
 * line per track in its colour, a thick white line for the whole piece,
 * section ticks, ★ for a new scene and marks for edits and evolutions.
 */
export class DriftChart {
  private readonly ctx: CanvasRenderingContext2D;
  private total: (number | undefined)[] = [];
  private tracks = new Map<string, Series>();
  private marks: EngineView['drift']['marks'] = [];
  private lastBar = -1;
  private dirty = true;
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly badge: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      this.width = Math.max(1, Math.round(rect.width / PIXEL));
      this.height = Math.max(1, Math.round(rect.height / PIXEL));
      canvas.width = this.width;
      canvas.height = this.height;
      this.dirty = true;
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
  }

  update(view: EngineView | undefined): void {
    const d = view?.drift;
    if (d && d.history.length > 0) {
      // A new piece starts its own chart.
      if (d.bar < this.lastBar || (d.bar === 0 && this.lastBar > 0)) this.reset();
      if (d.bar !== this.lastBar) {
        this.lastBar = d.bar;
        this.total[d.bar] = d.total;
        for (const t of d.tracks) {
          if (t.gone) continue;
          const s = this.tracks.get(t.slot) ?? { values: [] };
          s.values[d.bar] = t.value;
          this.tracks.set(t.slot, s);
        }
        this.marks = d.marks;
        this.dirty = true;
        const pct = `${Math.round(d.total * 100)}%`;
        if (this.badge.textContent !== pct) this.badge.textContent = pct;
        this.canvas.setAttribute(
          'aria-label',
          `After ${d.bar + 1} bars the music is ${pct} away from where it started`,
        );
      }
    }
    if (this.dirty) this.draw();
  }

  private reset(): void {
    this.total = [];
    this.tracks.clear();
    this.marks = [];
    this.lastBar = -1;
  }

  private draw(): void {
    this.dirty = false;
    const { ctx, width: w, height: h } = this;
    const t = theme();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const top = 3;
    const bottom = h - 6;
    const left = 2;
    const bars = Math.max(MIN_BARS, this.total.length);
    const xOf = (bar: number) => left + Math.round((bar / (bars - 1)) * (w - left - 3));
    const yOf = (v: number) => Math.round(bottom - Math.max(0, Math.min(1, v)) * (bottom - top));

    // Grid: quarters of the way.
    ctx.fillStyle = t.line;
    for (const f of [0.25, 0.5, 0.75]) {
      const y = yOf(f);
      for (let x = left; x < w; x += 3) ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillRect(left, bottom + 1, w - left, 1);

    // Marks under the axis: sections, scenes, edits, evolutions.
    for (const m of this.marks) {
      if (m.bar < 0 || m.bar >= bars) continue;
      const x = xOf(m.bar);
      if (m.reason === 'scene') {
        ctx.fillStyle = t.accent;
        star(ctx, x, bottom + 3);
      } else {
        ctx.fillStyle = m.reason === 'edit' ? t.accent : m.reason === 'evolve' ? t.go : t.muted;
        ctx.fillRect(x, bottom + 2, 1, 3);
      }
    }

    // Each track, thin, in its colour.
    for (const [slot, s] of this.tracks) {
      ctx.fillStyle = trackColor(slot);
      ctx.globalAlpha = 0.7;
      stepLine(ctx, s.values, xOf, yOf, 1);
    }
    ctx.globalAlpha = 1;
    // The whole piece, thick, with a shadow.
    ctx.fillStyle = '#000';
    stepLine(
      ctx,
      this.total,
      (b) => xOf(b) + 1,
      (v) => yOf(v) + 1,
      2,
    );
    ctx.fillStyle = t.ink;
    stepLine(ctx, this.total, xOf, yOf, 2);
  }
}

/** A line of square pixels from bar to bar, held flat until the next value. */
function stepLine(
  ctx: CanvasRenderingContext2D,
  values: readonly (number | undefined)[],
  xOf: (bar: number) => number,
  yOf: (v: number) => number,
  size: number,
): void {
  let prev: { x: number; y: number } | undefined;
  for (let bar = 0; bar < values.length; bar++) {
    const v = values[bar];
    if (v === undefined) {
      prev = undefined;
      continue;
    }
    const x = xOf(bar);
    const y = yOf(v);
    if (prev) {
      ctx.fillRect(prev.x, prev.y, Math.max(size, x - prev.x), size);
      const y0 = Math.min(prev.y, y);
      ctx.fillRect(x, y0, size, Math.abs(y - prev.y) + size);
    } else {
      ctx.fillRect(x, y, size, size);
    }
    prev = { x, y };
  }
}

/** A tiny pixel star. */
function star(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillRect(x, y - 1, 1, 3);
  ctx.fillRect(x - 1, y, 3, 1);
}
