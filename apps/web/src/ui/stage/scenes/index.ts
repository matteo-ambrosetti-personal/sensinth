import type { Scene } from '../stage';
import { ambient } from './ambient';
import { blues } from './blues';
import { chiptune } from './chiptune';
import { dnb } from './dnb';
import { free } from './free';
import { hiphop } from './hiphop';
import { jazz } from './jazz';
import { lofi } from './lofi';
import { minimal } from './minimal';
import { synthwave } from './synthwave';
import { techno } from './techno';

/** One scene per style, by style id. */
export const SCENES: Record<string, Scene> = {
  free,
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
};
