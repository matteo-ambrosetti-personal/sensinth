import {
  ZONES,
  effectLabel,
  type EditView,
  type EngineView,
  type PendingEdit,
  type SensorZones,
} from '@sensinth/core';

/**
 * Deterministic mode's song: where the loop is, its version, what is about
 * to change at the next bar, every change in effect (what it does to this
 * song, how many times), and where each sensor is among its zones.
 */
export class ChangesView {
  private shown = '';
  private shownPending = '';
  private shownZones = '';

  constructor(
    private readonly panel: HTMLElement,
    private readonly loop: HTMLElement,
    private readonly pending: HTMLElement,
    private readonly list: HTMLElement,
    private readonly empty: HTMLElement,
    private readonly zones: HTMLElement,
    /** False while another page (Flow, Lab) is showing. */
    private readonly visible: () => boolean,
  ) {}

  update(view: EngineView | undefined): void {
    const song = view?.song;
    this.panel.hidden = !song || !this.visible();
    if (!song) {
      if (this.shown !== '') {
        this.list.replaceChildren();
        this.pending.replaceChildren();
        this.zones.replaceChildren();
        this.empty.hidden = false;
        this.loop.textContent = '–';
      }
      this.shown = '';
      this.shownPending = '';
      this.shownZones = '';
      return;
    }
    const version = song.version === 'base' ? 'the seed’s own song' : `version ${song.version}`;
    const gen = song.evolve ? ` · generation ${song.evolve.generation}` : '';
    this.loop.textContent = `Bar ${song.loopBar + 1} of ${song.loopBars} · ${version}${gen}`;

    const pendingKey = song.pending.map((p) => `${p.input}:${p.count}:${p.atBar}`).join('|');
    if (pendingKey !== this.shownPending) {
      this.shownPending = pendingKey;
      this.pending.replaceChildren(...song.pending.map((p) => pendingItem(p, song.loopBars)));
    }
    if (song.version !== this.shown) {
      this.shown = song.version;
      this.list.replaceChildren(...song.edits.map(editItem));
    }
    this.empty.hidden = song.edits.length > 0 || song.pending.length > 0;

    const zonesKey = song.sensors.map((z) => `${z.id}:${z.zone}:${z.sensors}`).join('|');
    if (zonesKey !== this.shownZones) {
      this.shownZones = zonesKey;
      this.zones.replaceChildren(...song.sensors.map(zoneItem));
    }
  }
}

function editItem(e: EditView): HTMLElement {
  const li = document.createElement('li');
  li.className = 'change';
  const source = document.createElement('span');
  source.className = 'change-source';
  source.textContent = e.source;
  const what = document.createElement('span');
  what.className = 'change-what';
  what.textContent = effectLabel(e.effect);
  if (e.description && e.description !== effectLabel(e.effect)) {
    const desc = document.createElement('span');
    desc.className = 'change-desc';
    desc.textContent = e.description;
    what.append(desc);
  }
  const count = document.createElement('span');
  count.className = 'change-count';
  count.textContent = e.zone !== undefined ? `zone ${signed(e.zone)}` : `×${e.count}`;
  li.append(source, what, count);
  return li;
}

function pendingItem(p: PendingEdit, loopBars: number): HTMLElement {
  const li = editItem(p);
  li.classList.toggle('is-undo', p.count === 0);
  const count = li.querySelector('.change-count') as HTMLElement;
  count.textContent = `${p.count === 0 ? 'undo' : count.textContent} → bar ${(p.atBar % loopBars) + 1}`;
  return li;
}

function zoneItem(z: SensorZones): HTMLElement {
  const li = document.createElement('li');
  li.className = 'zone-row';
  const name = document.createElement('span');
  name.textContent = z.source;
  const cells = document.createElement('span');
  cells.className = 'zone-cells';
  cells.setAttribute('aria-label', `zone ${z.zone + 1} of ${ZONES}, started in ${z.start + 1}`);
  for (let i = 0; i < ZONES; i++) {
    const cell = document.createElement('i');
    if (i === z.start) cell.classList.add('is-start');
    if (i === z.zone) cell.classList.add('is-now');
    cells.append(cell);
  }
  const what = document.createElement('span');
  what.className = 'zone-what';
  what.textContent =
    z.sensors === 'off'
      ? 'Sensors are off: it changes nothing'
      : `${effectLabel(z.effect)}${z.sensors === 'steps' ? ', a step per zone' : ', by zone'}`;
  li.append(name, cells, what);
  return li;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
