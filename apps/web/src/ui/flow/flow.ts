import {
  FX_INFO,
  MACROS,
  PARAM_INFO,
  type ChannelState,
  type EngineView,
  type FxId,
  type Router,
  type SensorHub,
  type TrackParam,
  type TrackView,
} from '@sensinth/core';
import { drawProcessed, drawRaw, drawScope, loudness, readColors, type FlowColors } from './draw';
import { FlowHistory } from './history';
import { buildLinks, type FlowLink, type NodeId } from './links';

export type BusName = 'reverb' | 'delay' | 'fx';

export interface FlowControls {
  hub: SensorHub;
  router: () => Router;
  view: () => EngineView | undefined;
  trackAnalyser: (slot: string) => AnalyserNode | undefined;
  busAnalyser: (bus: BusName) => AnalyserNode | undefined;
  masterAnalyser: () => AnalyserNode | undefined;
  fxNow: () => readonly FxId[];
  isMuted: (slot: string) => boolean;
  /** Sensor clock, seconds. */
  now: () => number;
  sourceName: (source: string | undefined) => string;
}

export interface FlowElements {
  root: HTMLElement;
  sensors: HTMLElement;
  mods: HTMLElement;
  tracks: HTMLElement;
  buses: HTMLElement;
  svg: SVGSVGElement;
  tip: HTMLElement;
  pick: HTMLSelectElement;
  strong: HTMLInputElement;
  pause: HTMLButtonElement;
  empty: HTMLElement;
  table: HTMLElement;
}

/** Milliseconds between data refreshes (the dots move every frame). */
const DATA_MS = 50;
/** Seconds an onset keeps its links lit. */
const ONSET_GLOW = 0.5;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_GAP = 16;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LinkEls {
  link: FlowLink;
  base: SVGPathElement;
  dots: SVGPathElement;
  hit: SVGPathElement;
  offset: number;
  dotsOn: boolean;
}

interface SensorEls {
  li: HTMLElement;
  raw: HTMLCanvasElement;
  proc: HTMLCanvasElement;
  rawNow: HTMLElement;
  level: HTMLElement;
  out: HTMLElement;
}

interface TrackEls {
  li: HTMLElement;
  scope: HTMLCanvasElement;
  led: HTMLElement;
  meter: HTMLElement;
  pan: HTMLElement;
  rev: HTMLElement;
  dly: HTMLElement;
  input: HTMLElement;
}

interface Bars {
  set(id: string, v: number, centered?: boolean): void;
}

/**
 * The Flow page: every live sensor's signal, raw and processed, on its way
 * through the dials, the matrix and the genome to the tracks, and from the
 * tracks through the sends and the effects to the speakers. Links are drawn
 * between the cards in an SVG layer; their width is the routing's strength,
 * their brightness and moving dots what passes right now.
 */
export class FlowView {
  active = false;
  private readonly history: FlowHistory;
  private paused = false;
  private colors: FlowColors | undefined;
  private sensorEls = new Map<string, SensorEls>();
  private trackEls = new Map<string, TrackEls>();
  private nodes = new Map<NodeId, HTMLElement>();
  private boxes = new Map<NodeId, Box>();
  private links: FlowLink[] = [];
  private linkEls = new Map<string, LinkEls>();
  private structure = '';
  private linkSignature = '';
  private geometryDirty = true;
  private lastData = 0;
  private lastLayout = 0;
  private lastFrame = 0;
  private hovered: NodeId | undefined;
  private litLinks = new Set<string>();
  private focused = false;
  private pinned: NodeId | undefined;
  /** The sensor whose links the stacked (phone) layout draws. */
  private picked: string | undefined;
  private readonly wide = window.matchMedia('(min-width: 880px)');
  private readonly mods: Record<'genome' | 'dials' | 'song' | 'lfo' | 'chaos', HTMLElement>;
  private readonly modBars: Record<'dials' | 'song' | 'lfo' | 'chaos', Bars>;
  private readonly busEls: Record<
    'reverb' | 'delay' | 'fx' | 'master',
    { li: HTMLElement; meter: HTMLElement; note: HTMLElement }
  >;
  private readonly fxNow: HTMLElement;
  private readonly masterScope: HTMLCanvasElement;
  private readonly genomeHash: HTMLElement;
  private readonly genomeNote: HTMLElement;

