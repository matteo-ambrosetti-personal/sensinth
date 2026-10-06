import { KEY_EFFECTS, effectLabel, keyName, type EngineView } from '@sensinth/core';

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

/**
 * Fills the "What each key does" table. Keys that do the same thing to
 * different tracks share a row: A–K rotate tracks 1–8, and so on.
 */
export function renderKeyMap(table: HTMLElement): void {
  const rows = new Map<string, string[]>();
  for (const [code, effect] of Object.entries(KEY_EFFECTS)) {
    const label = effectLabel(effect).replace(/\bT\d+\b/, 'track n');
    rows.set(label, [...(rows.get(label) ?? []), keyName(code)]);
  }
  const body = document.createElement('tbody');
  const row = (keys: string, what: string) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = keys;
    const td = document.createElement('td');
    td.textContent = what;
    tr.append(th, td);
    body.append(tr);
  };
  for (const [label, keys] of rows) {
    if (label.includes('track n')) {
      const first = keys[0] as string;
      const last = keys[keys.length - 1] as string;
      row(`${first}–${last}`, `${label}: ${first} = track 1 … ${last} = track ${keys.length}`);
    } else {
      row(keys.join(' '), label);
    }
  }
  row('Other keys', 'One of the effects above, always the same one');
  table.replaceChildren(body);
}
