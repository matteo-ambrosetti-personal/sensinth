import { SECTION_INFO, type EngineView } from '@sensinth/core';
import { clock } from './pieceDiagram';

/**
 * Where the piece is: its sections so far as a strip (the one playing lit,
 * what is still to come left open), which piece of the playlist it is, how
 * far in, and who chose the section playing.
 */
export class FormStrip {
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly bar: HTMLElement,
    private readonly text: HTMLElement,
  ) {}

  update(view: EngineView | undefined, bpm: number): void {
    const form = view?.form;
    const live = form && !view.snapshot.waiting;
    this.root.hidden = !live;
    if (!form || !live) {
      this.shown = '';
      return;
    }
    const barSeconds = 240 / Math.max(20, bpm);
    const current = form.sections[form.sections.length - 1];
    const total = Math.max(form.totalBars, form.bar + 1);
    const key = `${form.piece}|${form.sections.map((s) => `${s.kind}${s.bars}`).join()}|${total}|${form.ending}`;
    if (key !== this.shown) {
      this.shown = key;
      const cells = form.sections.map((s, i) => {
        const el = document.createElement('span');
        el.className = 'form-cell';
        el.dataset.kind = s.kind;
        el.style.flexGrow = String(s.bars);
        el.textContent = s.label;
        el.title = `${s.label}: ${SECTION_INFO[s.kind].description}${
          s.chosenBy ? `. Chosen by ${s.chosenBy.label} (${s.chosenBy.why}).` : ''
        }`;
        if (i === form.sections.length - 1 && !form.ending) el.classList.add('is-now');
        return el;
      });
      const done = form.sections.reduce((a, s) => Math.max(a, s.startBar + s.bars), 0);
      if (form.ending) {
        const end = document.createElement('span');
        end.className = 'form-cell is-now';
        end.dataset.kind = 'end';
        end.style.flexGrow = '2';
        end.textContent = 'End';
        cells.push(end);
      } else if (total > done) {
        const rest = document.createElement('span');
        rest.className = 'form-cell form-rest';
        rest.style.flexGrow = String(total - done);
        rest.textContent = 'the sensors decide';
        cells.push(rest);
      }
      this.bar.replaceChildren(...cells);
    }
    const by = current?.chosenBy;
    const now = form.ending ? 'Last chord' : (current?.label ?? '');
    this.text.textContent =
      `Piece ${form.piece + 1} · ${now}` +
      (by && !form.ending ? ` — chosen by ${by.label} (${by.why})` : '') +
      ` · ${clock(form.bar * barSeconds)} of about ${clock(total * barSeconds)}`;
  }
}