  constructor(
    private readonly c: FlowControls,
    private readonly els: FlowElements,
  ) {
    this.history = new FlowHistory(c.hub);

    // Modulators.
    els.mods.replaceChildren();
    const mod = (id: keyof FlowView['mods'], title: string, about: string) => {
      const li = node('li', `flow-node flow-mod flow-mod-${id}`, `mod:${id}`);
      li.innerHTML = `<div class="fn-head"><span class="fn-name"></span></div><p class="fn-note"></p>`;
      text(li, '.fn-name', title);
      text(li, '.fn-note', about);
      els.mods.append(li);
      this.nodes.set(`mod:${id}`, li);
      return li;
    };
    this.mods = {
      genome: mod('genome', 'Genome', 'Every sensor shapes the next section.'),
      dials: mod('dials', 'Dials', 'Sensor summaries.'),
      song: mod('song', 'Song', 'Values for the whole mix.'),
      lfo: mod('lfo', 'LFOs', 'One per track.'),
      chaos: mod('chaos', 'Chaos', 'Two coupled maps.'),
    };
    const hash = document.createElement('b');
    hash.className = 'fn-hash';
    hash.textContent = '–';
    this.mods.genome.querySelector('.fn-head')?.append(hash);
    this.genomeHash = hash;
    this.genomeNote = this.mods.genome.querySelector('.fn-note') as HTMLElement;
    this.modBars = {
      dials: bars(this.mods.dials, [...MACROS]),
      song: bars(this.mods.song, ['tension', 'brightness', 'swing', 'space', 'effects']),
      lfo: bars(this.mods.lfo, []),
      chaos: bars(this.mods.chaos, ['A', 'B']),
    };

    // The mix.
    els.buses.replaceChildren();
    const bus = (id: 'reverb' | 'delay' | 'fx' | 'master', title: string) => {
      const li = node('li', `flow-node flow-bus flow-bus-${id}`, `bus:${id}`);
      li.innerHTML = `<div class="fn-head"><span class="fn-name"></span></div><span class="fn-meter" role="presentation"><i></i></span><p class="fn-note"></p>`;
      text(li, '.fn-name', title);
      els.buses.append(li);
      this.nodes.set(`bus:${id}`, li);
      return {
        li,
        meter: li.querySelector('.fn-meter > i') as HTMLElement,
        note: li.querySelector('.fn-note') as HTMLElement,
      };
    };
    this.busEls = {
      reverb: bus('reverb', 'Reverb'),
      delay: bus('delay', 'Delay'),
      fx: bus('fx', 'Mix & effects'),
      master: bus('master', 'Master'),
    };
    this.fxNow = document.createElement('output');
    this.fxNow.className = 'fn-fx';
    this.fxNow.textContent = 'No effect';
    this.busEls.fx.li.querySelector('.fn-head')?.after(this.fxNow);
    this.masterScope = document.createElement('canvas');
    this.masterScope.className = 'fn-scope';
    this.masterScope.setAttribute('aria-hidden', 'true');
    this.busEls.master.li.querySelector('.fn-head')?.after(this.masterScope);

    // Interaction.
    els.root.addEventListener('pointerover', (e) => this.hover(nodeOf(e.target)));
    els.root.addEventListener('pointerleave', () => this.hover(undefined));
    els.root.addEventListener('focusin', (e) => this.hover(nodeOf(e.target)));
    els.root.addEventListener('click', (e) => {
      const id = nodeOf(e.target);
      if (id) this.pin(this.pinned === id ? undefined : id);
    });
    els.root.addEventListener('keydown', (e) => {
      const id = nodeOf(e.target);
      if (id && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.pin(this.pinned === id ? undefined : id);
      } else if (e.key === 'Escape') this.pin(undefined);
    });
    els.svg.addEventListener('pointermove', (e) => this.showTip(e));
    els.svg.addEventListener('pointerleave', () => (els.tip.hidden = true));
    els.pick.addEventListener('change', () => {
      this.picked = els.pick.value || undefined;
      if (this.wide.matches) this.pin(this.picked ? `ch:${this.picked}` : undefined);
      this.applyFocus();
      this.geometryDirty = true;
    });
    els.strong.addEventListener('change', () => this.refresh());
    els.pause.addEventListener('click', () => {
      this.paused = !this.paused;
      this.history.paused = this.paused;
      els.pause.setAttribute('aria-pressed', String(this.paused));
      els.pause.textContent = this.paused ? 'Resume' : 'Pause';
    });
    new ResizeObserver(() => (this.geometryDirty = true)).observe(els.root);
    this.wide.addEventListener('change', () => {
      this.geometryDirty = true;
      this.applyFocus();
    });
  }

  setActive(on: boolean): void {
    this.active = on;
    if (on) {
      this.colors = undefined;
      this.geometryDirty = true;
    }
  }

