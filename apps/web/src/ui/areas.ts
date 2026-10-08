import { AREA_INFO, DOMAIN_INFO, domainOf, type Area, type PartitionView } from '@sensinth/core';

/** A row of coloured chips naming areas, by domain colour. */
export function areaChips(areas: readonly Area[]): HTMLElement {
  const box = document.createElement('span');
  box.className = 'area-chips';
  for (const a of areas) {
    const chip = document.createElement('span');
    chip.className = 'area-chip';
    chip.dataset.domain = domainOf(a);
    chip.textContent = AREA_INFO[a].label;
    chip.title = `${DOMAIN_INFO[domainOf(a)].label}: ${AREA_INFO[a].description}`;
    box.append(chip);
  }
  return box;
}

const LEVEL_NOTE: Record<PartitionView['level'], string> = {
  all: 'One source drives everything. Turn on another and they share it out.',
  domains: 'Each source has its own part of the music.',
  areas: 'Many sources: each one has its own areas.',
  shared: 'More sources than areas: some share.',
};

/**
 * Who drives what: every source that is on, with the areas of the music it
 * controls, and under it which of its sensors does which.
 */
export class AreasView {
  private shown: PartitionView | undefined;

  constructor(
    private readonly list: HTMLElement,
    private readonly note: HTMLElement,
    private readonly sourceName: (group: string) => string,
  ) {}

  update(p: PartitionView): void {
    if (p === this.shown) return;
    this.shown = p;
    if (p.groups.length === 0) {
      this.list.replaceChildren();
      this.note.textContent = 'Turn on a sensor source: it will drive everything on its own.';
      return;
    }
    this.note.textContent = LEVEL_NOTE[p.level];
    this.list.replaceChildren(
      ...p.groups.map((g) => {
        const li = document.createElement('li');
        li.className = 'area-group';
        li.dataset.group = g.group;
        const name = document.createElement('span');
        name.className = 'area-source';
        name.textContent = this.sourceName(g.group);
        li.append(name, areaChips(g.areas));
        if (g.channels.length > 1) {
          const ul = document.createElement('ul');
          ul.className = 'area-channels';
          for (const ch of g.channels) {
            const item = document.createElement('li');
            item.textContent = `${ch.label}: ${ch.areas.map((a) => AREA_INFO[a].label).join(', ')}`;
            ul.append(item);
          }
          li.append(ul);
        }
        return li;
      }),
    );
  }
}
