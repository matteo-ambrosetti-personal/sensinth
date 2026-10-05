import {
  PARAM_INFO,
  parseSensorSource,
  sourceKind,
  type EngineView,
  type RouteView,
  type SourceKind,
  type TrackParam,
} from '@sensinth/core';

const GROUPS: readonly { kind: SourceKind; title: string }[] = [
  { kind: 'sensor', title: 'Sensors' },
  { kind: 'lfo', title: 'LFOs' },
  { kind: 'chaos', title: 'Chaos' },
  { kind: 'env', title: 'Track hits' },
  { kind: 'macro', title: 'Dials' },
];

const FEATURE: Record<string, string> = {
  level: 'level',
  activity: 'movement',
  trend: 'trend',
  onset: 'hits',
  jitter: 'fine digits',
};

const GLOBAL: Record<string, string> = {
  'g.tension': 'Tension',
  'g.brightness': 'Brightness',
  'g.swing': 'Swing',
  'g.space': 'Space',
  'g.fx': 'Effect depth',
};

interface Item {
  value: HTMLElement;
}

/**
 * The live modulation matrix: every route from a source to a destination,
 * grouped by source, with its amount and a centered bar showing what it adds
 * right now (left = down, right = up).
 */
export class MatrixView {
  private signature = '';
  private items: Item[] = [];

  constructor(
    private readonly list: HTMLElement,
    private readonly empty: HTMLElement,
    private readonly channelLabel: (channelId: string) => string,
  ) {}

  update(view: EngineView | undefined): void {
    const routes = view?.routes ?? [];
    const tracks = new Map((view?.tracks ?? []).map((t) => [t.slot, t.label]));
    const signature = routes.map((r) => `${r.source}>${r.dest}:${r.amount.toFixed(2)}`).join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(routes, tracks);
    }
    this.empty.hidden = routes.length > 0;
    routes.forEach((r, i) => {
      const item = this.items[i];
      if (!item) return;
      const v = Math.max(-1, Math.min(1, r.value));
      // Half the bar each way from the center.
      item.value.style.left = `${(50 + Math.min(0, v) * 50).toFixed(1)}%`;
      item.value.style.width = `${(Math.abs(v) * 50).toFixed(1)}%`;
    });
  }

  private rebuild(routes: readonly RouteView[], tracks: ReadonlyMap<string, string>): void {
    this.list.replaceChildren();
    this.items = new Array(routes.length);
    const order = routes.map((r, i) => ({ r, i, kind: sourceKind(r.source) }));
    for (const group of GROUPS) {
      const inGroup = order.filter((o) => o.kind === group.kind);
      if (inGroup.length === 0) continue;
      const head = document.createElement('li');
      head.className = 'mod-group';
      head.textContent = `${group.title} · ${inGroup.length}`;
      this.list.append(head);
      for (const { r, i } of inGroup) {
        const li = document.createElement('li');
        li.className = 'mod-route';
        const amount = `${r.amount >= 0 ? '+' : '−'}${Math.abs(r.amount).toFixed(2)}`;
        li.innerHTML = `
          <span class="mod-src"></span>
          <span class="mod-dest"></span>
          <div class="mod-bar" aria-hidden="true"><span class="mod-extent"></span><span class="mod-value"></span></div>
          <b class="mod-amount">${amount}</b>`;
        (li.querySelector('.mod-src') as HTMLElement).textContent = sourceLabel(
          r.source,
          tracks,
          this.channelLabel,
        );
        (li.querySelector('.mod-dest') as HTMLElement).textContent =
          `→ ${destLabel(r.dest, tracks)}`;
        const extent = li.querySelector('.mod-extent') as HTMLElement;
        const reach = Math.min(1, Math.abs(r.amount));
        extent.style.left = `${50 - reach * 50}%`;
        extent.style.width = `${reach * 100}%`;
        this.list.append(li);
        this.items[i] = { value: li.querySelector('.mod-value') as HTMLElement };
      }
    }
  }
}

/** A route source in words, e.g. "Light level" or "T2 Snare LFO". */
export function sourceLabel(
  source: string,
  tracks: ReadonlyMap<string, string>,
  channelLabel: (channelId: string) => string,
): string {
  switch (sourceKind(source)) {
    case 'sensor': {
      const { channelId, feature } = parseSensorSource(source);
      return `${channelLabel(channelId)} ${FEATURE[feature] ?? feature}`;
    }
    case 'macro':
      return `${capitalize(source.slice(2))} dial`;
    case 'lfo':
      return `${trackName(source.slice(4), tracks)} LFO`;
    case 'chaos':
      return `Chaos ${source.slice(6).toUpperCase()}`;
    case 'env':
      return `${trackName(source.slice(4), tracks)} hits`;
  }
}

/** A route destination in words, e.g. "T3 Bass filter cutoff". */
export function destLabel(dest: string, tracks: ReadonlyMap<string, string>): string {
  if (dest in GLOBAL) return GLOBAL[dest] as string;
  if (dest.startsWith('lfo:')) {
    const [slot, what] = dest.slice(4).split('.') as [string, string];
    return `${trackName(slot, tracks)} LFO ${what}`;
  }
  if (dest.startsWith('chaos:')) return `Chaos ${dest.slice(6, 7).toUpperCase()} rate`;
  const [slot, param] = dest.split('.') as [string, TrackParam];
  return `${trackName(slot, tracks)} ${PARAM_INFO[param]?.label.toLowerCase() ?? param}`;
}

function trackName(slot: string, tracks: ReadonlyMap<string, string>): string {
  const label = tracks.get(slot);
  return label ? `${slot.toUpperCase()} ${label}` : slot.toUpperCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
