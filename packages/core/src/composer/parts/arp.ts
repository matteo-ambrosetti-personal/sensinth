import type { NoteEvent } from '../../clock/events';
import { lerp } from '../../math';
import type { Rng } from '../../random';
import { chordPitchClasses } from '../../theory/chords';
import type { ArpPartConfig } from '../../styles/schema';
import type { ComposerContext, Part } from '../context';
import { LevelSelector } from '../patterns';

type Direction = 'up' | 'down' | 'updown';

export class ArpPart implements Part {
  readonly id: string;
  private readonly rate: LevelSelector;
  private stepsPerNote = 2;
  private notes: number[] = [];
  private index = 0;
  private direction: Direction = 'up';

  constructor(
    private readonly cfg: ArpPartConfig,
    private readonly rng: Rng,
  ) {
    this.id = cfg.id;
    this.rate = new LevelSelector(cfg.rates.length);
  }

  onBar(ctx: ComposerContext): void {
    this.stepsPerNote = this.cfg.rates[this.rate.select(ctx.macros.energy)] ?? 2;
    if (ctx.isPhraseStart && this.rng.chance(0.3 + ctx.macros.variation * 0.5)) {
      this.direction = this.rng.pick<Direction>(['up', 'down', 'updown']);
    }
  }

  onStep(ctx: ComposerContext): NoteEvent[] {
    if (ctx.chordChanged || this.notes.length === 0) {
      this.notes = this.buildNotes(ctx);
      this.index = 0;
    }
    if (ctx.stepInBar % this.stepsPerNote !== 0 || this.notes.length === 0) return [];
    const midi = this.notes[this.index % this.notes.length] as number;
    this.index++;
    const vel = lerp(0.45, 0.7, ctx.macros.energy) + (ctx.stepInBar % 4 === 0 ? 0.15 : 0);
    return [
      {
        part: this.id,
        step: ctx.step,
        durSteps: this.stepsPerNote * 0.9,
        midi,
        vel: Math.min(1, vel),
      },
    ];
  }

  private buildNotes(ctx: ComposerContext): number[] {
    const [lo, hi] = this.cfg.range;
    const span = Math.min(this.cfg.span, hi - lo);
    const start = Math.round(lo + ctx.macros.register * (hi - lo - span));
    const pcs = chordPitchClasses(ctx.scale, ctx.chord);
    const up: number[] = [];
    for (let m = start; m <= start + span; m++) if (pcs.includes(((m % 12) + 12) % 12)) up.push(m);
    if (this.direction === 'down') return up.reverse();
    if (this.direction === 'updown' && up.length > 2) return [...up, ...up.slice(1, -1).reverse()];
    return up;
  }
}
