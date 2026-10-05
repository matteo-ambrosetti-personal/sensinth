import type { HarmonyGenes } from '../genome/genome';
import { lerp, mod } from '../math';
import { Rng } from '../random';
import type { ChordDef, ChordForm, Palette } from '../styles/schema';
import { chordSymbol, type Chord } from '../theory/chords';
import { pitchClassName } from '../theory/notes';
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
 * speed of the music, never at the speed of sensor noise.
 *
 * Two kinds of palettes:
 * - **diatonic**: chords are stacked on degrees of one key and mode; the
 *   genome chooses the modes to move between and biases the progression;
 * - **chord scales** (blues, jazz): every chord is the tonic chord of its own
 *   local scale (I7 over mixolydian, ii∅ over locrian, …) and follows a form
 *   such as a 12-bar blues. While a chord plays, `scale` is its local scale,
 *   so every note still belongs to the scale in effect.
 */
export class Harmony {
  /** The key's root pitch class. */
  root: number;
  mode: ModeId;
  scale: Scale;
  chord: Chord;
  next: Chord;
  private modes: ModeId[];
  private bias: readonly number[];
  private colorAtKeyChange: number;
  private forms: ChordForm[] = [];
  private form: ChordForm | undefined;
  private formIndex = 0;
  private local: ChordDef | undefined;
  private nextLocal: ChordDef | undefined;

  constructor(
    private palette: Palette,
    private rng: Rng,
    genes: HarmonyGenes,
    inputs: Readonly<HarmonyInputs>,
    root: number,
  ) {
    this.root = mod(Math.round(root), 12);
    this.modes = byBrightness(genes.modes.length > 0 ? genes.modes : palette.modes);
    this.bias = genes.progressionBias;
    this.colorAtKeyChange = inputs.color;
    this.mode = this.modeFor(inputs.brightness, undefined);
    this.scale = new Scale(this.root, this.mode);
    this.chord = { degree: 0, size: this.sizeFor(inputs) };
    this.next = this.chord;
    if (palette.chordScales) {
      this.forms = this.formsFor(genes);
      this.startForm(inputs);
    } else {
      this.next = this.chooseNext(this.chord, inputs, false);
    }
  }

  /** The key, e.g. "C Dorian" or "C blues". */
  get keyName(): string {
    const cs = this.palette.chordScales;
    return cs ? `${pitchClassName(this.root)} ${cs.keyLabel}` : this.scale.name;
  }

  /** Roman numeral and chord name, e.g. `{ roman: 'IV7', name: 'F7' }`. */
  get chordLabel(): { roman: string; name: string } {
    const sym = chordSymbol(this.scale, this.chord);
    return this.local ? { roman: this.local.id, name: sym.name } : sym;
  }

  /** Pitch class of the next chord's root. */
  get nextRoot(): number {
    if (this.nextLocal) return mod(this.root + this.nextLocal.root, 12);
    return mod(this.scale.degreeToMidi(this.next.degree), 12);
  }

  /** True when the next chord differs from the one playing. */
  get chordMoves(): boolean {
    if (this.local && this.nextLocal) return this.local.id !== this.nextLocal.id;
    return this.next.degree !== this.chord.degree;
  }

  /**
   * Starts a fresh random stream. Deterministic mode reseeds before every
   * chord, so a choice that drew more or fewer numbers (a substitution taken
   * or not) never shifts the chords after it.
   */
  reseed(seed: number): void {
    this.rng = new Rng(seed);
  }

  /** New genome: new modes or forms to choose from and a new progression bias. */
  setGenes(palette: Palette, genes: HarmonyGenes, inputs: Readonly<HarmonyInputs>): void {
    const wasChordScales = !!this.palette.chordScales;
    this.palette = palette;
    this.modes = byBrightness(genes.modes.length > 0 ? genes.modes : palette.modes);
    this.bias = genes.progressionBias;
    if (palette.chordScales) {
      this.forms = this.formsFor(genes);
      if (!wasChordScales || !this.form || !this.forms.includes(this.form)) this.startForm(inputs);
      return;
    }
    this.forms = [];
    this.form = undefined;
    this.local = undefined;
    this.nextLocal = undefined;
    const mode = this.modeFor(
      inputs.brightness,
      this.modes.includes(this.mode) ? this.mode : undefined,
    );
    if (mode !== this.mode || wasChordScales) {
      this.mode = mode;
      this.scale = new Scale(this.root, mode);
      if (wasChordScales) {
        this.chord = { degree: 0, size: this.sizeFor(inputs) };
        this.next = this.chooseNext(this.chord, inputs, false);
      }
    }
  }

