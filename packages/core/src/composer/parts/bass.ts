import type { NoteEvent } from '../../clock/events';
import { STEPS_PER_BAR } from '../../clock/grid';
import { lerp } from '../../math';
import type { Rng } from '../../random';
import { chordDegrees, lowestAtOrAbove } from '../../theory/chords';
import { foldIntoRange } from '../../theory/notes';
import type { BassPartConfig } from '../../styles/schema';
import type { ComposerContext, Part } from '../context';
import { LevelSelector, parsePattern, type PatternHit } from '../patterns';

export class BassPart implements Part {
  readonly id: string;
  private readonly patterns: (PatternHit | undefined)[][];
  private readonly level: LevelSelector;
  private currentLevel = 0;

  constructor(
    private readonly cfg: BassPartConfig,
    private readonly rng: Rng,
  ) {
    this.id = cfg.id;
    this.patterns = cfg.patterns.map(parsePattern);
    this.level = new LevelSelector(cfg.patterns.length);
  }

  onBar(ctx: ComposerContext): void {
    this.currentLevel = this.level.select(ctx.macros.energy);
  }

  onStep(ctx: ComposerContext): NoteEvent[] {
    const pattern = this.patterns[this.currentLevel] ?? [];
    if (pattern.length === 0) return [];
    const hit = pattern[(ctx.bar * STEPS_PER_BAR + ctx.stepInBar) % pattern.length];
    if (!hit) return [];

    const [lo, hi] = this.cfg.range;
    const { scale, chord, nextChord, macros } = ctx;
    const [rootDeg, , fifthDeg] = chordDegrees(chord) as [number, number, number];
    const root = lowestAtOrAbove(scale.degreeToMidi(rootDeg), lo);
    const fifth = foldIntoRange(scale.degreeToMidi(fifthDeg), root, hi);
    const third = foldIntoRange(scale.degreeToMidi(rootDeg + 2), root, hi);
    const octave = root + 12 <= hi ? root + 12 : root;

    let char = hit.char;
    const nearChange = ctx.stepsUntilChordChange <= hit.dur + 1;
    const chordMoves = nextChord.degree !== chord.degree;
    if (char !== 'a' && nearChange && chordMoves && ctx.stepInBar % 4 !== 0) {
      if (this.rng.chance(macros.variation * 0.5)) char = 'a';
    }

    let midi: number;
    switch (char) {
      case '5':
        midi = fifth;
        break;
      case '3':
        midi = third;
        break;
      case '8':
        midi = octave;
        break;
      case 'x':
        midi = [root, fifth, octave][this.rng.weightedIndex([0.5, 0.3, 0.2])] as number;
        break;
      case 'a': {
        if (!chordMoves) {
          midi = fifth;
          break;
        }
        // One scale step below (or above) the next chord's root.
        const nextRoot = lowestAtOrAbove(scale.degreeToMidi(nextChord.degree), lo);
        const fromBelow = scale.degreeToMidi(scale.degreeOf(nextRoot) - 1);
        const fromAbove = scale.degreeToMidi(scale.degreeOf(nextRoot) + 1);
        midi = fromBelow >= lo ? fromBelow : fromAbove;
        break;
      }
      default:
        midi = root;
    }
    midi = foldIntoRange(midi, lo, hi);
    const dur = Math.min(hit.dur, ctx.stepsUntilChordChange);
    const accent = ctx.stepInBar % 4 === 0 ? 0.15 : 0;
    const vel = Math.min(1, lerp(0.55, 0.85, macros.energy) + accent);
    return [{ part: this.id, step: ctx.step, durSteps: dur, midi, vel }];
  }
}
