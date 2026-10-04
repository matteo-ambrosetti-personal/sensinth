import type { NoteEvent } from '../../clock/events';
import { STEPS_PER_BAR, beatStrength } from '../../clock/grid';
import { clamp, lerp } from '../../math';
import type { Rng } from '../../random';
import { chordDegrees, nearestChordTone } from '../../theory/chords';
import { foldIntoRange } from '../../theory/notes';
import type { MelodyPartConfig } from '../../styles/schema';
import type { ComposerContext, Part } from '../context';

/** One note of a motif: position, length and pitch as a scale-degree offset from the anchor. */
interface MotifNote {
  pos: number;
  dur: number;
  deg: number;
  /** Phrase-final note: resolves to the chord root when tension is low. */
  cadence?: boolean;
}

const MOTIF_BARS = 2;
/** Contour steps in scale degrees and their weights: mostly steps, few leaps. */
const STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
const STEP_WEIGHTS = [1, 6, 6, 3, 3, 1, 1, 0.5, 0.5, 0.3, 0.3];

/**
 * Melody built from a remembered 2-bar motif. A 4-bar phrase is call (motif),
 * answer (varied motif) and cadence. Pitches are stored as scale-degree
 * offsets and realized against the chord that is playing, so a repeated
 * motif follows the harmony. Strong beats and long notes land on chord tones.
 */
export class MelodyPart implements Part {
  readonly id: string;
  private motif: MotifNote[] | undefined;
  private motifEnergy = 0.5;
  private phrase = new Map<number, MotifNote>();
  private anchor = 0;
  private lastMidi: number | undefined;

  constructor(
    private readonly cfg: MelodyPartConfig,
    private readonly rng: Rng,
  ) {
    this.id = cfg.id;
  }

  onBar(ctx: ComposerContext): void {
    if (!ctx.isPhraseStart && this.motif) return;
    const { energy, variation } = ctx.macros;
    const renew =
      !this.motif ||
      Math.abs(energy - this.motifEnergy) > 0.3 ||
      (ctx.isSectionStart && this.rng.chance(0.4 + variation * 0.5)) ||
      this.rng.chance(variation * 0.25);
    this.motif = renew ? this.newMotif(ctx) : this.mutate(this.motif as MotifNote[], variation);
    this.phrase = this.buildPhrase(this.motif, ctx);
    this.anchor = this.anchorFor(ctx);
  }

  onStep(ctx: ComposerContext): NoteEvent[] {
    const pos = ctx.barInPhrase * STEPS_PER_BAR + ctx.stepInBar;
    const note = this.phrase.get(pos);
    if (!note) return [];
    const { macros } = ctx;
    // Follow falling energy within a phrase by dropping weak off-beat notes.
    if (
      !note.cadence &&
      ctx.stepInBar % 2 === 1 &&
      macros.energy < this.motifEnergy - 0.15 &&
      this.rng.chance(0.6)
    ) {
      return [];
    }
    const midi = this.realize(note, ctx);
    this.lastMidi = midi;
    const vel = clamp(0.55 + 0.3 * beatStrength(ctx.stepInBar) + 0.1 * macros.energy);
    const dur = Math.min(note.dur, this.cfg.maxDur);
    return [{ part: this.id, step: ctx.step, durSteps: dur, midi, vel }];
  }

  /** Turns a degree offset into a MIDI note that fits scale, chord and range. */
  private realize(note: MotifNote, ctx: ComposerContext): number {
    const [lo, hi] = this.cfg.range;
    const { scale, chord, stepInBar, macros } = ctx;
    let midi = foldIntoRange(scale.degreeToMidi(this.anchor + note.deg), lo, hi);

    if (note.cadence) {
      const [rootDeg] = chordDegrees(chord) as [number];
      const target =
        macros.tension < 0.5
          ? scale.degreeToMidi(rootDeg)
          : scale.degreeToMidi(rootDeg + (this.rng.chance(0.5) ? 2 : 4));
      midi = nearestPitchClass(target, midi, lo, hi);
    } else if (stepInBar % 4 === 0 || note.dur >= 4) {
      midi = nearestChordTone(scale, chord, midi, lo, hi, this.rng.chance(0.5) ? 'up' : 'down');
    }

    // Avoid awkward jumps larger than a sixth by switching octave.
    if (this.lastMidi !== undefined && Math.abs(midi - this.lastMidi) > 9) {
      const alt = midi + (midi > this.lastMidi ? -12 : 12);
      if (alt >= lo && alt <= hi) midi = alt;
    }
    return midi;
  }