  /** Call every animation frame; does nothing while the page is hidden. */
  frame(t: number): void {
    if (!this.active) return;
    const dt = Math.min(0.1, (t - (this.lastFrame || t)) / 1000);
    this.lastFrame = t;
    if (!this.paused && t - this.lastData >= DATA_MS) {
      this.lastData = t;
      this.refresh();
    }
    if (this.geometryDirty || t - this.lastLayout > 500) {
      this.lastLayout = t;
      this.layout();
    }
    if (!this.paused) this.moveDots(dt);
  }

  private refresh(): void {
    const c = this.c;
    const colors = (this.colors ??= readColors(this.els.root));
    const now = c.now();
    const channels = c.hub
      .list()
      .filter((ch) => !ch.stale)
      .sort((a, b) => sourceOrder(a, b, c.sourceName));
    const view = c.view();
    const tracks = (view?.tracks ?? []).filter((t) => t.role !== 'fx');
    const structure = `${channels.map((ch) => ch.desc.id).join(',')}|${tracks.map((t) => `${t.slot}:${t.machine}`).join(',')}`;
    if (structure !== this.structure) {
      this.structure = structure;
      this.rebuild(channels, tracks);
    }
    this.els.empty.hidden = channels.length > 0;

    // Sensors: raw and processed traces, and where each one goes.
    for (const ch of channels) {
      const e = this.sensorEls.get(ch.desc.id);
      if (!e) continue;
      const samples = this.history.get(ch.desc.id);
      drawRaw(e.raw, samples, now, colors);
      drawProcessed(e.proc, samples, now, colors);
      e.rawNow.textContent = formatValue(ch.raw, ch.desc.unit ?? '');
      e.level.textContent = ch.features.level.toFixed(2);
    }

    // Modulators.
    const router = c.router();
    for (const m of MACROS) this.modBars.dials.set(m, router.macros[m]);
    if (view) {
      const g = view.globals;
      this.modBars.song.set('tension', g.tension);
      this.modBars.song.set('brightness', g.brightness);
      this.modBars.song.set('swing', (view.swing - 0.5) / 0.16);
      this.modBars.song.set('space', g.space);
      this.modBars.song.set('effects', g.fx);
      const snap = view.snapshot;
      this.genomeHash.textContent = snap.waiting ? '–' : `#${snap.genome}`;
      const r = view.rebuild;
      this.genomeNote.textContent = snap.waiting
        ? 'Waiting for a sensor.'
        : `Section ${snap.section + 1}, written at bar ${Math.floor(r.step / 16) + 1} (${REBUILD[r.reason]}${r.channel ? `: ${r.channel}` : ''}). Every sensor shapes the next one.`;
      for (const r of view.routes) {
        if (r.source.startsWith('lfo:')) {
          const v = r.amount === 0 ? 0 : r.value / r.amount;
          this.modBars.lfo.set(r.source.slice(4).toUpperCase(), v, true);
        } else if (r.source.startsWith('chaos:')) {
          const v = r.amount === 0 ? 0 : r.value / r.amount;
          this.modBars.chaos.set(r.source.slice(6).toUpperCase(), v, true);
        }
      }
    }

    // Tracks and their mix strip.
    const levels = new Map<NodeId, number>();
    for (const t of tracks) {
      const e = this.trackEls.get(t.slot);
      if (!e) continue;
      const analyser = c.trackAnalyser(t.slot);
      const loud = loudness(analyser);
      levels.set(`trk:${t.slot}`, loud);
      drawScope(e.scope, analyser, colors.accent);
      e.led.classList.toggle('is-on', t.fired > 0);
      e.meter.style.transform = `scaleX(${loud.toFixed(3)})`;
      e.pan.style.left = `${(t.params.pan * 100).toFixed(1)}%`;
      e.rev.style.transform = `scaleX(${t.params.sendReverb.toFixed(3)})`;
      e.dly.style.transform = `scaleX(${t.params.sendDelay.toFixed(3)})`;
      e.li.classList.toggle('is-muted', c.isMuted(t.slot));
    }

    // The mix.
    for (const b of ['reverb', 'delay', 'fx'] as const) {
      const loud = loudness(c.busAnalyser(b));
      levels.set(`bus:${b}`, loud);
      this.busEls[b].meter.style.transform = `scaleX(${loud.toFixed(3)})`;
    }
    const master = c.masterAnalyser();
    const masterLoud = loudness(master);
    levels.set('bus:master', masterLoud);
    this.busEls.master.meter.style.transform = `scaleX(${masterLoud.toFixed(3)})`;
    drawScope(this.masterScope, master, colors.accent);
    const playing = c.fxNow();
    const fxText =
      playing.length > 0 ? playing.map((f) => FX_INFO[f].label).join(' + ') : 'No effect';
    if (this.fxNow.textContent !== fxText) this.fxNow.textContent = fxText;
    this.fxNow.classList.toggle('is-on', playing.length > 0);
    if (view) {
      const g = view.globals;
      this.busEls.reverb.note.textContent = `space ${pct(g.space)}`;
      this.busEls.delay.note.textContent = `space ${pct(g.space)}`;
      this.busEls.fx.note.textContent = `effect depth ${pct(g.fx)}`;
      const snap = view.snapshot;
      this.busEls.master.note.textContent = snap.waiting
        ? 'waiting'
        : `${snap.keyName} · ${snap.chordRoman} · bright ${pct(g.brightness)}`;
    } else {
      for (const b of Object.values(this.busEls)) b.note.textContent = 'stopped';
    }

    // Links.
    const { macros, triggers } = router.getRoutes();
    this.links = buildLinks({
      view,
      channels,
      macroRoutes: macros,
      triggerRoutes: triggers,
      strongOnly: this.els.strong.checked,
      channelLabel: (id) => c.hub.get(id)?.desc.label ?? id,
      recentOnset: (id) => now - (c.hub.get(id)?.lastOnsetT ?? -Infinity) < ONSET_GLOW,
      loudness: (n) => levels.get(n) ?? 0,
      isMuted: (slot) => c.isMuted(slot),
    });
    const signature = this.links.map((l) => l.key).join('|');
    if (signature !== this.linkSignature) {
      this.linkSignature = signature;
      this.rebuildLinks();
    }
    for (const l of this.links) {
      const e = this.linkEls.get(l.key);
      if (e) e.link = l;
    }
    this.styleLinks();
    this.summarize(channels, tracks);
  }

