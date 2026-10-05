import { ambient } from './ambient';
import { blues } from './blues';
import { chiptune } from './chiptune';
import { dnb } from './dnb';
import { freeStyle } from './free';
import { hiphop } from './hiphop';
import { jazz } from './jazz';
import { lofi } from './lofi';
import { minimal } from './minimal';
import type { Style } from './schema';
import { synthwave } from './synthwave';
import { techno } from './techno';

/** Every style with its own sound world. */
const STYLED: readonly Style[] = [
  chiptune,
  ambient,
  lofi,
  hiphop,
  jazz,
  blues,
  techno,
  synthwave,
  dnb,
  minimal,
];

/** Free: the sensors choose from every style's instruments. */
export const free: Style = freeStyle(STYLED);

/** Every built-in style, in display order; Free comes first. */
export const STYLES: readonly Style[] = [free, ...STYLED];

export function getStyle(id: string): Style | undefined {
  return STYLES.find((s) => s.id === id);
}

export { ambient, blues, chiptune, dnb, hiphop, jazz, lofi, minimal, synthwave, techno };
export { buildFreePalette, freeStyle } from './free';
