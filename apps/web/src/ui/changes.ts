import { effectLabel, type EngineView } from '@sensinth/core';

/**
 * Deterministic mode's song: where the loop is, its version, and every
 * change your inputs made, each with what it does and how many times.
 */
export class ChangesView {
  private shown = '';

  constructor(
    private readonly panel: HTMLElement,
    private readonly loop: HTMLElement,
    private readonly list: HTMLElement,
    private readonly empty: HTMLElement,
  ) {}

  update(view: EngineView | undefined): void {
    const song = view?.song;
    this.panel.hidden = !song;
    if (!song) {
      if (this.shown !== '') {
        this.list.replaceChildren();
        this.empty.hidden = false;
        this.loop.textContent = '–';
      }
      this.shown = '';
      return;
    }
    const version = song.version === 'base' ? 'the seed’s own song' : `version ${song.version}`;
    this.loop.textContent = `Bar ${song.loopBar + 1} of ${song.loopBars} · ${version}`;
    if (song.version === this.shown) return;
    this.shown = song.version;
    this.list.replaceChildren(
      ...song.edits.map((e) => {
        const li = document.createElement('li');
        li.className = 'change';
        const source = document.createElement('span');
        source.className = 'change-source';
        source.textContent = e.source;
        const what = document.createElement('span');
        what.textContent = effectLabel(e.effect);
        const count = document.createElement('span');
        count.className = 'change-count';
        count.textContent = e.zone !== undefined ? `zone ${signed(e.zone)}` : `×${e.count}`;
        li.append(source, what, count);
        return li;
      }),
    );
    this.empty.hidden = song.edits.length > 0;
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
