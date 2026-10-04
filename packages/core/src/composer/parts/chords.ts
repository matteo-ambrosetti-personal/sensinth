import type { NoteEvent } from '../../clock/events';
import { STEPS_PER_BAR } from '../../clock/grid';
import { lerp } from '../../math';
import { chordPitchClasses } from '../../theory/chords';
import { voiceChord } from '../../theory/voicing';
import type { ChordsPartConfig } from '../../styles/schema';
import type { ComposerContext, Part } from '../context';
import { LevelSelector, parsePattern, type PatternHit } from '../patterns';

export class ChordsPart implements Part {
  readonly id: string;
  private readonly patterns: (PatternHit | undefined)[][];
  private readonly level: LevelSelector;
  private currentLevel = 0;
  private voicing: number[] = [];

  constructor(private readonly cfg: ChordsPartConfig) {
    this.id = cfg.id;
    this.patterns = cfg.patterns.map(parsePattern);
    this.level = new LevelSelector(cfg.patterns.length);
  }

  onBar(ctx: ComposerContext): void {
    this.currentLevel = this.level.select(ctx.macros.energy);
  }

  onStep(ctx: ComposerContext): NoteEvent[] {
    if (ctx.chordChanged || this.voicing.length === 0) {
      const [lo, hi] = this.cfg.range;
      this.voicing = voiceChord(chordPitchClasses(ctx.scale, ctx.chord), lo, hi, this.voicing);
    }
    const pattern = this.patterns[this.currentLevel] ?? [];
    if (pattern.length === 0) return [];
    const hit = pattern[(ctx.bar * STEPS_PER_BAR + ctx.stepInBar) % pattern.length];
    if (!hit) return [];
    const dur = Math.min(hit.dur, ctx.stepsUntilChordChange);
    const vel = lerp(0.4, 0.7, ctx.macros.energy);
    return this.voicing.map((midi) => ({
      part: this.id,
      step: ctx.step,
      durSteps: dur,
      midi,
      vel,
    }));
  }
}
