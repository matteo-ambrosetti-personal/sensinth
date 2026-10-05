import { FLOW_WINDOW, type FlowSample } from './history';

export interface FlowColors {
  ink: string;
  muted: string;
  line: string;
  inset: string;
  level: string;
  activity: string;
  onset: string;
  accent: string;
}

export function readColors(el: Element): FlowColors {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v('--ink', '#121820'),
    muted: v('--muted', '#56626e'),
    line: v('--line', '#c6cfd7'),
    inset: v('--inset', '#dde3e8'),
    level: v('--chart-level', '#008a72'),
    activity: v('--chart-activity', '#4a3aa7'),
    onset: v('--chart-onset', '#d9730b'),
    accent: v('--accent', '#00806f'),
  };
}

/** Sizes a canvas to its CSS box at the screen's density; returns its 2D context in CSS pixels. */
export function prepare(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
} {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 100;
  const h = canvas.clientHeight || 32;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const PAD = 3;

/** The raw reading in its own units, scaled to its own recent range. */
export function drawRaw(
  canvas: HTMLCanvasElement,
  samples: readonly FlowSample[],
  now: number,
  c: FlowColors,
): void {
  const { ctx, w, h } = prepare(canvas);
  const t0 = now - FLOW_WINDOW;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (s.t < t0 || !Number.isFinite(s.raw)) continue;
    lo = Math.min(lo, s.raw);
    hi = Math.max(hi, s.raw);
  }
  baseline(ctx, w, h, c);
  if (!Number.isFinite(lo)) return;
  const span = hi - lo || Math.max(1e-6, Math.abs(hi) * 0.1) || 1;
  const y = (v: number) => h - PAD - ((v - lo) / span) * (h - 2 * PAD);
  ctx.strokeStyle = c.ink;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  trace(ctx, samples, t0, w, (s) => (Number.isFinite(s.raw) ? y(s.raw) : undefined));
  ctx.globalAlpha = 1;
}

/**
 * What the engine derives on 0..1: movement as an area, the normalized value
 * as a thin line, the smoothed level as the main line, onsets as ticks.
 */
export function drawProcessed(
  canvas: HTMLCanvasElement,
  samples: readonly FlowSample[],
  now: number,
  c: FlowColors,
): void {
  const { ctx, w, h } = prepare(canvas);
  const t0 = now - FLOW_WINDOW;
  const y = (v: number) => h - PAD - Math.max(0, Math.min(1, v)) * (h - 2 * PAD);
  baseline(ctx, w, h, c);
  const visible = samples.filter((s) => s.t >= t0);
  if (visible.length === 0) return;
  const x = (t: number) => ((t - t0) / FLOW_WINDOW) * w;

  // Movement: a soft area from the bottom.
  ctx.fillStyle = c.activity;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.moveTo(x((visible[0] as FlowSample).t), h);
  for (const s of visible) ctx.lineTo(x(s.t), y(s.activity));
  ctx.lineTo(x((visible.at(-1) as FlowSample).t), h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.lineJoin = 'round';
  ctx.strokeStyle = c.muted;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  trace(ctx, visible, t0, w, (s) => y(s.normalized));
  ctx.globalAlpha = 1;

  ctx.strokeStyle = c.level;
  ctx.lineWidth = 2;
  trace(ctx, visible, t0, w, (s) => y(s.level));

  ctx.strokeStyle = c.onset;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const s of visible) {
    if (!s.onset) continue;
    const ox = Math.round(x(s.t)) + 0.5;
    ctx.moveTo(ox, 1);
    ctx.lineTo(ox, h * 0.4);
  }
  ctx.stroke();
}

function baseline(ctx: CanvasRenderingContext2D, w: number, h: number, c: FlowColors): void {
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();
}

function trace(
  ctx: CanvasRenderingContext2D,
  samples: readonly FlowSample[],
  t0: number,
  w: number,
  y: (s: FlowSample) => number | undefined,
): void {
  ctx.beginPath();
  let started = false;
  for (const s of samples) {
    if (s.t < t0) continue;
    const yy = y(s);
    if (yy === undefined) continue;
    const xx = ((s.t - t0) / FLOW_WINDOW) * w;
    if (!started) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
    started = true;
  }
  ctx.stroke();
}

const buffers = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();

/** Reads an analyser's latest waveform. */
function waveform(analyser: AnalyserNode): Float32Array<ArrayBuffer> {
  let data = buffers.get(analyser);
  if (!data || data.length !== analyser.fftSize) {
    data = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    buffers.set(analyser, data);
  }
  analyser.getFloatTimeDomainData(data);
  return data;
}

/** Loudness of an analyser's latest block, 0..1 (RMS mapped from −48..0 dB). */
export function loudness(analyser: AnalyserNode | undefined): number {
  if (!analyser) return 0;
  const data = waveform(analyser);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += (data[i] as number) ** 2;
  const rms = Math.sqrt(sum / data.length);
  if (rms < 1e-5) return 0;
  return Math.max(0, Math.min(1, 1 + (20 * Math.log10(rms)) / 48));
}

/** A small waveform, scaled to its own peak (up to ×8). */
export function drawScope(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode | undefined,
  color: string,
): void {
  const { ctx, w, h } = prepare(canvas);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (!analyser) {
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    return;
  }
  const data = waveform(analyser);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] as number));
  const gain = Math.min(8, 0.45 / Math.max(peak, 1e-3));
  for (let i = 0; i < data.length; i++) {
    const xx = (i / (data.length - 1)) * w;
    const yy = h / 2 - (data[i] as number) * gain * h;
    if (i === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  }
  ctx.stroke();
}
