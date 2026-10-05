import {
  FX_INFO,
  parseSensorSource,
  sourceKind,
  type ChannelState,
  type EngineView,
  type MacroRoute,
  type TriggerRoute,
} from '@sensinth/core';
import { destLabel, sourceLabel } from '../matrix';

/**
 * Nodes: `ch:<channel>` sensors, `mod:genome|dials|song|lfo|chaos`
 * modulators, `trk:<slot>` tracks, `bus:reverb|delay|fx|master` the mix.
 */
export type NodeId = string;

/** What travels along a link; it sets the colour and line style. */
export type LinkKind = 'sensor' | 'internal' | 'event' | 'genome' | 'audio';

export interface FlowRoute {
  label: string;
  amount: number;
  value: number;
}

export interface FlowLink {
  key: string;
  from: NodeId;
  to: NodeId;
  kind: LinkKind;
  /** How strong the connection is, 0..1 (sets the width). */
  strength: number;
  /** How much passes right now, 0..1 (sets brightness and the moving dots). */
  intensity: number;
  /** Pushes its targets up (1) or pulls them down (−1). */
  sign: 1 | -1;
  routes: FlowRoute[];
}

export interface LinkInput {
  view: EngineView | undefined;
  channels: readonly ChannelState[];
  macroRoutes: readonly MacroRoute[];
  triggerRoutes: readonly TriggerRoute[];
  strongOnly: boolean;
  channelLabel: (id: string) => string;
  /** True while a channel's latest onset is recent. */
  recentOnset: (id: string) => boolean;
  /** Audio loudness 0..1 of a track (`trk:<slot>`) or bus (`bus:<id>`). */
  loudness: (node: NodeId) => number;
  isMuted: (slot: string) => boolean;
}

/** Routes this strong or stronger count as "strong". */
export const STRONG = 0.4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where a route's source sits in the diagram. */
export function sourceNode(source: string): NodeId {
  switch (sourceKind(source)) {
    case 'sensor':
      return `ch:${parseSensorSource(source).channelId}`;
    case 'macro':
      return 'mod:dials';
    case 'lfo':
      return 'mod:lfo';
    case 'chaos':
      return 'mod:chaos';
    case 'env':
      return `trk:${source.slice(4)}`;
  }
}

/** Where a route's destination sits in the diagram. */
export function destNode(dest: string): NodeId {
  if (dest.startsWith('g.')) return 'mod:song';
  if (dest.startsWith('lfo:')) return 'mod:lfo';
  if (dest.startsWith('chaos:')) return 'mod:chaos';
  return `trk:${dest.split('.')[0] as string}`;
}

/**
 * Every link in the diagram, each a bundle of the routes between two nodes:
 * matrix routes, the dials each sensor moves, the effects its events fire,
 * the genome it shapes, and the audio path from the tracks to the speakers.
 */
