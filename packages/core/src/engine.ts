import type { NoteEvent } from './clock/events';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from './clock/grid';
import type { ComposerContext, Part } from './composer/context';
import { Harmony } from './composer/harmony';
import { createPart } from './composer/parts';
import type { Macros } from './mapping/macros';
import { Router } from './mapping/router';
import { DEFAULT_MAPPING, mergeRules } from './mapping/rules';
import { Rng } from './random';
import { SensorHub } from './sensors/hub';
import type { Style } from './styles/schema';
import { chordSymbol, type Chord } from './theory/chords';
import type { ModeId, Scale } from './theory/scales';

export interface EngineOptions {
  style: Style;
  /** Same seed + same sensor data = same music. */
  seed?: number;
  /** Shared sensor hub; a new one is created if omitted. */
  hub?: SensorHub;
  /** Force the initial key (pitch class 0..11), e.g. from a location hash. */
  keyRoot?: number;
}

export interface EngineSnapshot {
  step: number;
  bar: number;
  beat: number;
  styleId: string;
  keyName: string;
  mode: ModeId;
  chord: Chord;
  chordRoman: string;
  chordName: string;
  macros: Readonly<Macros>;
}

/**
 * The music brain. Call `tick` once per 16th-note step, in order; it reads
 * the sensor-driven macros and returns the notes that start on that step.
 * Pure TypeScript with no timers or audio: the caller owns the clock.
 */
export class Engine {
  readonly hub: SensorHub;
  readonly router: Router;
  private style: Style;
  private pendingStyle: Style | undefined;
  private readonly rng: Rng;
  private harmony: Harmony;
  private parts: Part[];
  private step = 0;
  private chordChangedAt = 0;

  constructor(opts: EngineOptions) {
    this.style = opts.style;
    this.rng = new Rng(opts.seed ?? 1);
    this.hub = opts.hub ?? new SensorHub();
    this.router = new Router(this.hub, mergeRules(DEFAULT_MAPPING, opts.style.mapping));
    this.router.setRanges(opts.style.macroRanges);
    this.harmony = new Harmony(
      this.style,
      this.rng.fork('harmony'),
      this.router.macros,
      opts.keyRoot,
    );
    this.parts = this.buildParts();
  }

  get currentStyle(): Style {
    return this.style;
  }

  /** Scale in effect for the most recent step. */
  get scale(): Scale {
    return this.harmony.scale;
  }

  /** Chord in effect for the most recent step. */
  get chord(): Chord {
    return this.harmony.chord;
  }

  /** Switches style at the next bar line. */
  setStyle(style: Style): void {
    this.pendingStyle = style;
  }

  /** Generates the notes for the next step. `stepSeconds` drives macro smoothing. */
  tick(stepSeconds: number): NoteEvent[] {
    const step = this.step++;
    const { macros, triggers } = this.router.update(stepSeconds);
    const stepInBar = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR);

    if (stepInBar === 0 && this.pendingStyle) {
      this.style = this.pendingStyle;
      this.pendingStyle = undefined;
      this.router.setRules(mergeRules(DEFAULT_MAPPING, this.style.mapping));
      this.router.setRanges(this.style.macroRanges);
      this.harmony.setStyle(this.style, macros);
      this.parts = this.buildParts();
      this.chordChangedAt = step;
    }

    const style = this.style;
    const phraseBars = Math.max(1, style.phraseBars);
    const phrasesPerSection = Math.max(1, Math.round(style.sectionBars / phraseBars));
    const barInPhrase = bar % phraseBars;
    const phraseInSection = Math.floor(bar / phraseBars) % phrasesPerSection;
    const isPhraseStart = stepInBar === 0 && barInPhrase === 0;
    const isSectionStart = isPhraseStart && phraseInSection === 0;

    // Harmony moves only on structural boundaries.
    const chordSteps = Math.max(1, Math.round(style.chordRateBars * STEPS_PER_BAR));
    const chordChanged = step > 0 && step % chordSteps === 0;
    if (isSectionStart && step > 0) this.harmony.onSectionStart(macros);
    if (isPhraseStart && step > 0) this.harmony.onPhraseStart(macros);
    if (chordChanged) {
      const nextChangeStep = step + chordSteps;
      const nextStartsPhrase = nextChangeStep % (phraseBars * STEPS_PER_BAR) === 0;
      this.harmony.advance(macros, nextStartsPhrase);
      this.chordChangedAt = step;
    }

    const ctx: ComposerContext = {
      style,
      step,
      bar,
      stepInBar,
      barInPhrase,
      phraseInSection,
      isPhraseStart,
      isSectionStart,
      isLastBarOfPhrase: barInPhrase === phraseBars - 1,
      isLastPhraseOfSection: phraseInSection === phrasesPerSection - 1,
      macros,
      triggers,
      scale: this.harmony.scale,
      chord: this.harmony.chord,
      nextChord: this.harmony.next,
      chordChanged: chordChanged || step === 0 || step === this.chordChangedAt,
      stepsUntilChordChange: chordSteps - (step % chordSteps),
    };

    const events: NoteEvent[] = [];
    for (const part of this.parts) {
      if (stepInBar === 0) part.onBar?.(ctx);
      events.push(...part.onStep(ctx));
    }
    return events;
  }

  snapshot(): EngineSnapshot {
    const step = Math.max(0, this.step - 1);
    const { roman, name } = chordSymbol(this.harmony.scale, this.harmony.chord);
    return {
      step,
      bar: Math.floor(step / STEPS_PER_BAR),
      beat: Math.floor((step % STEPS_PER_BAR) / STEPS_PER_BEAT),
      styleId: this.style.id,
      keyName: this.harmony.scale.name,
      mode: this.harmony.mode,
      chord: this.harmony.chord,
      chordRoman: roman,
      chordName: name,
      macros: this.router.macros,
    };
  }

  private buildParts(): Part[] {
    return this.style.parts.map((cfg) => createPart(cfg, this.rng.fork(`part:${cfg.id}`)));
  }
}
