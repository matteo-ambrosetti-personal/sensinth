import type { HarmonyGenes } from '../genome/genome';
import { lerp, mod } from '../math';
import type { Rng } from '../random';
import type { Palette } from '../styles/schema';
import type { Chord } from '../theory/chords';
import { Scale, byBrightness, type ModeId } from '../theory/scales';

/** How unstable each scale degree's chord sounds: I is home, V and vii pull hardest. */
const DEGREE_TENSION = [0, 0.5, 0.35, 0.45, 0.8, 0.25, 0.95];

/** What harmony reads from the sensors, each 0..1. */
export interface HarmonyInputs {
  tension: number;
  brightness: number;
  texture: number;
  color: number;
}

/**
 * Owns key, mode and chord progression. Every decision is made at a
 * structural boundary (chord change, phrase, section) so harmony moves at the
 * speed of the music, never at the speed of sensor noise. The genome chooses
 * the modes to move between, the chord rate and a bias on the progression.
 */
export class Harmony {
  root: number;
  mode: ModeId;
  scale: Scale;
  chord: Chord;
  next: Chord;
  private modes: ModeId[];
  private bias: readonly number[];
  private colorAtKeyChange: number;

  constructor(
    private palette: Palette,
    private readonly rng: Rng,
    genes: HarmonyGenes,
    inputs: Readonly<HarmonyInputs>,
    root: number,
  ) {
    this.root = mod(Math.round(root), 12);
    this.modes = byBrightness(genes.modes.length > 0 ? genes.modes : palette.modes);
    this.bias = genes.progressionBias;
    this.mode = this.modeFor(inputs.brightness, undefined);
    this.scale = new Scale(this.root, this.mode);
    this.colorAtKeyChange = inputs.color;
    this.chord = { degree: 0, size: this.sizeFor(inputs) };
    this.next = this.chooseNext(this.chord, inputs, false);
  }

  /** New genome: new modes to choose from and a new progression bias. The mode may change now. */
  setGenes(palette: Palette, genes: HarmonyGenes, inputs: Readonly<HarmonyInputs>): void {
    this.palette = palette;
    this.modes = byBrightness(genes.modes.length > 0 ? genes.modes : palette.modes);
    this.bias = genes.progressionBias;
    const mode = this.modeFor(
      inputs.brightness,
      this.modes.includes(this.mode) ? this.mode : undefined,
    );
    if (mode !== this.mode) {
      this.mode = mode;
      this.scale = new Scale(this.root, mode);
    }
  }

  /** Moves to a new key and starts again from its tonic chord. */
  setRoot(root: number, inputs: Readonly<HarmonyInputs>): void {
    this.root = mod(Math.round(root), 12);
    this.scale = new Scale(this.root, this.mode);
    this.colorAtKeyChange = inputs.color;
    this.chord = { degree: 0, size: this.sizeFor(inputs) };
    this.next = this.chooseNext(this.chord, inputs, false);
  }

  /** At phrase starts the mode may follow `brightness` (with hysteresis). */
  onPhraseStart(inputs: Readonly<HarmonyInputs>): void {
    const mode = this.modeFor(inputs.brightness, this.mode);
    if (mode !== this.mode) {
      this.mode = mode;
      this.scale = new Scale(this.root, mode);
    }
  }

  /**
   * At section starts the key may modulate one step around the circle of
   * fifths, but only if `color` has moved far since the last key change.
   */
  onSectionStart(inputs: Readonly<HarmonyInputs>): void {
    const delta = inputs.color - this.colorAtKeyChange;
    if (Math.abs(delta) > 0.3) {
      this.root = mod(this.root + (delta > 0 ? 7 : 5), 12);
      this.scale = new Scale(this.root, this.mode);
      this.colorAtKeyChange = inputs.color;
    }
  }

  /** Moves to the next chord and plans the one after it. */
  advance(inputs: Readonly<HarmonyInputs>, nextStartsPhrase: boolean): void {
    this.chord = { ...this.next, size: this.sizeFor(inputs) };
    this.next = this.chooseNext(this.chord, inputs, nextStartsPhrase);
  }

  private chooseNext(from: Chord, inputs: Readonly<HarmonyInputs>, startsPhrase: boolean): Chord {
    const size = this.sizeFor(inputs);
    // Phrases tend to start at home when tension is low.
    if (startsPhrase && this.rng.chance((1 - inputs.tension) * 0.6)) return { degree: 0, size };
    const row = this.palette.progression[from.degree] ?? { 0: 1 };
    const degrees = Object.keys(row).map(Number);
    const weights = degrees.map((d) => {
      const w = (row[d] ?? 0) * (this.bias[d] ?? 1);
      // Tension above 0.5 favors unstable chords, below 0.5 favors stable ones.
      const bias = 1 + 2.5 * ((DEGREE_TENSION[d] ?? 0.5) - 0.5) * (inputs.tension - 0.5) * 2;
      // Diminished chords are rare spice, used mostly when tension is high.
      const dim = this.isDiminished(d) ? 0.15 + 0.85 * inputs.tension : 1;
      return w * Math.max(0.1, bias) * dim;
    });
    const degree = degrees[this.rng.weightedIndex(weights)] ?? 0;
    return { degree, size };
  }

  private isDiminished(degree: number): boolean {
    const root = this.scale.degreeToMidi(degree);
    return (
      this.scale.degreeToMidi(degree + 2) - root === 3 &&
      this.scale.degreeToMidi(degree + 4) - root === 6
    );
  }

  private sizeFor(inputs: Readonly<HarmonyInputs>): number {
    const [min, max] = this.palette.chordSize;
    return Math.round(lerp(min, max, Math.min(1, inputs.tension * 0.6 + inputs.texture * 0.4)));
  }

  private modeFor(brightness: number, current: ModeId | undefined): ModeId {
    const n = this.modes.length;
    const target = brightness * (n - 1);
    if (current !== undefined) {
      const idx = this.modes.indexOf(current);
      if (idx >= 0 && Math.abs(target - idx) <= 0.75) return current;
    }
    return this.modes[Math.min(n - 1, Math.max(0, Math.round(target)))] as ModeId;
  }
}