  /**
   * Width shows how strong a link is, brightness and moving dots how much
   * passes now. Links into the dials and the genome stay quiet unless their
   * sensor is in focus, so the routes to the tracks stand out.
   */
  private styleLinks(): void {
    for (const e of this.linkEls.values()) {
      const l = e.link;
      const quiet = isQuiet(l);
      const lit = this.litLinks.has(l.key);
      const width = l.kind === 'genome' ? 1.5 : quiet ? 1 + 1.5 * l.strength : 1 + 4 * l.strength;
      let opacity =
        l.kind === 'genome' ? 0.2 : quiet ? 0.14 + 0.3 * l.intensity : 0.25 + 0.75 * l.intensity;
      if (this.focused) opacity = lit ? Math.max(0.85, opacity) : 0.05;
      e.base.style.strokeWidth = width.toFixed(2);
      e.base.style.opacity = opacity.toFixed(2);
      e.base.classList.toggle('is-down', l.sign < 0 && l.kind !== 'genome');
      e.dotsOn =
        l.kind !== 'genome' &&
        (this.focused ? lit && l.intensity > 0.04 : !quiet && l.intensity > 0.15);
      e.dots.style.strokeWidth = Math.min(6, 3 + width * 0.4).toFixed(2);
      e.dots.style.opacity = e.dotsOn ? '1' : '0';
    }
  }

