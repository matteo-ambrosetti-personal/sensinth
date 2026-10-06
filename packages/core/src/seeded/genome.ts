import type { Fingerprint } from '../genome/fingerprint';
import { buildGenome, type Genome } from '../genome/genome';
import { defaultMacros } from '../mapping/macros';
import { hashInts } from '../random';
import type { Style } from '../styles/schema';

/**
 * A genome written from the seed alone: the machines and track count come
 * from (seed, style), the patterns, routings and harmony settings from
 * (seed, section). No sensor reading takes part, so the same seed always
 * writes the same song.
 */
export function buildSeededGenome(style: Style, seed: number, section: number): Genome {
  const fp: Fingerprint = {
    channels: [],
    coarseHash: hashInts(seed, 0xc0a5e),
    fineHash: hashInts(seed, 0xf14e),
  };
  return buildGenome(style, fp, seededChain(seed, section), section, defaultMacros());
}

/** The hash a section is written from. */
export function seededChain(seed: number, section: number): number {
  return hashInts(seed, section, 0x5ec7);
}
