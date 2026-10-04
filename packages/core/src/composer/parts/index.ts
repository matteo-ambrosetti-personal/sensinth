import type { Rng } from '../../random';
import type { PartConfig } from '../../styles/schema';
import type { Part } from '../context';
import { ArpPart } from './arp';
import { BassPart } from './bass';
import { ChordsPart } from './chords';
import { DrumsPart } from './drums';
import { MelodyPart } from './melody';

export function createPart(cfg: PartConfig, rng: Rng): Part {
  switch (cfg.role) {
    case 'drums':
      return new DrumsPart(cfg, rng);
    case 'bass':
      return new BassPart(cfg, rng);
    case 'melody':
      return new MelodyPart(cfg, rng);
    case 'arp':
      return new ArpPart(cfg, rng);
    case 'chords':
      return new ChordsPart(cfg);
  }
}
