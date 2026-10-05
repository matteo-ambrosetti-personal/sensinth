import {
  PARAM_INFO,
  conditionLabel,
  type EngineView,
  type TrackParam,
  type TrackView,
  type Trig,
} from '@sensinth/core';

/** Params shown on each track, in this order. */
const SHOWN: readonly TrackParam[] = ['cutoff', 'decay', 'timbre', 'tune', 'level', 'pan'];
const COLUMNS = 16;
const ROLE_LABEL: Record<TrackView['role'], string> = {
  drum: 'Drum',
  bass: 'Bass',
  lead: 'Lead',
  arp: 'Arp',
  chords: 'Chords',
  pad: 'Pad',
  drone: 'Drone',
};

export interface TracksControls {
  analyser(slot: string): AnalyserNode | undefined;
  isMuted(slot: string): boolean;
  setMuted(slot: string, muted: boolean): void;
}

interface Colors {
  inset: string;
  ink: string;
  muted: string;
  accent: string;
  lock: string;
  grid: string;
}

interface Row {
  slot: string;
  li: HTMLElement;
  meta: HTMLElement;
  mute: HTMLButtonElement;
  scope: TrackScope;
  grid: HTMLCanvasElement;
  gridKey: string;
  gridLabel: string;
  params: Map<TrackParam, { bar: HTMLElement; base: HTMLElement; value: HTMLElement }>;
}

/**
 * One row per track, like an Elektron box's track view: its own scope, its
 * step grid (trigs, p-locks, conditions, retrigs, micro timing, playhead),
 * live params with the base value marked, and a mute button.
 */
export class TracksView {
  private rows = new Map<string, Row>();
  private signature = '';

  constructor(
    private readonly list: HTMLElement,
    private readonly empty: HTMLElement,
    private readonly controls: TracksControls,
  ) {}

