import { mix, type Gfx } from '../gfx';
import type { Look } from '../kit';
import type { ActorState } from '../stage';

/**
 * A sky that ages with the music: the first palette at the start, the last
 * once the music has drifted all the way. Each palette is bands top to
 * bottom; palettes must have the same number of bands.
 */
export function agingSky(
  g: Gfx,
  drift: number,
  palettes: readonly (readonly string[])[],
  y = 0,
  h = g.h,
): void {
  const k = Math.max(0, Math.min(1, drift * 1.6)) * (palettes.length - 1);
  const i = Math.min(palettes.length - 2, Math.floor(k));
  const a = palettes[i] as readonly string[];
  const b = palettes[i + 1] as readonly string[];
  g.bands(
    y,
    h,
    a.map((c, j) => mix(c, b[j] ?? c, k - i)),
  );
}

/** A figure's look, greyed out while nobody plays its part. */
export function dim(look: Look, a: ActorState, playing: boolean): Look {
  if (a.on || !playing) return look;
  const grey = (c: string) => mix(c, '#30324a', 0.65);
  return {
    ...look,
    skin: grey(look.skin),
    hair: grey(look.hair),
    shirt: grey(look.shirt),
    pants: grey(look.pants),
    ...(look.hatColor ? { hatColor: grey(look.hatColor) } : {}),
  };
}

/** A colour greyed out while nobody plays its part. */
export function tint(color: string, a: ActorState, playing: boolean): string {
  return a.on || !playing ? color : mix(color, '#30324a', 0.65);
}

/** Eyes closed for a figure with nothing to play. */
export function asleep(a: ActorState, playing: boolean): boolean {
  return playing && (!a.on || a.muted);
}

/** A gentle idle sway, so nobody stands frozen. */
export function sway(t: number, phase = 0, amount = 1): number {
  return Math.round(Math.sin(t * 2 + phase) * amount);
}

/** Hands that alternate on each hit, for drummers. */
export function alternate(a: ActorState): 1 | -1 {
  return a.count % 2 === 0 ? 1 : -1;
}

export const SKIN = ['#f0c090', '#d89a68', '#a86a40', '#7a4a2a', '#f8d8b0'] as const;