  /** Rebuilds the sensor cards and track nodes when channels or machines change. */
  private rebuild(channels: readonly ChannelState[], tracks: readonly TrackView[]): void {
    const { els } = this;
    for (const id of [...this.nodes.keys()]) {
      if (id.startsWith('ch:') || id.startsWith('trk:')) this.nodes.delete(id);
    }

    els.sensors.replaceChildren();
    this.sensorEls.clear();
    let group = '';
    for (const ch of channels) {
      const source = this.c.sourceName(ch.desc.source);
      if (source !== group) {
        group = source;
        const head = document.createElement('li');
        head.className = 'flow-group';
        head.textContent = source;
        els.sensors.append(head);
      }
      const li = node('li', 'flow-node flow-sensor', `ch:${ch.desc.id}`);
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', 'false');
      li.innerHTML = `
        <div class="fn-head"><span class="fn-name"></span><span class="fn-tag"></span></div>
        <div class="fn-signal">
          <figure title="Raw reading, scaled to its recent range"><canvas class="fn-raw" aria-hidden="true"></canvas><figcaption class="fn-raw-now">–</figcaption></figure>
          <span class="fn-arrow" aria-hidden="true">→</span>
          <figure title="Processed: level (line), normalized (thin line), movement (area), hits (ticks)"><canvas class="fn-proc" aria-hidden="true"></canvas><figcaption class="fn-level"></figcaption></figure>
        </div>
        <p class="fn-out"></p>`;
      text(li, '.fn-name', ch.desc.label);
      text(li, '.fn-tag', ch.timescale);
      els.sensors.append(li);
      this.nodes.set(`ch:${ch.desc.id}`, li);
      this.sensorEls.set(ch.desc.id, {
        li,
        raw: li.querySelector('.fn-raw') as HTMLCanvasElement,
        proc: li.querySelector('.fn-proc') as HTMLCanvasElement,
        rawNow: li.querySelector('.fn-raw-now') as HTMLElement,
        level: li.querySelector('.fn-level') as HTMLElement,
        out: li.querySelector('.fn-out') as HTMLElement,
      });
    }

    els.tracks.replaceChildren();
    this.trackEls.clear();
    if (tracks.length === 0) {
      const li = document.createElement('li');
      li.className = 'flow-placeholder';
      li.textContent = 'Press Play: the tracks the sensors write appear here.';
      els.tracks.append(li);
    }
    for (const t of tracks) {
      const li = node('li', 'flow-node flow-track', `trk:${t.slot}`);
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', 'false');
      li.innerHTML = `
        <div class="fn-head"><span class="fn-slot"></span><span class="fn-name"></span><i class="fn-led" aria-hidden="true"></i></div>
        <canvas class="fn-scope" aria-hidden="true"></canvas>
        <div class="fn-mix">
          <span>LVL</span><span class="fn-meter"><i></i></span>
          <span>PAN</span><span class="fn-pan"><i></i></span>
          <span>REV</span><span class="fn-meter thin"><i></i></span>
          <span>DLY</span><span class="fn-meter thin"><i></i></span>
        </div>
        <p class="fn-in"></p>`;
      text(li, '.fn-slot', t.slot.toUpperCase());
      text(li, '.fn-name', t.label);
      els.tracks.append(li);
      this.nodes.set(`trk:${t.slot}`, li);
      const meters = li.querySelectorAll<HTMLElement>('.fn-meter > i');
      this.trackEls.set(t.slot, {
        li,
        scope: li.querySelector('.fn-scope') as HTMLCanvasElement,
        led: li.querySelector('.fn-led') as HTMLElement,
        meter: meters[0] as HTMLElement,
        rev: meters[1] as HTMLElement,
        dly: meters[2] as HTMLElement,
        pan: li.querySelector('.fn-pan > i') as HTMLElement,
        input: li.querySelector('.fn-in') as HTMLElement,
      });
    }

    // The picker lists the sensors; the most active one starts selected.
    const pick = els.pick;
    pick.replaceChildren();
    for (const ch of channels) {
      const opt = document.createElement('option');
      opt.value = ch.desc.id;
      opt.textContent = ch.desc.label;
      pick.append(opt);
    }
    if (!this.picked || !channels.some((ch) => ch.desc.id === this.picked)) {
      const busiest = [...channels].sort((a, b) => b.features.activity - a.features.activity)[0];
      this.picked = busiest?.desc.id;
    }
    if (this.picked) pick.value = this.picked;
    if (this.pinned && !this.nodes.has(this.pinned)) this.pinned = undefined;
    this.geometryDirty = true;
    this.applyFocus();
  }

