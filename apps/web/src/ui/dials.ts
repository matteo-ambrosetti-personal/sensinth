import {
  MACRO_AREA,
  MACRO_INFO,
  MACROS,
  domainOf,
  type MacroId,
  type Macros,
  type Router,
} from '@sensinth/core';

const LABELS: Record<MacroId, string> = {
  energy: 'Energy',
  tension: 'Tension',
  brightness: 'Brightness',
  space: 'Space',
  variation: 'Variation',
  texture: 'Texture',
  register: 'Register',
  color: 'Color',
};

/** One meter per macro, coloured by the area it belongs to, with the sensors driving it. */
export class DialsView {
  private readonly rows = new Map<
    MacroId,
    { bar: HTMLElement; value: HTMLElement; src: HTMLElement }
  >();

  constructor(list: HTMLElement) {
    for (const id of MACROS) {
      const li = document.createElement('li');
      li.className = 'dial';
      li.dataset.domain = domainOf(MACRO_AREA[id]);
      li.title = MACRO_INFO[id].description;
      li.innerHTML = `
        <span class="dial-name">${LABELS[id]}</span>
        <div class="meter" role="meter" aria-label="${LABELS[id]}" aria-valuemin="0" aria-valuemax="100"><span></span></div>
        <span class="dial-value">–</span>
        <span class="dial-src">${MACRO_INFO[id].description}</span>`;
      list.append(li);
      this.rows.set(id, {
        bar: li.querySelector('.meter > span') as HTMLElement,
        value: li.querySelector('.dial-value') as HTMLElement,
        src: li.querySelector('.dial-src') as HTMLElement,
      });
    }
  }

  update(macros: Readonly<Macros>): void {
    for (const [id, row] of this.rows) {
      const v = macros[id];
      row.bar.style.transform = `scaleX(${v.toFixed(3)})`;
      row.bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      row.value.textContent = String(Math.round(v * 100));
    }
  }

  /** Shows which sensors feed each dial. */
  updateSources(router: Router, labelOf: (channelId: string) => string): void {
    const { macros } = router.getRoutes();
    for (const [id, row] of this.rows) {
      const names = macros.filter((r) => r.macro === id).map((r) => labelOf(r.channelId));
      row.src.textContent = names.length
        ? `from ${[...new Set(names)].join(', ')}`
        : `no sensor: resting at ${Math.round(MACRO_INFO[id].fallback * 100)}`;
    }
  }
}