  /** Redraws everything that changed. `scopes` also redraws the waveforms. */
  update(view: EngineView | undefined, scopes: boolean): void {
    const tracks = view?.tracks ?? [];
    const signature = tracks.map((t) => `${t.slot}:${t.machine}`).join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(tracks);
    }
    this.empty.hidden = tracks.length > 0;
    if (tracks.length === 0) return;
    const colors = this.colors();
    for (const t of tracks) {
      const row = this.rows.get(t.slot);
      if (!row) continue;
      row.meta.textContent = `${ROLE_LABEL[t.role]} · ${t.length} steps · ${speedLabel(t.scale)}`;
      row.mute.setAttribute('aria-pressed', String(this.controls.isMuted(t.slot)));
      row.li.classList.toggle('is-muted', this.controls.isMuted(t.slot));
      this.drawGrid(row, t, colors);
      for (const [p, cells] of row.params) {
        const v = t.params[p];
        cells.bar.style.transform = `scaleX(${v.toFixed(3)})`;
        cells.base.style.left = `${(t.base[p] * 100).toFixed(1)}%`;
        cells.value.textContent = String(Math.round(v * 100));
      }
      if (scopes) row.scope.draw(this.controls.analyser(t.slot), colors);
    }
  }

  private rebuild(tracks: readonly TrackView[]): void {
    this.list.replaceChildren();
    this.rows.clear();
    for (const t of tracks) {
      const li = document.createElement('li');
      li.className = 'track';
      li.dataset.slot = t.slot;
      li.innerHTML = `
        <div class="track-head">
          <span class="track-slot">${t.slot.toUpperCase()}</span>
          <span class="track-name"></span>
          <span class="track-meta"></span>
          <button class="mute" type="button" aria-pressed="false">Mute</button>
        </div>
        <canvas class="track-scope" aria-hidden="true"></canvas>
        <canvas class="track-grid" role="img"></canvas>
        <ul class="track-params"></ul>`;
      (li.querySelector('.track-name') as HTMLElement).textContent = t.label;
      const mute = li.querySelector('.mute') as HTMLButtonElement;
      mute.setAttribute('aria-label', `Mute ${t.slot.toUpperCase()} ${t.label}`);
      mute.addEventListener('click', () => {
        const muted = !this.controls.isMuted(t.slot);
        this.controls.setMuted(t.slot, muted);
        mute.setAttribute('aria-pressed', String(muted));
        li.classList.toggle('is-muted', muted);
      });
      const params = new Map<
        TrackParam,
        { bar: HTMLElement; base: HTMLElement; value: HTMLElement }
      >();
      const ul = li.querySelector('.track-params') as HTMLElement;
      for (const p of SHOWN) {
        const item = document.createElement('li');
        item.title = PARAM_INFO[p].label;
        item.innerHTML = `<span class="param-name">${PARAM_INFO[p].short}</span><div class="meter thin"><span></span><i class="meter-base" aria-hidden="true"></i></div><span class="param-value">–</span>`;
        ul.append(item);
        params.set(p, {
          bar: item.querySelector('.meter > span') as HTMLElement,
          base: item.querySelector('.meter-base') as HTMLElement,
          value: item.querySelector('.param-value') as HTMLElement,
        });
      }
      this.list.append(li);
      this.rows.set(t.slot, {
        slot: t.slot,
        li,
        meta: li.querySelector('.track-meta') as HTMLElement,
        mute,
        scope: new TrackScope(li.querySelector('.track-scope') as HTMLCanvasElement),
        grid: li.querySelector('.track-grid') as HTMLCanvasElement,
        gridKey: '',
        gridLabel: '',
        params,
      });
    }
  }

  private drawGrid(row: Row, t: TrackView, c: Colors): void {
    const canvas = row.grid;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rows = Math.max(1, Math.ceil(t.length / COLUMNS));
    const cssWidth = canvas.clientWidth || 320;
    const cell = Math.max(10, Math.min(28, (cssWidth - (COLUMNS - 1) * 3) / COLUMNS));
    const labelH = 11;
    const rowH = cell + labelH + 3;
    const cssHeight = rows * rowH;
    const trigs = t.trigs.slice(0, t.length);
    // Redraw only when something visible changed.
    const key = `${cssWidth}:${t.position}:${t.fired > 0}:${t.length}:${c.accent}:${JSON.stringify(trigs)}`;
    if (key === row.gridKey) return;
    row.gridKey = key;
    if (canvas.style.height !== `${cssHeight}px`) canvas.style.height = `${cssHeight}px`;
    const w = Math.round(cssWidth * dpr);
    const h = Math.round(cssHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.font = `500 9px ${getComputedStyle(canvas).getPropertyValue('--font-mono') || 'monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const gap = (cssWidth - COLUMNS * cell) / (COLUMNS - 1);

    let placed = 0;
    let conditional = 0;
    let locked = 0;
    for (let i = 0; i < t.length; i++) {
      const x = (i % COLUMNS) * (cell + gap);
      const y = Math.floor(i / COLUMNS) * rowH;
      const trig = trigs[i];
      // Beats are marked by a slightly darker cell.
      ctx.fillStyle = i % 4 === 0 ? c.grid : c.inset;
      roundRect(ctx, x, y, cell, cell, 4);
      ctx.fill();
      if (trig) {
        placed++;
        if (trig.locks) locked++;
        drawTrig(ctx, trig, x, y, cell, c);
        const label = trigLabel(trig);
        if (label) {
          conditional++;
          ctx.fillStyle = c.muted;
          ctx.fillText(label, x + cell / 2, y + cell + 1, cell + gap);
        }
      }
      if (i === t.position) {
        if (trig && t.fired > 0) {
          // The trig that just played lights up fully.
          ctx.fillStyle = c.accent;
          roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, 3);
          ctx.fill();
        }
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, cell - 2, cell - 2, 3);
        ctx.stroke();
      }
    }
    const label = `${t.slot.toUpperCase()} ${t.label}: ${t.length} steps, ${placed} trigs, ${conditional} with conditions or probability, ${locked} with parameter locks`;
    if (label !== row.gridLabel) {
      row.gridLabel = label;
      canvas.setAttribute('aria-label', label);
    }
  }

  private colors(): Colors {
    const css = getComputedStyle(this.list);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
      inset: v('--inset', '#dde3e8'),
      ink: v('--ink', '#121820'),
      muted: v('--muted', '#56626e'),
      accent: v('--accent', '#00806f'),
      lock: v('--chart-activity', '#4a3aa7'),
      grid: v('--line', '#c6cfd7'),
    };
  }
}

function drawTrig(
  ctx: CanvasRenderingContext2D,
  trig: Trig,
  x: number,
  y: number,
  cell: number,
  c: Colors,
): void {
  // Fill strength shows velocity; a sideways nudge shows micro timing.
  const shift = Math.max(-0.4, Math.min(0.4, trig.micro)) * cell * 0.5;
  const pad = 2;
  ctx.globalAlpha = 0.35 + 0.65 * trig.vel;
  ctx.fillStyle = c.accent;
  roundRect(ctx, x + pad + shift, y + pad, cell - 2 * pad, cell - 2 * pad, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (trig.cond.kind !== 'always' || trig.prob < 1) {
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (trig.locks) {
    ctx.fillStyle = c.lock;
    ctx.beginPath();
    ctx.arc(x + cell - 5, y + 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (trig.retrig) {
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1;
    const n = Math.min(6, trig.retrig.count);
    const step = (cell - 8) / Math.max(1, n - 1);
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const tx = Math.round(x + 4 + k * step) + 0.5;
      ctx.moveTo(tx, y + cell - 6);
      ctx.lineTo(tx, y + cell - 3);
    }
    ctx.stroke();
  }
}

/** The condition (`1:2`, `fill`, `!pre`) or the probability (`60%`) under a trig. */
function trigLabel(trig: Trig): string {
  const cond = conditionLabel(trig.cond);
  if (cond) return cond;
  return trig.prob < 1 ? `${Math.round(trig.prob * 100)}%` : '';
}

function speedLabel(scale: number): string {
  const labels: Record<string, string> = {
    '0.5': '½×',
    '0.75': '¾×',
    '1': '1×',
    '1.5': '1½×',
    '2': '2×',
  };
  return labels[String(scale)] ?? `${scale}×`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
}

/** A track's waveform. Reports its loudness in `data-level`, so tests can see a mute. */
class TrackScope {
  private data = new Float32Array(new ArrayBuffer(512 * 4));

  constructor(private readonly canvas: HTMLCanvasElement) {}

  draw(analyser: AnalyserNode | undefined, c: Colors): void {
    const canvas = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 120;
    const cssH = canvas.clientHeight || 40;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let sum = 0;
    if (!analyser) {
      ctx.moveTo(0, cssH / 2);
      ctx.lineTo(cssW, cssH / 2);
    } else {
      if (this.data.length !== analyser.fftSize) {
        this.data = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      }
      analyser.getFloatTimeDomainData(this.data);
      const n = this.data.length;
      // Tracks are quiet next to the mix: scale the trace to its own peak, up to ×8.
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const v = this.data[i] as number;
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      const gain = Math.min(8, 0.45 / Math.max(peak, 1e-3));
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * cssW;
        const y = cssH / 2 - (this.data[i] as number) * gain * cssH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      sum = Math.sqrt(sum / n);
    }
    ctx.stroke();
    canvas.dataset.level = sum.toFixed(4);
  }
}