  private rebuildLinks(): void {
    const svg = this.els.svg;
    svg.replaceChildren();
    const layers = ['flow-bases', 'flow-dots', 'flow-hits'].map((cls) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', cls);
      svg.append(g);
      return g;
    }) as [SVGGElement, SVGGElement, SVGGElement];
    const old = this.linkEls;
    this.linkEls = new Map();
    // Draw the faint kinds first, so strong links sit on top.
    const order = [...this.links].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    for (const link of order) {
      const path = (cls: string) => {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('class', cls);
        return p;
      };
      const base = path(`flow-link fl-${link.kind}`);
      const dots = path(`flow-dot fl-${link.kind}`);
      dots.style.strokeDasharray = `0 ${DOT_GAP}`;
      base.dataset.from = link.from;
      base.dataset.to = link.to;
      const hit = path('flow-hit');
      hit.dataset.key = link.key;
      layers[0].append(base);
      layers[1].append(dots);
      layers[2].append(hit);
      this.linkEls.set(link.key, {
        link,
        base,
        dots,
        hit,
        offset: old.get(link.key)?.offset ?? 0,
        dotsOn: false,
      });
    }
    this.geometryDirty = true;
    this.applyFocus();
  }

  /** Measures every node and redraws the link paths. */
  private layout(): void {
    this.geometryDirty = false;
    const root = this.els.root;
    const origin = root.getBoundingClientRect();
    if (origin.width === 0) return;
    this.els.svg.setAttribute('viewBox', `0 0 ${origin.width} ${origin.height}`);
    this.els.svg.style.width = `${origin.width}px`;
    this.els.svg.style.height = `${origin.height}px`;
    this.boxes.clear();
    for (const [id, el] of this.nodes) {
      const r = el.getBoundingClientRect();
      this.boxes.set(id, {
        x: r.left - origin.left,
        y: r.top - origin.top,
        w: r.width,
        h: r.height,
      });
    }
    const stacked = !this.wide.matches;
    const ports = stacked ? undefined : this.ports();
    for (const e of this.linkEls.values()) {
      const a = this.boxes.get(e.link.from);
      const b = this.boxes.get(e.link.to);
      const shown = !!a && !!b && (!stacked || this.inPicked(e.link));
      for (const p of [e.base, e.dots, e.hit]) p.style.display = shown ? '' : 'none';
      if (!shown) continue;
      const d = stacked
        ? gutterPath(a, b, 8)
        : sidePath(e.link, a, b, ports?.get(e.link.key) ?? [0, 0]);
      for (const p of [e.base, e.dots, e.hit]) p.setAttribute('d', d);
    }
  }

  /**
   * Spreads the links leaving or entering the same side of a node, sorted by
   * where their other end is, so they fan out instead of piling up.
   */
  private ports(): Map<string, [number, number]> {
    const sides = new Map<string, { key: string; other: number }[]>();
    const push = (side: string, key: string, other: number) => {
      const list = sides.get(side) ?? [];
      list.push({ key: `${key}|${side.endsWith(':in') ? 'in' : 'out'}`, other });
      sides.set(side, list);
    };
    for (const e of this.linkEls.values()) {
      const a = this.boxes.get(e.link.from);
      const b = this.boxes.get(e.link.to);
      if (!a || !b) continue;
      push(`${e.link.from}:out`, e.link.key, b.y + b.h / 2);
      push(`${e.link.to}:in`, e.link.key, a.y + a.h / 2);
    }
    const offsets = new Map<string, number>();
    for (const [side, list] of sides) {
      const box = this.boxes.get(side.slice(0, side.lastIndexOf(':'))) as Box;
      list.sort((p, q) => p.other - q.other);
      const step = Math.min(7, (box.h - 16) / Math.max(1, list.length));
      list.forEach((p, i) => offsets.set(p.key, (i - (list.length - 1) / 2) * step));
    }
    const out = new Map<string, [number, number]>();
    for (const e of this.linkEls.values()) {
      out.set(e.link.key, [
        offsets.get(`${e.link.key}|out`) ?? 0,
        offsets.get(`${e.link.key}|in`) ?? 0,
      ]);
    }
    return out;
  }

  private moveDots(dt: number): void {
    for (const e of this.linkEls.values()) {
      const l = e.link;
      if (!e.dotsOn) continue;
      e.offset = (e.offset - dt * (10 + 80 * l.intensity)) % (DOT_GAP * 100);
      e.dots.style.strokeDashoffset = e.offset.toFixed(1);
    }
  }

  private inPicked(link: FlowLink): boolean {
    return !!this.picked && link.from === `ch:${this.picked}`;
  }

  private hover(id: NodeId | undefined): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.applyFocus();
  }

  private pin(id: NodeId | undefined): void {
    this.pinned = id;
    if (id?.startsWith('ch:')) {
      this.picked = id.slice(3);
      this.els.pick.value = this.picked;
      this.geometryDirty = true;
    }
    for (const [nid, el] of this.nodes) {
      if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(nid === id));
    }
    this.applyFocus();
  }

  /** Lights the focused node's whole path and dims everything else. */
  private applyFocus(): void {
    const focus =
      this.pinned ?? this.hovered ?? (this.wide.matches ? undefined : pickedNode(this.picked));
    const root = this.els.root;
    root.classList.toggle('is-focused', !!focus);
    const litLinks = new Set<string>();
    const litNodes = new Set<NodeId>();
    if (focus) {
      litNodes.add(focus);
      // Downstream from the focus, plus whatever feeds it directly.
      const queue = [focus];
      const seen = new Set<NodeId>();
      while (queue.length > 0) {
        const n = queue.shift() as NodeId;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const l of this.links) {
          if (l.from !== n) continue;
          // From a sensor follow everything; past it, follow only the audio path.
          if (n !== focus && l.kind !== 'audio') continue;
          litLinks.add(l.key);
          litNodes.add(l.to);
          queue.push(l.to);
        }
      }
      for (const l of this.links) {
        if (l.to === focus) {
          litLinks.add(l.key);
          litNodes.add(l.from);
        }
      }
    }
    this.litLinks = litLinks;
    this.focused = !!focus;
    this.styleLinks();
    for (const [id, el] of this.nodes) el.classList.toggle('is-lit', litNodes.has(id));
  }

  private showTip(e: PointerEvent): void {
    const target = e.target as Element;
    const key = target instanceof SVGPathElement ? target.dataset.key : undefined;
    const tip = this.els.tip;
    const link = key ? this.linkEls.get(key)?.link : undefined;
    if (!link) {
      tip.hidden = true;
      return;
    }
    tip.replaceChildren();
    const title = document.createElement('b');
    title.textContent = `${this.nodeLabel(link.from)} → ${this.nodeLabel(link.to)}`;
    tip.append(title);
    const list = document.createElement('ul');
    const routes = [...link.routes].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    for (const r of routes.slice(0, 6)) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = r.label;
      li.append(label);
      if (link.kind === 'sensor' || link.kind === 'internal') {
        const v = document.createElement('span');
        v.className = 'flow-tip-num';
        v.textContent = `${signed(r.amount)} · now ${signed(r.value)}`;
        li.append(v);
      }
      list.append(li);
    }
    if (routes.length > 6) {
      const more = document.createElement('li');
      more.textContent = `and ${routes.length - 6} more`;
      list.append(more);
    }
    tip.append(list);
    tip.hidden = false;
    const origin = this.els.root.getBoundingClientRect();
    const x = e.clientX - origin.left;
    const y = e.clientY - origin.top;
    const flip = x > origin.width - 300;
    tip.style.left = `${flip ? x - 12 - tip.offsetWidth : x + 14}px`;
    tip.style.top = `${y + 14}px`;
  }

  private nodeLabel(id: NodeId): string {
    const el = this.nodes.get(id);
    const slot = el?.querySelector('.fn-slot')?.textContent;
    const name = el?.querySelector('.fn-name')?.textContent ?? id;
    return slot ? `${slot} ${name}` : name;
  }

  /** Short text for each node, plus the list of every link for screen readers. */
  private summarize(channels: readonly ChannelState[], tracks: readonly TrackView[]): void {
    for (const ch of channels) {
      const e = this.sensorEls.get(ch.desc.id);
      if (!e) continue;
      const from = this.links.filter((l) => l.from === `ch:${ch.desc.id}`);
      const reached = from.filter((l) => l.to.startsWith('trk:')).length;
      const parts = [`${reached} track${reached === 1 ? '' : 's'}`];
      if (from.some((l) => l.to === 'mod:dials')) parts.push('dials');
      if (from.some((l) => l.to === 'mod:song')) parts.push('song');
      const fx = from.find((l) => l.to === 'bus:fx');
      if (fx) parts.push(`fires ${fx.routes[0]?.label.split('→ ')[1] ?? 'an effect'}`);
      const out = `→ ${parts.join(' · ')}`;
      if (e.out.textContent !== out) e.out.textContent = out;
    }
    const routes = this.c.view()?.routes ?? [];
    for (const t of tracks) {
      const e = this.trackEls.get(t.slot);
      if (!e) continue;
      const params = new Map<TrackParam, number>();
      for (const r of routes) {
        const [slot, param] = r.dest.split('.') as [string, TrackParam];
        if (slot !== t.slot || !(param in PARAM_INFO)) continue;
        params.set(param, (params.get(param) ?? 0) + Math.abs(r.value));
      }
      const top = [...params.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const input = top.length
        ? `← ${top.map(([p]) => PARAM_INFO[p].short).join(' ')}`
        : '← no modulation';
      if (e.input.textContent !== input) e.input.textContent = input;
    }
    const table = this.els.table;
    if (table.dataset.signature !== this.linkSignature) {
      table.dataset.signature = this.linkSignature;
      table.replaceChildren(
        ...this.links
          .filter((l) => l.kind !== 'genome')
          .map((l) => {
            const li = document.createElement('li');
            li.textContent = `${this.nodeLabel(l.from)} → ${this.nodeLabel(l.to)}: ${l.routes.map((r) => r.label).join('; ')}`;
            return li;
          }),
      );
    }
  }
}

