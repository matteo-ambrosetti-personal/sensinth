import type { Macros } from '../mapping/macros';
import { lerp, mod } from '../math';
import type { Rng } from '../random';
import type { Chord } from '../theory/chords';
import { Scale, byBrightness, type ModeId } from '../theory/scales';
import type { Style } from '../styles/schema';

/** How unstable each scale degree's chord sounds: I is home, V and vii pull hardest. */
const DEGREE_TENSION = [0, 0.5, 0.35, 0.45, 0.8, 0.25, 0.95];

/**
 * Owns key, mode and chord progression. Every decision is made at a
 * structural boundary (chord change, phrase, section) so harmony moves at the
 * speed of the music, never at the speed of sensor noise.
 */
export class Harmony {
  root: number;
  mode: ModeId;
  scale: Scale;
  chord: Chord;
  next: Chord;
  private modes: ModeId[];
  private colorAtKeyChange: number;

  constructor(
    private style: Style,
    private readonly rng: Rng,
    macros: Readonly<Macros>,
    root?: number,
  ) {
    this.root = root ?? rng.int(0, 11);
    this.modes = byBrightness(style.modes);
    this.mode = this.modeFor(macros.brightness, undefined);
    this.scale = new Scale(this.root, this.mode);
    this.colorAtKeyChange = macros.color;
    this.chord = { degree: 0, size: this.sizeFor(macros) };
    this.next = this.chooseNext(this.chord, macros, false);
  }

  setStyle(style: Style, macros: Readonly<Macros>): void {
    this.style = style;
    this.modes = byBrightness(style.modes);
    this.mode = this.modeFor(macros.brightness, undefined);
    this.scale = new Scale(this.root, this.mode);
    this.chord = { degree: 0, size: this.sizeFor(macros) };
    this.next = this.chooseNext(this.chord, macros, false);
  }

  /** At phrase starts the mode may follow `brightness` (with hysteresis). */
  onPhraseStart(macros: Readonly<Macros>): void {
    const mode = this.modeFor(macros.brightness, this.mode);
    if (mode !== this.mode) {
      this.mode = mode;
      this.scale = new Scale(this.root, mode);
    }
  }

  /**
   * At section starts the key may modulate one step around the circle of
   * fifths, but only if `color` has moved far since the last key change.
   */
  onSectionStart(macros: Readonly<Macros>): void {
    const delta = macros.color - this.colorAtKeyChange;
    if (Math.abs(delta) > 0.3) {
      this.root = mod(this.root + (delta > 0 ? 7 : 5), 12);
      this.scale = new Scale(this.root, this.mode);
      this.colorAtKeyChange = macros.color;
    }
  }

  /** Moves to the next chord and plans the one after it. */
  advance(macros: Readonly<Macros>, nextStartsPhrase: boolean): void {
    this.chord = { ...this.next, size: this.sizeFor(macros) };
    this.next = this.chooseNext(this.chord, macros, nextStartsPhrase);
  }

  private chooseNext(from: Chord, macros: Readonly<Macros>, startsPhrase: boolean): Chord {
    const size = this.sizeFor(macros);
    // Phrases tend to start at home when tension is low.
    if (startsPhrase && this.rng.chance((1 - macros.tension) * 0.6)) return { degree: 0, size };
    const row = this.style.progression[from.degree] ?? { 0: 1 };
    const degrees = Object.keys(row).map(Number);
    const weights = degrees.map((d) => {
      const w = row[d] ?? 0;
      // Tension above 0.5 favors unstable chords, below 0.5 favors stable ones.
      const bias = 1 + 2.5 * ((DEGREE_TENSION[d] ?? 0.5) - 0.5) * (macros.tension - 0.5) * 2;
      // Diminished chords are rare spice, used mostly when tension is high.
      const dim = this.isDiminished(d) ? 0.15 + 0.85 * macros.tension : 1;
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

  private sizeFor(macros: Readonly<Macros>): number {
    const [min, max] = this.style.chordSize;
    return Math.round(lerp(min, max, Math.min(1, macros.tension * 0.6 + macros.texture * 0.4)));
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