  /** Moves to a new key and starts again from its tonic chord (or the top of the form). */
  setRoot(root: number, inputs: Readonly<HarmonyInputs>): void {
    this.root = mod(Math.round(root), 12);
    this.colorAtKeyChange = inputs.color;
    if (this.palette.chordScales) {
      this.startForm(inputs);
      return;
    }
    this.scale = new Scale(this.root, this.mode);
    this.chord = { degree: 0, size: this.sizeFor(inputs) };
    this.next = this.chooseNext(this.chord, inputs, false);
  }

  /** At phrase starts the mode may follow `brightness` (with hysteresis). Forms keep going. */
  onPhraseStart(inputs: Readonly<HarmonyInputs>): void {
    if (this.palette.chordScales) return;
    const mode = this.modeFor(inputs.brightness, this.mode);
    if (mode !== this.mode) {
      this.mode = mode;
      this.scale = new Scale(this.root, mode);
    }
  }

  /**
   * At section starts the key may modulate one step around the circle of
   * fifths, but only if `color` has moved far since the last key change. A
   * form starts again from its first chord, picked anew by `brightness`.
   */
  onSectionStart(inputs: Readonly<HarmonyInputs>): void {
    const delta = inputs.color - this.colorAtKeyChange;
    if (Math.abs(delta) > 0.3) {
      this.root = mod(this.root + (delta > 0 ? 7 : 5), 12);
      this.colorAtKeyChange = inputs.color;
      if (!this.palette.chordScales) this.scale = new Scale(this.root, this.mode);
    }
    if (this.palette.chordScales) {
      this.form = this.formFor(inputs.brightness);
      // The next `advance` lands on the form's first chord.
      this.formIndex = -1;
      this.nextLocal = this.chordAt(0, inputs);
    }
  }

  /** Moves to the next chord and plans the one after it. */
  advance(inputs: Readonly<HarmonyInputs>, nextStartsPhrase: boolean): void {
    if (this.form) {
      const length = this.form.sequence.length;
      this.formIndex = (this.formIndex + 1) % length;
      this.local = this.nextLocal ?? this.chordAt(this.formIndex, inputs);
      this.nextLocal = this.chordAt((this.formIndex + 1) % length, inputs);
      this.applyLocal(inputs);
      return;
    }
    this.chord = { ...this.next, size: this.sizeFor(inputs) };
    this.next = this.chooseNext(this.chord, inputs, nextStartsPhrase);
  }

  private formsFor(genes: HarmonyGenes): ChordForm[] {
    const all = this.palette.chordScales?.forms ?? [];
    const chosen = all.filter((f) => genes.forms.includes(f.id));
    return [...(chosen.length > 0 ? chosen : all)].sort((a, b) => a.brightness - b.brightness);
  }

  private formFor(brightness: number): ChordForm | undefined {
    let best = this.forms[0];
    for (const f of this.forms) {
      if (Math.abs(f.brightness - brightness) < Math.abs((best?.brightness ?? 0) - brightness)) {
        best = f;
      }
    }
    return best;
  }

  private startForm(inputs: Readonly<HarmonyInputs>): void {
    this.form = this.formFor(inputs.brightness);
    this.formIndex = 0;
    this.local = this.chordAt(0, inputs);
    this.nextLocal = this.chordAt(1 % Math.max(1, this.form?.sequence.length ?? 1), inputs);
    this.applyLocal(inputs);
  }

  /** The chord at a position of the form, sometimes swapped for a substitute when tension is high. */
  private chordAt(index: number, inputs: Readonly<HarmonyInputs>): ChordDef | undefined {
    const cs = this.palette.chordScales;
    const id = this.form?.sequence[index];
    if (!cs || id === undefined) return undefined;
    const subs = cs.substitutions?.[id];
    const pick =
      subs && subs.length > 0 && this.rng.chance(inputs.tension * 0.5) ? this.rng.pick(subs) : id;
    return cs.chords.find((c) => c.id === pick) ?? cs.chords.find((c) => c.id === id);
  }

  private applyLocal(inputs: Readonly<HarmonyInputs>): void {
    const local = this.local;
    if (!local) return;
    this.mode = local.mode;
    this.scale = new Scale(mod(this.root + local.root, 12), local.mode);
    this.chord = { degree: 0, size: this.sizeFor(inputs) };
    this.next = { degree: 0, size: this.chord.size };
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
