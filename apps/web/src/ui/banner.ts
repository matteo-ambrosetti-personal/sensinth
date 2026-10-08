import type { EditView, EngineView, PendingEdit } from '@sensinth/core';

/** How long a "landed" message stays up, in milliseconds. */
const LANDED_MS = 2600;
/** Lines the banner shows at most; the rest are counted. */
const MAX_LINES = 4;

/** Something that just happened, for the screen and the track rows. */
export interface Landed {
  /** Tracks an edit landed on, to light up. */
  slots: readonly string[];
}

/**
 * The dialogue box over the screen. In deterministic mode it says what an
 * input is about to do and when ("Q ▸ REWRITE T1 · BASS · BAR 3"), then
 * that it landed; in the sensor-driven mode it announces a new scene.
 */
export class BannerView {
  private lines: { text: string; kind: string }[] = [];
  private landedUntil = 0;
  private landed: { text: string; kind: string }[] = [];
  private lastVersion = '';
  /** The edits in effect after the last version, by input, to tell what a new one changed. */
  private lastEdits = new Map<string, EditView>();
  private lastRebuild = -1;
  private shown = '';

  constructor(private readonly el: HTMLElement) {}

  /** Returns what landed on this update, if anything did. */
  update(view: EngineView | undefined, now: number): Landed | undefined {
    let out: Landed | undefined;
    if (!view || view.snapshot.waiting) {
      this.lastVersion = '';
      this.lastEdits = new Map();
      this.lastRebuild = -1;
      this.lines = [];
      this.landedUntil = 0;
    } else {
      const song = view.song;
      const r = view.rebuild;
      if (song) {
        this.lines = song.pending.map((p) => pendingLine(p, song.loopBars));
        if (song.version !== this.lastVersion) {
          const first = this.lastVersion === '';
          const before = this.lastVersion;
          const was = this.lastEdits;
          this.lastVersion = song.version;
          this.lastEdits = new Map(song.edits.map((e) => [e.input, e]));
          if (!first) {
            // The version is the edits' part, then the generation's (`1f2946.g2`): either can move.
            const edited = editsPart(song.version) !== editsPart(before);
            const gen = song.evolve?.generation ?? 0;
            const evolved = song.evolve !== undefined && generationOf(before) !== gen;
            const n = song.edits.length;
            const what = !edited
              ? `▸ The song evolved: generation ${gen}`
              : (editsPart(song.version) === 'base'
                  ? '▸ Back to the seed’s song'
                  : `▸ New song ${song.version} · ${n} change${n === 1 ? '' : 's'}`) +
                (evolved ? ` · generation ${gen}` : '');
            this.landed = [{ text: what, kind: 'is-landed' }];
            this.landedUntil = now + LANDED_MS;
            out = { slots: changedSlots(was, this.lastEdits) };
          }
        }
      } else if (r.step !== this.lastRebuild) {
        const first = this.lastRebuild < 0;
        this.lastRebuild = r.step;
        if (!first && r.reason === 'scene') {
          this.landed = [
            { text: `▸ New scene${r.channel ? `: ${r.channel}` : ''}`, kind: 'is-landed' },
          ];
          this.landedUntil = now + LANDED_MS;
        }
      }
    }
    const all = [...this.lines, ...(now < this.landedUntil ? this.landed : [])];
    const key = all.map((l) => `${l.kind}|${l.text}`).join('\n');
    if (key !== this.shown) {
      this.shown = key;
      this.el.hidden = all.length === 0;
      // Too many to show: the newest stay, the others are counted.
      const shown =
        all.length > MAX_LINES
          ? [
              { text: `+${all.length - MAX_LINES + 1} more`, kind: 'is-more' },
              ...all.slice(-(MAX_LINES - 1)),
            ]
          : all;
      this.el.replaceChildren(
        ...shown.map((l) => {
          const p = document.createElement('span');
          p.className = l.kind;
          p.textContent = l.text;
          return p;
        }),
      );
    }
    return out;
  }
}

/** The edits' part of a song version: `base`, or the edits' id. */
function editsPart(version: string): string {
  return version.replace(/\.g\d+$/, '');
}

function generationOf(version: string): number {
  const m = /\.g(\d+)$/.exec(version);
  return m ? Number(m[1]) : 0;
}

/** The tracks of every input whose edit came, went or changed: where to put a "!". */
function changedSlots(
  was: ReadonlyMap<string, EditView>,
  now: ReadonlyMap<string, EditView>,
): string[] {
  const key = (e: EditView | undefined) =>
    e ? `${e.count}:${e.zone ?? ''}:${JSON.stringify(e.effect)}` : '';
  const slots = new Set<string>();
  for (const input of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(input);
    const b = now.get(input);
    if (key(a) === key(b)) continue;
    for (const slot of [...(a?.slots ?? []), ...(b?.slots ?? [])]) slots.add(slot);
  }
  return [...slots];
}

function pendingLine(p: PendingEdit, loopBars: number): { text: string; kind: string } {
  const bar = (p.atBar % loopBars) + 1;
  const what = p.description ?? p.effect.id;
  if (p.count === 0)
    return { text: `${p.source} again ▸ undo: ${what} · bar ${bar}`, kind: 'is-undo' };
  const times =
    p.zone !== undefined
      ? ` (zone ${p.zone > 0 ? '+' : ''}${p.zone})`
      : p.count > 1
        ? ` ×${p.count}`
        : '';
  return { text: `${p.source} ▸ ${what}${times} · bar ${bar}`, kind: 'is-pending' };
}
