import {
  FX_INFO,
  MACRO_INFO,
  domainOf,
  destArea,
  parseSensorSource,
  type ChannelState,
  type Domain,
  type EngineView,
  type MacroId,
  type Router,
  type RouteView,
} from '@sensinth/core';

/** One thing a sensor does to the music, in words, with how much it is doing it now. */
export interface SensorEffect {
  /** "Higher", "More movement", "A jolt". */
  when: string;
  /** "Rhodes brighter", "fires Stutter", "sets Energy: note density, drum intensity". */
  what: string;
  domain: Domain | undefined;
  /** How to find the live amount: a route's index in `view.routes`, a dial, or an event. */
  live: { route: number } | { macro: MacroId } | { event: true };
  /** How strong the link is, 0..1, for the order. */
  weight: number;
}

/** [when it goes up, when it goes down] for each track param and global. */
const PARAM_WORDS: Record<string, [string, string]> = {
  cutoff: ['brighter', 'darker'],
  reso: ['sharper', 'rounder'],
  drive: ['grittier', 'cleaner'],
  decay: ['longer notes', 'shorter notes'],
  attack: ['softer attack', 'harder attack'],
  timbre: ['richer tone', 'plainer tone'],
  tune: ['higher', 'lower'],
  prob: ['more notes', 'fewer notes'],
  retrig: ['more rolls', 'fewer rolls'],
  micro: ['drags behind the beat', 'pushes ahead of the beat'],
  sendReverb: ['more reverb', 'less reverb'],
  sendDelay: ['more echo', 'less echo'],
  pan: ['to the right', 'to the left'],
  level: ['louder', 'quieter'],
};
const GLOBAL_WORDS: Record<string, [string, string]> = {
  swing: ['more swing', 'straighter'],
  tension: ['tenser chords', 'calmer chords'],
  space: ['a bigger room', 'a smaller room'],
  fx: ['deeper effects', 'lighter effects'],
  brightness: ['a brighter mix', 'a darker mix'],
};
const WHEN: Record<string, string> = {
  level: 'Higher',
  activity: 'More movement',
  trend: 'Rising',
  onset: 'A jolt',
};
const CURVE_NOTE: Record<string, string> = { step: ', in steps', fold: ', most at mid-range' };

function destWords(dest: string, up: boolean, label: (slot: string) => string): string {
  const pick = (w: [string, string] | undefined) => (w ? (up ? w[0] : w[1]) : undefined);
  if (dest.startsWith('g.')) return pick(GLOBAL_WORDS[dest.slice(2)]) ?? dest;
  if (dest.startsWith('chaos:')) return up ? 'less predictable' : 'more predictable';
  if (dest.startsWith('lfo:')) {
    const [slot, what] = dest.slice(4).split('.') as [string, string];
    const word = what === 'rate' ? (up ? 'faster' : 'slower') : up ? 'deeper' : 'shallower';
    return `${label(slot)}: ${word} wobble`;
  }
  const dot = dest.indexOf('.');
  const words = pick(PARAM_WORDS[dest.slice(dot + 1)]) ?? dest.slice(dot + 1);
  return `${label(dest.slice(0, dot))} ${words}`;
}

/**
 * What each live sensor does to the music right now, strongest first: the
 * routes it holds in the matrix, the dials it sets, and what its sudden
 * moves fire. Before Play only the dials and the events are known.
 */