/** Links into the dials and the genome: always there, so they stay in the background. */
function isQuiet(l: FlowLink): boolean {
  return l.kind === 'genome' || l.to === 'mod:dials';
}

const KIND_ORDER: Record<FlowLink['kind'], number> = {
  genome: 0,
  audio: 1,
  internal: 2,
  event: 3,
  sensor: 4,
};

const REBUILD: Record<EngineView['rebuild']['reason'], string> = {
  start: 'start',
  section: 'new section',
  scene: 'new scene',
  style: 'new style',
  resume: 'sensors back',
  edit: 'new version',
};

/** Columns, left to right: sensors, modulators, tracks, mix. */
function column(id: NodeId): number {
  if (id.startsWith('ch:')) return 0;
  if (id.startsWith('mod:')) return 1;
  if (id.startsWith('trk:')) return 2;
  return 3;
}

/** A link between two cards, leaving and entering on the sides that face each other. */
function sidePath(link: FlowLink, a: Box, b: Box, [outOff, inOff]: [number, number]): string {
  const ca = column(link.from);
  const cb = column(link.to);
  const ya = a.y + a.h / 2 + outOff;
  const yb = b.y + b.h / 2 + inOff;
  if (link.from === 'bus:fx' && link.to === 'bus:master') {
    const x = a.x + a.w / 2;
    return `M${f(x)} ${f(a.y + a.h)}L${f(x)} ${f(b.y)}`;
  }
  if (ca !== cb) {
    const forward = ca < cb;
    const x1 = forward ? a.x + a.w : a.x;
    const x2 = forward ? b.x : b.x + b.w;
    const dx = Math.max(36, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
    return `M${f(x1)} ${f(ya)}C${f(x1 + dx)} ${f(ya)} ${f(x2 - dx)} ${f(yb)} ${f(x2)} ${f(yb)}`;
  }
  // Same column: an arc out to the side, left for tracks, right otherwise.
  const left = ca === 2;
  const x1 = left ? a.x : a.x + a.w;
  const x2 = left ? b.x : b.x + b.w;
  const bulge = (22 + Math.abs(yb - ya) * 0.12) * (left ? -1 : 1);
  return `M${f(x1)} ${f(ya)}C${f(x1 + bulge)} ${f(ya)} ${f(x2 + bulge)} ${f(yb)} ${f(x2)} ${f(yb)}`;
}

/** On a phone the cards stack, so links run down the left gutter and turn in. */
function gutterPath(a: Box, b: Box, gutter: number): string {
  const y1 = a.y + Math.min(a.h / 2, 28);
  const y2 = b.y + Math.min(b.h / 2, 22);
  const r = Math.min(8, Math.abs(y2 - y1) / 2);
  const down = y2 > y1 ? 1 : -1;
  return `M${f(a.x)} ${f(y1)}H${f(gutter + r)}Q${f(gutter)} ${f(y1)} ${f(gutter)} ${f(y1 + r * down)}V${f(y2 - r * down)}Q${f(gutter)} ${f(y2)} ${f(gutter + r)} ${f(y2)}H${f(b.x)}`;
}

function pickedNode(id: string | undefined): NodeId | undefined {
  return id ? `ch:${id}` : undefined;
}

function f(n: number): string {
  return n.toFixed(1);
}

function node(tag: string, cls: string, id: NodeId): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  el.dataset.node = id;
  return el;
}

