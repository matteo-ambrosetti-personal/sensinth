import type { Router, SensorHub } from '@sensinth/core';
import { LabChart, WINDOW_SECONDS, formatTick, type LabSample } from './labChart';

export interface LabElements {
  select: HTMLSelectElement;
  about: HTMLElement;
  rawNow: HTMLElement;
  rawTitle: HTMLElement;
  rawCanvas: HTMLCanvasElement;
  procCanvas: HTMLCanvasElement;
  time: HTMLElement;
  level: HTMLElement;
  normalized: HTMLElement;
  activity: HTMLElement;
  onsets: HTMLElement;
  trend: HTMLElement;
  range: HTMLElement;
  rate: HTMLElement;
  timescale: HTMLElement;
  drives: HTMLElement;
  solo: HTMLInputElement;
  empty: HTMLElement;
  body: HTMLElement;
}

/**
 * Sensor lab: one channel at a time, its raw reading next to the signals the
 * engine derives from it, and an optional solo so only it drives the music.
 */
export class LabView {
  private channelId: string | undefined;
  private history: LabSample[] = [];
  private hoverAgo: number | undefined;
  private shownVersion = -1;
  private lastDraw = 0;
  /** The partition the "Drives" line was written for: it changes with a solo or a new source. */
  private shownPartition: string | undefined = '';
  private readonly raw: LabChart;
  private readonly proc: LabChart;
  active = false;

  constructor(
    private readonly hub: SensorHub,
    private readonly router: () => Router,
    private readonly setSolo: (id: string | undefined) => void,
    private readonly els: LabElements,
    private readonly now: () => number,
  ) {
    this.raw = new LabChart(els.rawCanvas, 'raw');
    this.proc = new LabChart(els.procCanvas, 'processed');
    hub.tap({ push: (s) => this.record(s.id, s.t, s.v) });
    els.select.addEventListener('change', () => this.select(els.select.value || undefined));
    els.solo.addEventListener('change', () => this.applySolo());
    for (const [canvas, chart] of [
      [els.rawCanvas, this.raw],
      [els.procCanvas, this.proc],
    ] as const) {
      canvas.addEventListener('pointermove', (e) => {
        const now = this.now();
        const t = chart.timeAt(e.clientX, now);
        this.hoverAgo = t === undefined ? undefined : now - t;
      });
      canvas.addEventListener('pointerleave', () => (this.hoverAgo = undefined));
    }
  }

  /** Called when the lab is shown or hidden. Leaving the lab turns solo off. */
  setActive(on: boolean): void {
    this.active = on;
    if (!on && this.els.solo.checked) {
      this.els.solo.checked = false;
      this.applySolo();
    }
  }

  frame(): void {
    if (!this.active) return;
    // Thirty frames a second is plenty for a 15-second chart.
    const tick = performance.now();
    if (tick - this.lastDraw < 30) return;
    this.lastDraw = tick;
    if (this.hub.version !== this.shownVersion) this.syncChannels();
    const partition = this.router().currentPartition?.key;
    if (partition !== this.shownPartition) {
      this.shownPartition = partition;
      this.describe();
    }
    const now = this.now();
    const ch = this.channelId ? this.hub.get(this.channelId) : undefined;
    const unit = ch?.desc.unit ?? '';
    const hoverT = this.hoverAgo === undefined ? undefined : now - this.hoverAgo;
    this.raw.draw(this.history, now, hoverT);
    this.proc.draw(this.history, now, hoverT);
    this.els.rawTitle.textContent = unit ? `Raw reading (${unit})` : 'Raw reading';
    if (!ch) return;

    const at = hoverT === undefined ? this.history.at(-1) : nearest(this.history, hoverT);
    const els = this.els;
    els.time.textContent = hoverT === undefined ? 'now' : `at −${(now - hoverT).toFixed(1)} s`;
    els.rawNow.textContent = at ? formatValue(at.raw, unit) : '–';
    els.level.textContent = at ? at.level.toFixed(2) : '–';
    els.normalized.textContent = at ? at.normalized.toFixed(2) : '–';
    els.activity.textContent = at ? at.activity.toFixed(2) : '–';
    const trend = at?.trend ?? 0;
    els.trend.textContent = !at
      ? '–'
      : `${trend > 0.15 ? '↑ rising' : trend < -0.15 ? '↓ falling' : '→ steady'} (${trend.toFixed(2)})`;
    const t0 = now - WINDOW_SECONDS;
    els.onsets.textContent = String(this.history.filter((s) => s.onset && s.t >= t0).length);

    const bounds = ch.debug.bounds;
    els.range.textContent = bounds
      ? `${formatTick(bounds[0], bounds[1] - bounds[0])} – ${formatTick(bounds[1], bounds[1] - bounds[0])}${unit ? ` ${unit}` : ''}`
      : '–';
    const recent = this.history.filter((s) => s.t >= now - 2).length;
    els.rate.textContent = `${(recent / 2).toFixed(1)} per second`;
    els.timescale.textContent = ch.timescale;
  }

