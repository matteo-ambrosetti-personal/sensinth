import { DOMAINS, type Area, type Domain } from '../mapping/partition';
import type { SectionView } from './form';

/** Something a sensor did at one moment of a piece. */
export interface SensorMark {
  /** Bar of the piece, fractional (bar + beat / 4). */
  at: number;
  /** An effect fired, an accent or a fill played, a scene changed, a section chosen. */
  what: 'fx' | 'accent' | 'fill' | 'scene' | 'section';
  /** In words: "Stutter", "New scene", "Chose the solo". */
  label: string;
}

/** What one sensor did over a piece, bar by bar. */
export interface SensorTrace {
  id: string;
  label: string;
  /** The source it belongs to (motion, pointer, camera…). */
  group: string;
  kind: string;
  unit?: string;
  /** The areas it held last. */
  areas: Area[];
  /** Mean level of each bar, 0..1; NaN for bars it was not live. */
  level: number[];
  /** Mean activity of each bar, 0..1. */
  activity: number[];
  /** How much it moved the music in each bar, by domain (mean per step). */
  influence: Record<Domain, number[]>;
  marks: SensorMark[];
  /** Sum of its influence over the piece, by domain. */
  total: Record<Domain, number>;
}

/** The record of a piece: its form, and how each sensor contributed to it. */
export interface PieceLog {
  /** Which piece of the session, from 0. */
  piece: number;
  styleId: string;
  styleName: string;
  /** Key at the start, e.g. "D Dorian". */
  key: string;
  /** Bars logged so far. */
  bars: number;
  /** Seconds per bar at the last bar (the tempo may change during a piece). */
  barSeconds: number;
  sections: SectionView[];
  sensors: SensorTrace[];
  /** Bars where the key changed, with its new name. */
  keys: { bar: number; name: string }[];
  /** The piece reached its last chord. */
  complete: boolean;
}

/** What the engine tells the log about one sensor on one step. */
export interface StepCredit {
  id: string;
  label: string;
  group: string;
  kind: string;
  unit?: string;
  areas: readonly Area[];
  level: number;
  activity: number;
}

function zeroDomains(): Record<Domain, number> {
  return { rhythm: 0, harmony: 0, sound: 0, space: 0, motion: 0 };
}

interface Running {
  trace: SensorTrace;
  /** Sums over the bar being filled. */
  level: number;
  activity: number;
  steps: number;
  influence: Record<Domain, number>;
}

/**
 * Keeps the record of a piece while it plays. Every step the engine credits
 * each live sensor with what its routes, dials and events moved; every bar
 * line the sums become one point of each sensor's trace.
 */
export class PieceRecorder {
  private readonly running = new Map<string, Running>();
  private bars = 0;
  private stepsInBar = 0;
  private barSeconds = 2;
  private key = '';
  private lastKey = '';
  private readonly keys: { bar: number; name: string }[] = [];
  private sections: SectionView[] = [];
  complete = false;

  constructor(
    private readonly piece: number,
    private style: { id: string; name: string },
  ) {}

  setStyle(style: { id: string; name: string }): void {
    this.style = style;
  }

  /** The key now; a change is noted at the bar being filled. */
  setKey(name: string): void {
    if (name === this.lastKey) return;
    if (this.key === '') this.key = name;
    else this.keys.push({ bar: this.bars, name });
    this.lastKey = name;
  }

  setSections(sections: readonly SectionView[]): void {
    this.sections = sections.map((s) => ({
      ...s,
      ...(s.featured ? { featured: { ...s.featured } } : {}),
      ...(s.chosenBy ? { chosenBy: { ...s.chosenBy } } : {}),
    }));
  }

  private entry(c: StepCredit): Running {
    let r = this.running.get(c.id);
    if (!r) {
      const pad = () => new Array<number>(this.bars).fill(0);
      r = {
        trace: {
          id: c.id,
          label: c.label,
          group: c.group,
          kind: c.kind,
          ...(c.unit ? { unit: c.unit } : {}),
          areas: [...c.areas],
          level: new Array<number>(this.bars).fill(NaN),
          activity: pad(),
          influence: { rhythm: pad(), harmony: pad(), sound: pad(), space: pad(), motion: pad() },
          marks: [],
          total: zeroDomains(),
        },
        level: 0,
        activity: 0,
        steps: 0,
        influence: zeroDomains(),
      };
      this.running.set(c.id, r);
    }
    return r;
  }

  /** One step of a live sensor: its reading, and the areas it holds. */
  reading(c: StepCredit): void {
    const r = this.entry(c);
    r.trace.areas = [...c.areas];
    r.trace.label = c.label;
    r.level += c.level;
    r.activity += c.activity;
    r.steps++;
  }

  /** Credits a sensor with having moved something in a domain on this step. */
  credit(id: string, domain: Domain, amount: number): void {
    const r = this.running.get(id);
    if (r && Number.isFinite(amount) && amount > 0) r.influence[domain] += amount;
  }

  /** Something a sensor did now, `beat` beats into the bar being filled. */
  mark(id: string, what: SensorMark['what'], label: string, beat = 0): void {
    const r = this.running.get(id);
    if (!r) return;
    r.trace.marks.push({ at: this.bars + Math.min(0.99, Math.max(0, beat / 4)), what, label });
    if (r.trace.marks.length > 400) r.trace.marks.shift();
  }

  step(): void {
    this.stepsInBar++;
  }

  /** Closes the bar: every sensor's sums become one point of its trace. */
  endBar(barSeconds: number): void {
    const steps = Math.max(1, this.stepsInBar);
    this.barSeconds = barSeconds;
    for (const r of this.running.values()) {
      const t = r.trace;
      t.level.push(r.steps > 0 ? r.level / r.steps : NaN);
      t.activity.push(r.steps > 0 ? r.activity / r.steps : 0);
      for (const d of DOMAINS) {
        const v = r.influence[d] / steps;
        t.influence[d].push(v);
        t.total[d] += v;
      }
      r.level = 0;
      r.activity = 0;
      r.steps = 0;
      r.influence = zeroDomains();
    }
    this.bars++;
    this.stepsInBar = 0;
  }

  /** A copy of the record so far. */
  snapshot(): PieceLog {
    return {
      piece: this.piece,
      styleId: this.style.id,
      styleName: this.style.name,
      key: this.key,
      bars: this.bars,
      barSeconds: this.barSeconds,
      sections: this.sections.map((s) => ({ ...s })),
      sensors: [...this.running.values()].map(({ trace: t }) => ({
        ...t,
        areas: [...t.areas],
        level: [...t.level],
        activity: [...t.activity],
        influence: {
          rhythm: [...t.influence.rhythm],
          harmony: [...t.influence.harmony],
          sound: [...t.influence.sound],
          space: [...t.influence.space],
          motion: [...t.influence.motion],
        },
        marks: t.marks.map((m) => ({ ...m })),
        total: { ...t.total },
      })),
      keys: this.keys.map((k) => ({ ...k })),
      complete: this.complete,
    };
  }
}

/** Each sensor's share of a piece, 0..1, by its total influence; they add up to 1. */
export function sensorShares(log: PieceLog): { id: string; label: string; share: number }[] {
  const sums = log.sensors.map((s) => DOMAINS.reduce((a, d) => a + s.total[d], 0));
  const all = sums.reduce((a, b) => a + b, 0);
  return log.sensors
    .map((s, i) => ({ id: s.id, label: s.label, share: all > 0 ? (sums[i] as number) / all : 0 }))
    .sort((a, b) => b.share - a.share);
}