function text(root: Element, selector: string, value: string): void {
  const el = root.querySelector(selector);
  if (el) el.textContent = value;
}

function nodeOf(target: EventTarget | null): NodeId | undefined {
  const el = target instanceof Element ? target.closest<HTMLElement>('[data-node]') : null;
  return el?.dataset.node;
}

/** A list of small labelled bars inside a node. Rows can be added later by id. */
function bars(parent: HTMLElement, ids: readonly string[]): Bars {
  const ul = document.createElement('ul');
  ul.className = 'fn-bars';
  parent.append(ul);
  const rows = new Map<string, HTMLElement>();
  const row = (id: string) => {
    let bar = rows.get(id);
    if (!bar) {
      const li = document.createElement('li');
      li.innerHTML = `<span></span><span class="fn-meter thin"><i></i></span>`;
      (li.firstElementChild as HTMLElement).textContent = id;
      ul.append(li);
      bar = li.querySelector('i') as HTMLElement;
      rows.set(id, bar);
    }
    return bar;
  };
  for (const id of ids) row(id);
  return {
    set(id, v, centered = false) {
      const bar = row(id);
      if (centered) {
        const c = Math.max(-1, Math.min(1, v));
        bar.style.transformOrigin = c < 0 ? 'right' : 'left';
        bar.style.left = c < 0 ? `${50 + c * 50}%` : '50%';
        bar.style.width = `${Math.abs(c) * 50}%`;
        bar.style.transform = 'none';
      } else {
        bar.style.transform = `scaleX(${Math.max(0, Math.min(1, v)).toFixed(3)})`;
      }
    },
  };
}

function sourceOrder(
  a: ChannelState,
  b: ChannelState,
  name: (source: string | undefined) => string,
): number {
  return (
    name(a.desc.source).localeCompare(name(b.desc.source)) ||
    a.desc.label.localeCompare(b.desc.label)
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
}

function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}