  private newMotif(ctx: ComposerContext): MotifNote[] {
    const { energy, texture } = ctx.macros;
    this.motifEnergy = energy;
    const [dMin, dMax] = this.cfg.density;
    const density = lerp(dMin, dMax, energy);
    const steps = MOTIF_BARS * STEPS_PER_BAR;

    const positions: number[] = [];
    for (let pos = 0; pos < steps; pos++) {
      const strength = beatStrength(pos);
      let p = density * (0.35 + 1.3 * strength);
      if (pos % 2 === 1) p *= this.cfg.syncopation * (0.5 + texture);
      if (pos === 0) p = 0.85;
      if (this.rng.chance(clamp(p))) positions.push(pos);
    }
    if (positions.length < 2) positions.splice(0, positions.length, 0, 8);

    const notes: MotifNote[] = [];
    let deg = this.rng.pick([0, 2, 4]);
    let lastStep = 0;
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i] as number;
      const next = positions[i + 1] ?? steps;
      if (i > 0) {
        let step = STEPS[this.rng.weightedIndex(STEP_WEIGHTS)] as number;
        // After a leap, move back by step in the opposite direction.
        if (Math.abs(lastStep) > 2) step = -Math.sign(lastStep);
        // Keep the line near its anchor.
        if (deg + step > 7 || deg + step < -5) step = -step;
        deg += step;
        lastStep = step;
      }
      notes.push({ pos, dur: Math.min(next - pos, this.cfg.maxDur), deg });
    }
    return notes;
  }

  private mutate(motif: MotifNote[], variation: number): MotifNote[] {
    return motif
      .filter((n) => n.pos === 0 || !this.rng.chance(variation * 0.15))
      .map((n) =>
        this.rng.chance(variation * 0.35) ? { ...n, deg: n.deg + this.rng.pick([-1, 1]) } : n,
      );
  }

  /** Lays the motif out over the phrase: call, answer, …, cadence. */
  private buildPhrase(motif: MotifNote[], ctx: ComposerContext): Map<number, MotifNote> {
    const bars = Math.max(1, ctx.style.phraseBars);
    const phrase = new Map<number, MotifNote>();
    const answerShift = this.rng.pick([-2, -1, 1, 2]);
    for (let bar = 0; bar < bars; bar++) {
      const srcBar = bar % MOTIF_BARS;
      const isAnswer = bar >= MOTIF_BARS && bar < bars - 1;
      const isLast = bar === bars - 1 && bars > 1;
      let src = motif.filter(
        (n) => n.pos >= srcBar * STEPS_PER_BAR && n.pos < (srcBar + 1) * STEPS_PER_BAR,
      );
      if (isLast) src = src.filter((n) => n.pos % STEPS_PER_BAR < 8);
      for (const n of src) {
        const pos = bar * STEPS_PER_BAR + (n.pos % STEPS_PER_BAR);
        phrase.set(pos, { ...n, deg: n.deg + (isAnswer ? answerShift : 0) });
      }
      if (isLast) {
        // Cadence: one long note on the next beat after the remaining material.
        const lastPos = Math.max(-1, ...src.map((n) => n.pos % STEPS_PER_BAR));
        const at = Math.min(12, (Math.floor(lastPos / 4) + 1) * 4);
        for (const n of src) {
          const p = bar * STEPS_PER_BAR + (n.pos % STEPS_PER_BAR);
          const note = phrase.get(p);
          if (note) note.dur = Math.min(note.dur, at - (n.pos % STEPS_PER_BAR));
        }
        phrase.set(bar * STEPS_PER_BAR + at, {
          pos: at,
          dur: STEPS_PER_BAR - at,
          deg: 0,
          cadence: true,
        });
      }
    }
    return phrase;
  }

  /** `register` places the melody's center inside its range. */
  private anchorFor(ctx: ComposerContext): number {
    const [lo, hi] = this.cfg.range;
    const loDeg = ctx.scale.degreeOf(lo) + 3;
    const hiDeg = ctx.scale.degreeOf(hi) - 5;
    return Math.round(lerp(loDeg, Math.max(loDeg, hiDeg), ctx.macros.register));
  }
}

/** The note with `target`'s pitch class closest to `near`, inside [lo, hi]. */
function nearestPitchClass(target: number, near: number, lo: number, hi: number): number {
  let best = foldIntoRange(target, lo, hi);
  for (let m = best - 24; m <= best + 24; m += 12) {
    if (m >= lo && m <= hi && Math.abs(m - near) < Math.abs(best - near)) best = m;
  }
  return best;
}