export function sensorEffects(
  channelId: string,
  view: EngineView | undefined,
  router: Router,
): SensorEffect[] {
  const out: SensorEffect[] = [];
  const tracks = new Map((view?.tracks ?? []).map((t) => [t.slot, t]));
  const label = (slot: string) => tracks.get(slot)?.label ?? slot;
  const roleOf = (slot: string) => tracks.get(slot)?.role;
  (view?.routes ?? []).forEach((r: RouteView, i) => {
    if (!r.source.startsWith('s:')) return;
    const src = parseSensorSource(r.source);
    if (src.channelId !== channelId || src.feature === 'jitter') return;
    const area = destArea(r.dest, roleOf);
    out.push({
      when: WHEN[src.feature] ?? src.feature,
      what: destWords(r.dest, r.amount >= 0, label) + (CURVE_NOTE[r.curve] ?? ''),
      domain: area ? domainOf(area) : undefined,
      live: { route: i },
      weight: Math.abs(r.amount),
    });
  });
  const routes = router.getRoutes();
  for (const m of routes.macros) {
    if (m.channelId !== channelId) continue;
    out.push({
      when: m.feature === 'activity' ? 'More movement' : m.invert ? 'Lower' : 'Higher',
      what: `more ${m.macro}: ${MACRO_INFO[m.macro].description.toLowerCase()}`,
      domain: undefined,
      live: { macro: m.macro },
      weight: 0.5 * m.weight,
    });
  }
  for (const t of view?.fxTriggers ?? []) {
    if (t.channelId !== channelId) continue;
    out.push({
      when: 'A jolt',
      what: `fires ${FX_INFO[t.fx].label}: ${FX_INFO[t.fx].description.toLowerCase()}`,
      domain: 'space',
      live: { event: true },
      weight: 1,
    });
  }
  for (const t of routes.triggers) {
    if (t.channelId !== channelId) continue;
    out.push({
      when: 'A jolt',
      what: t.trigger === 'fill' ? 'asks the drums for a fill' : 'adds an accent',
      domain: 'rhythm',
      live: { event: true },
      weight: 0.45,
    });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

interface Row {
  meter: HTMLElement;
  value: HTMLElement;
  items: { el: HTMLElement; bar: HTMLElement; effect: SensorEffect }[];
  said: HTMLElement;
  saidAt: number;
}

/** Most effects listed per sensor. */
const MAX_EFFECTS = 5;

/**
 * What each sensor does: a row per live sensor with its reading, and in
 * plain words what moving it does to the music right now. The bar next to
 * each line fills while that link is at work, and the last thing the sensor
 * did (an effect fired, a section chosen) shows for a moment.
 */
export class EffectsView {
  private rows = new Map<string, Row>();
  private signature = '';

  constructor(
    private readonly list: HTMLElement,
    private readonly empty: HTMLElement,
  ) {}

  update(
    channels: readonly ChannelState[],
    view: EngineView | undefined,
    router: Router,
    now: number,
  ): void {
    const live = channels.filter((c) => !c.stale);
    const perChannel = live.map((ch) => ({
      ch,
      effects: sensorEffects(ch.desc.id, view, router).slice(0, MAX_EFFECTS),
    }));
    const signature = perChannel
      .map((p) => `${p.ch.desc.id}:${p.effects.map((e) => `${e.when}>${e.what}`).join(';')}`)
      .join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.build(perChannel);
    }
    this.empty.hidden = live.length > 0;
    for (const { ch } of perChannel) {
      const row = this.rows.get(ch.desc.id);
      if (!row) continue;
      row.meter.style.transform = `scaleX(${ch.features.level.toFixed(3)})`;
      row.value.textContent = Number.isFinite(ch.raw) ? format(ch.raw, ch.desc.unit) : '–';
      const jolt = now - ch.lastOnsetT < 0.25 ? 1 : 0;
      for (const item of row.items) {
        const l = item.effect.live;
        const amount =
          'route' in l
            ? Math.min(1, Math.abs(view?.routes[l.route]?.value ?? 0) * 1.6)
            : 'macro' in l
              ? router.macros[l.macro]
              : jolt;
        item.bar.style.transform = `scaleX(${amount.toFixed(3)})`;
        item.el.classList.toggle('is-on', amount > 0.12);
      }
      for (const n of view?.news ?? []) {
        if (n.channelId !== ch.desc.id) continue;
        row.said.textContent = `→ ${n.text}`;
        row.said.hidden = false;
        row.saidAt = now;
      }
      if (!row.said.hidden && now - row.saidAt > 4) row.said.hidden = true;
    }
  }

  private build(list: readonly { ch: ChannelState; effects: SensorEffect[] }[]): void {
    const before = this.rows;
    this.rows = new Map();
    this.list.replaceChildren(
      ...list.map(({ ch, effects }) => {
        const li = document.createElement('li');
        li.className = 'fxrow';
        const head = document.createElement('div');
        head.className = 'fxrow-head';
        const name = document.createElement('span');
        name.className = 'fxrow-name';
        name.textContent = ch.desc.label;
        const value = document.createElement('span');
        value.className = 'fxrow-value';
        const meter = document.createElement('div');
        meter.className = 'meter';
        const fill = document.createElement('span');
        meter.append(fill);
        const said = document.createElement('span');
        said.className = 'fxrow-said';
        const old = before.get(ch.desc.id);
        said.textContent = old?.said.textContent ?? '';
        said.hidden = old?.said.hidden ?? true;
        head.append(name, value, meter, said);
        const ul = document.createElement('ul');
        ul.className = 'fxrow-list';
        const items = effects.map((effect) => {
          const el = document.createElement('li');
          if (effect.domain) el.dataset.domain = effect.domain;
          const when = document.createElement('span');
          when.className = 'fx-when';
          when.textContent = effect.when;
          const what = document.createElement('span');
          what.className = 'fx-what';
          what.textContent = effect.what;
          const track = document.createElement('span');
          track.className = 'fx-live';
          const bar = document.createElement('span');
          track.append(bar);
          el.append(track, when, ' → ', what);
          ul.append(el);
          return { el, bar, effect };
        });
        if (effects.length === 0) {
          const el = document.createElement('li');
          el.className = 'fx-none';
          el.textContent = 'Its readings seed the patterns; press Play to see what it moves.';
          ul.append(el);
        }
        li.append(head, ul);
        this.rows.set(ch.desc.id, { meter: fill, value, items, said, saidAt: old?.saidAt ?? 0 });
        return li;
      }),
    );
  }
}

function format(v: number, unit?: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}