export function buildLinks(input: LinkInput): FlowLink[] {
  const { view } = input;
  const links = new Map<string, FlowLink & { net: number; live: number }>();
  const add = (
    from: NodeId,
    to: NodeId,
    kind: LinkKind,
    route: FlowRoute,
    intensity?: number,
  ): void => {
    if (from === to) return;
    const key = `${from}>${to}:${kind}`;
    let link = links.get(key);
    if (!link) {
      link = {
        key,
        from,
        to,
        kind,
        strength: 0,
        intensity: 0,
        sign: 1,
        routes: [],
        net: 0,
        live: 0,
      };
      links.set(key, link);
    }
    link.routes.push(route);
    link.strength += Math.abs(route.amount);
    link.net += route.amount;
    link.live += Math.abs(route.value);
    if (intensity !== undefined) link.intensity = Math.max(link.intensity, intensity);
  };

  const live = new Set(input.channels.map((c) => c.desc.id));
  const tracks = new Map((view?.tracks ?? []).map((t) => [t.slot, t.label]));

  // The modulation matrix.
  for (const r of view?.routes ?? []) {
    if (input.strongOnly && Math.abs(r.amount) < STRONG) continue;
    const from = sourceNode(r.source);
    if (from.startsWith('ch:') && !live.has(from.slice(3))) continue;
    const kind = from.startsWith('ch:') || from === 'mod:dials' ? 'sensor' : 'internal';
    add(from, destNode(r.dest), kind, {
      label: `${sourceLabel(r.source, tracks, input.channelLabel)} → ${destLabel(r.dest, tracks)}`,
      amount: r.amount,
      value: r.value,
    });
  }

  for (const ch of input.channels) {
    const id = ch.desc.id;
    // Every live sensor feeds the fingerprint that writes the next section.
    add(`ch:${id}`, 'mod:genome', 'genome', {
      label: `${ch.desc.label} → the fingerprint that writes each section`,
      amount: 0.15,
      value: 0,
    });
  }

  // The dials: each sensor's share of energy, tension, brightness, …
  for (const m of input.macroRoutes) {
    if (!live.has(m.channelId)) continue;
    const ch = input.channels.find((c) => c.desc.id === m.channelId) as ChannelState;
    const v = m.feature === 'activity' ? ch.features.activity : ch.features.level;
    const amount = (m.invert ? -1 : 1) * Math.min(1, m.weight) * 0.6;
    add(`ch:${m.channelId}`, 'mod:dials', 'sensor', {
      label: `${ch.desc.label} ${m.feature} → ${m.macro} dial${m.invert ? ' (inverted)' : ''}`,
      amount,
      value: amount * v,
    });
  }
  for (const tr of input.triggerRoutes) {
    if (!live.has(tr.channelId)) continue;
    add(
      `ch:${tr.channelId}`,
      'mod:dials',
      'event',
      { label: `${input.channelLabel(tr.channelId)} hits → ${tr.trigger}`, amount: 0.3, value: 0 },
      input.recentOnset(tr.channelId) ? 1 : 0,
    );
  }

  // Sensor events fire effects on the whole mix.
  for (const t of view?.fxTriggers ?? []) {
    if (!live.has(t.channelId)) continue;
    add(
      `ch:${t.channelId}`,
      'bus:fx',
      'event',
      {
        label: `${input.channelLabel(t.channelId)} hits → ${FX_INFO[t.fx].label}`,
        amount: 0.5,
        value: 0,
      },
      input.recentOnset(t.channelId) ? 1 : 0,
    );
  }

  // The song-wide values the dials and the matrix set.
  if (view) {
    const g = view.globals;
    const song = (to: NodeId, label: string, amount: number) =>
      add('mod:song', to, 'sensor', { label, amount, value: amount }, amount);
    add('mod:dials', 'mod:song', 'sensor', {
      label: 'The dials set tension, brightness and space',
      amount: 0.6,
      value: 0.3,
    });
    song('bus:reverb', `Space → reverb return (${pct(g.space)})`, g.space * 0.6);
    song('bus:delay', `Space → delay return (${pct(g.space)})`, g.space * 0.4);
    song('bus:fx', `Effect depth (${pct(g.fx)})`, g.fx * 0.5);
    song('bus:master', `Brightness → master filter (${pct(g.brightness)})`, g.brightness * 0.5);
  }

  // The audio path: tracks into the mix and the sends, the returns into the
  // effects bus, and the effects bus to the master.
  for (const t of view?.tracks ?? []) {
    if (t.role === 'fx') continue;
    const node = `trk:${t.slot}`;
    const loud = input.isMuted(t.slot) ? 0 : input.loudness(node);
    const level = input.isMuted(t.slot) ? 0 : t.params.level;
    const audio = (to: NodeId, label: string, amount: number) =>
      add(node, to, 'audio', { label, amount, value: amount * loud }, loud * clamp01(amount * 2));
    audio('bus:fx', `${t.label} → mix (level ${pct(level)})`, level);
    audio(
      'bus:reverb',
      `${t.label} → reverb send (${pct(t.params.sendReverb)})`,
      t.params.sendReverb,
    );
    audio('bus:delay', `${t.label} → delay send (${pct(t.params.sendDelay)})`, t.params.sendDelay);
  }
  if (view) {
    const bus = (from: NodeId, to: NodeId, label: string) =>
      add(from, to, 'audio', { label, amount: 0.6, value: 0 }, input.loudness(from));
    bus('bus:reverb', 'bus:fx', 'Reverb return → mix');
    bus('bus:delay', 'bus:fx', 'Delay return → mix');
    bus('bus:fx', 'bus:master', 'Mix and effects → master');
  }

  return [...links.values()].map(({ net, live: flowing, ...link }) => ({
    ...link,
    strength: clamp01(link.strength),
    sign: net < 0 ? -1 : 1,
    intensity:
      link.kind === 'sensor' || link.kind === 'internal'
        ? Math.max(link.intensity, clamp01(flowing * 2.5))
        : link.intensity,
  }));
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
