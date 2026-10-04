import type { NoteEvent } from '../../clock/events';
import { STEPS_PER_BAR } from '../../clock/grid';
import { lerp } from '../../math';
import type { Rng } from '../../random';
import type { DrumsPartConfig } from '../../styles/schema';
import type { ComposerContext, Part } from '../context';
import { LevelSelector, velocityOf } from '../patterns';

const FILL_START = 12;

export class DrumsPart implements Part {
  readonly id: string;
  private readonly level: LevelSelector;
  private currentLevel = 0;
  private fill: Record<string, string> | undefined;
  private fillNextBar = false;
  private pendingAccent = 0;

  constructor(
    private readonly cfg: DrumsPartConfig,
    private readonly rng: Rng,
  ) {
    this.id = cfg.id;
    const levels = Math.max(...Object.values(cfg.voices).map((v) => v.length));
    this.level = new LevelSelector(levels);
  }

  onBar(ctx: ComposerContext): void {
    this.currentLevel = this.level.select(ctx.macros.energy);
    const autoFill =
      ctx.isLastBarOfPhrase &&
      (ctx.isLastPhraseOfSection || this.rng.chance(ctx.macros.variation * 0.6));
    this.fill = this.fillNextBar || autoFill ? this.pickFill() : undefined;
    this.fillNextBar = false;
  }

  onStep(ctx: ComposerContext): NoteEvent[] {
    const { stepInBar, macros, triggers } = ctx;
    if (triggers.fill > 0 && !this.fill) {
      if (stepInBar < FILL_START) this.fill = this.pickFill();
      else this.fillNextBar = true;
    }
    if (triggers.accent > 0) this.pendingAccent = Math.max(this.pendingAccent, triggers.accent);

    const dynamics = lerp(0.65, 1, macros.energy);
    const events: NoteEvent[] = [];
    const hit = (voice: string, vel: number) =>
      events.push({ part: this.id, step: ctx.step, durSteps: 1, vel, voice });

    for (const [voice, levels] of Object.entries(this.cfg.voices)) {
      const pattern = levels[Math.min(this.currentLevel, levels.length - 1)] ?? '';
      let c = pattern[(ctx.bar * STEPS_PER_BAR + stepInBar) % Math.max(1, pattern.length)] ?? '.';
      const fillPattern = this.fill?.[voice];
      if (fillPattern && stepInBar >= FILL_START) c = fillPattern[stepInBar - FILL_START] ?? '.';
      if (c !== '.' && c !== '-') hit(voice, velocityOf(c) * dynamics);
    }

    // Occasional ghost notes when variation is high.
    const ghost = this.cfg.ghostVoice;
    if (
      stepInBar % 2 === 1 &&
      !events.some((e) => e.voice === ghost) &&
      this.rng.chance(macros.variation * macros.energy * 0.12)
    ) {
      hit(ghost, 0.3 * dynamics);
    }

    // A sensor onset asked for an accent: play it on the next eighth-note slot.
    if (this.pendingAccent > 0 && stepInBar % 2 === 0) {
      const vel = Math.min(1, 0.6 + 0.4 * this.pendingAccent);
      const existing = events.find((e) => e.voice === this.cfg.accentVoice);
      if (existing) existing.vel = Math.max(existing.vel, vel);
      else hit(this.cfg.accentVoice, vel);
      this.pendingAccent = 0;
    }
    return events;
  }

  private pickFill(): Record<string, string> | undefined {
    return this.cfg.fills.length > 0 ? this.rng.pick(this.cfg.fills) : undefined;
  }
}