  private syncChannels(): void {
    this.shownVersion = this.hub.version;
    const channels = this.hub.list();
    const { select } = this.els;
    const current = this.channelId;
    select.replaceChildren();
    const bySource = new Map<string, typeof channels>();
    for (const ch of channels) {
      const key = ch.desc.source ?? 'other';
      bySource.set(key, [...(bySource.get(key) ?? []), ch]);
    }
    for (const [source, list] of bySource) {
      const group = document.createElement('optgroup');
      group.label = SOURCE_NAMES[source] ?? source;
      for (const ch of list) {
        const opt = document.createElement('option');
        opt.value = ch.desc.id;
        opt.textContent = ch.desc.label;
        group.append(opt);
      }
      select.append(group);
    }
    const stillThere = current && channels.some((c) => c.desc.id === current);
    const next = stillThere ? current : channels[0]?.desc.id;
    if (next) select.value = next;
    this.els.empty.hidden = channels.length > 0;
    this.els.body.hidden = channels.length === 0;
    if (next !== current) this.select(next);
    else this.describe();
  }

  private select(id: string | undefined): void {
    this.channelId = id;
    this.history = [];
    this.hoverAgo = undefined;
    this.describe();
    this.applySolo();
  }

  private describe(): void {
    const ch = this.channelId ? this.hub.get(this.channelId) : undefined;
    if (!ch) {
      this.els.about.textContent = '';
      this.els.drives.textContent = '–';
      return;
    }
    const { desc } = ch;
    const range = desc.range
      ? `${desc.circular ? 'wraps around' : 'fixed range'} ${desc.range[0]}–${desc.range[1]}${desc.unit ? ` ${desc.unit}` : ''}`
      : 'range learned from the data';
    this.els.about.textContent = `Kind: ${desc.kind} · ${range}.`;
    const routes = this.router().getRoutes();
    const drives = [
      ...routes.macros
        .filter((r) => r.channelId === desc.id)
        .map(
          (r) => `${r.macro} (${r.invert ? 'inverted ' : ''}${r.feature}${r.auto ? ', auto' : ''})`,
        ),
      ...routes.triggers.filter((r) => r.channelId === desc.id).map((r) => `${r.trigger} (onset)`),
    ];
    this.els.drives.textContent = drives.length ? drives.join(', ') : 'nothing';
  }

  private applySolo(): void {
    this.setSolo(this.els.solo.checked ? this.channelId : undefined);
  }

  private record(id: string, t: number, raw: number): void {
    if (id !== this.channelId) return;
    const ch = this.hub.get(id);
    if (!ch) return;
    this.history.push({
      t,
      raw,
      normalized: ch.debug.normalized,
      level: ch.features.level,
      activity: ch.features.activity,
      trend: ch.features.trend,
      onset: ch.lastOnsetT === t,
    });
    const cutoff = t - WINDOW_SECONDS - 1;
    if ((this.history[0]?.t ?? t) < cutoff) {
      this.history = this.history.filter((s) => s.t >= cutoff);
    }
  }
}

/** Names of sensor sources, for grouping channels. */
export const SOURCE_NAMES: Record<string, string> = {
  phone: 'Phone',
  clock: 'Clock',
  sim: 'Simulated',
  replay: 'Replay',
  computer: 'Pointer & keyboard',
  native: 'Phone (native)',
  mac: 'Mac',
  controller: 'Game controllers',
  midi: 'MIDI',
};

function nearest(samples: readonly LabSample[], t: number): LabSample | undefined {
  let best: LabSample | undefined;
  for (const s of samples) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best;
}

function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}
