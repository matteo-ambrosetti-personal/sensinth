import { tapeExtension, type PieceRecord, type PieceShelf } from '../pieces';
import { clock, pieceDiagram } from './pieceDiagram';

function stamp(id: number): string {
  const d = new Date(id);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function fileName(p: PieceRecord): string {
  return `sensinth-${stamp(p.id)}-${p.styleId}`;
}

/** Saves a blob as a file: the system's share sheet where there is one for files, else a download. */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * The last pieces played, newest first: each with its recording to play or
 * download, and the diagram of what every sensor did in it.
 */
export class PiecesView {
  private urls: string[] = [];
  private opened = new Set<number>();

  constructor(
    private readonly list: HTMLElement,
    private readonly empty: HTMLElement,
    private readonly shelf: PieceShelf,
  ) {
    shelf.onChange = () => void this.render();
    void this.render();
  }

  async render(): Promise<void> {
    const pieces = await this.shelf.list();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    this.empty.hidden = pieces.length > 0;
    this.list.replaceChildren(
      ...pieces.map((p, i) => {
        const li = document.createElement('li');
        li.className = 'piece';
        li.dataset.piece = String(p.id);
        const title = document.createElement('h3');
        title.className = 'piece-title';
        title.textContent = `Piece ${p.number} · ${p.styleName}`;
        const meta = document.createElement('p');
        meta.className = 'piece-meta';
        const when = new Date(p.id).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        const form = p.log.sections.map((s) => s.label).join(' → ');
        meta.textContent =
          `${p.key} · ${p.bpm} BPM · ${clock(p.seconds)}${p.complete ? '' : ' · stopped before the end'} · ${when}` +
          (form ? ` · ${form}` : '');
        const svg = pieceDiagram(p);
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        this.urls.push(svgUrl);

        const actions = document.createElement('div');
        actions.className = 'piece-actions';
        if (p.audio) {
          const audioUrl = URL.createObjectURL(p.audio);
          this.urls.push(audioUrl);
          const audio = document.createElement('audio');
          audio.controls = true;
          audio.preload = 'metadata';
          audio.src = audioUrl;
          const save = document.createElement('button');
          save.type = 'button';
          save.className = 'pill-btn';
          save.textContent = 'Download the music';
          const blob = p.audio;
          save.addEventListener('click', () =>
            saveBlob(`${fileName(p)}.${tapeExtension(blob)}`, blob),
          );
          actions.append(audio, save);
        } else {
          const none = document.createElement('span');
          none.className = 'piece-none';
          none.textContent = 'This browser could not record it; the diagram is kept.';
          actions.append(none);
        }
        const saveSvg = document.createElement('button');
        saveSvg.type = 'button';
        saveSvg.className = 'pill-btn';
        saveSvg.textContent = 'Download the diagram';
        saveSvg.addEventListener('click', () => saveBlob(`${fileName(p)}-sensors.svg`, svgBlob));
        actions.append(saveSvg);

        const details = document.createElement('details');
        details.className = 'piece-diagram';
        // The newest opens by itself; the others stay as you left them.
        details.open = this.opened.has(p.id) || (i === 0 && this.opened.size === 0);
        details.addEventListener('toggle', () => {
          if (details.open) this.opened.add(p.id);
          else this.opened.delete(p.id);
        });
        const summary = document.createElement('summary');
        summary.textContent = 'What each sensor did';
        const img = document.createElement('img');
        img.src = svgUrl;
        img.alt = `Piece ${p.number}: the sections along the top, then one row per sensor showing how much it moved the music in each bar`;
        img.loading = 'lazy';
        details.append(summary, img);
        li.append(title, meta, actions, details);
        return li;
      }),
    );
  }
}
