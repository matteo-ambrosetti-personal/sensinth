import type { NoteEvent } from '../../clock/events';
import { STEPS_PER_BAR } from '../../clock/grid';
import { lerp } from '../../math';
import { lowestAtOrAbove } from '../../theory/chords';
import { foldIntoRange } from '../../theory/notes';
import type { DronePartConfig } from '../../styles/schema';
import type { ComposerContext, Part } from '../context';

/**
 * Holds the key's tonic (and fifth) for several bars. It restarts when the
 * key or mode changes, so it never drones a note that left the scale.
 */
export class DronePart implements Part {
  readonly id: string;
  private heldRoot: number | undefined;
  private heldMode: string | undefined;

  constructor(private readonly cfg: DronePartConfig) {
    this.id = cfg.id;
  }

  onStep(ctx: ComposerContext): NoteEvent[] {
    if (ctx.stepInBar !== 0) return [];
    const { scale } = ctx;
    const bars = Math.max(1, this.cfg.bars);
    const changed = scale.root !== this.heldRoot || scale.mode !== this.heldMode;
    if (!changed && ctx.bar % bars !== 0) return [];
    this.heldRoot = scale.root;
    this.heldMode = scale.mode;

    const [lo, hi] = this.cfg.range;
    const root = lowestAtOrAbove(scale.root, lo);
    const notes = [root];
    if (this.cfg.fifth) notes.push(foldIntoRange(root + 7, lo, hi));
    // Hold until the next retrigger point.
    const durSteps = (bars - (ctx.bar % bars)) * STEPS_PER_BAR;
    const vel = lerp(0.5, 0.75, ctx.macros.space);
    return notes.map((midi) => ({ part: this.id, step: ctx.step, durSteps, midi, vel }));
  }
}
