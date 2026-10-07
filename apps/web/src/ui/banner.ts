import type { EngineView, PendingEdit } from '@sensinth/core';

/** How long a "landed" message stays up, in milliseconds. */
const LANDED_MS = 2600;

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
  private lastRebuild = -1;
  private shown = '';

  constructor(private readonly el: HTMLElement) {}

  /** Returns what landed on this update, if anything did. */
  update(view: EngineView | undefined, now: number): Landed | undefined {
    let out: Landed | undefined;
    if (!view || view.snapshot.waiting) {
      this.lastVersion = '';
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
          this.lastVersion = song.version;
          if (!first) {
            const what =
              r.reason === 'evolve'
                ? `▸ The song evolved: generation ${song.evolve?.generation ?? 0}`
                : song.version === 'base' || song.version.startsWith('base.')
                  ? '▸ Back to the seed’s song'
                  : `▸ New song ${song.version} · ${song.edits.length} change${song.edits.length === 1 ? '' : 's'}`;
            this.landed = [{ text: what, kind: 'is-landed' }];
            this.landedUntil = now + LANDED_MS;
            out = { slots: [...new Set(song.edits.flatMap((e) => e.slots ?? []))] };
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
      this.el.replaceChildren(
        ...all.slice(-4).map((l) => {
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
