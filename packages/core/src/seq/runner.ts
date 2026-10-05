import { clamp } from '../math';
import { effectiveProbability, type TrackParams } from '../mod/params';
import type { Rng } from '../random';
import { evaluateCondition, isConditional } from './conditions';
import type { Retrig, TrackSpec, Trig } from './types';

/** A trig that plays on the current 16th step. */
export interface FiredTrig {
  trig: Trig;
  /** Its index in the track. */
  index: number;
  /** Offset from the 16th grid in steps: track-scale timing, the trig's micro and the micro param. */
  micro: number;
  /** Length in 16th steps. */
  len: number;
  retrig?: Retrig;
}

export interface RunnerContext {
  fill: boolean;
  /** Latest conditional result of the track above. */
  nei: boolean;
}

/** Most the `micro` param can move a whole track off the grid, in steps. */
const MICRO_PARAM_RANGE = 0.25;

/**
 * Plays one track: its own length (polymeter) and speed (scale), trig
 * conditions, probabilities and retrigs. The spec is shared with the genome,
 * so phrase mutations take effect on the next loop step.
 */
export class TrackRunner {
  /** Track steps played since the last reset. */
  private count = 0;
  /** Completed loops since the last reset. */
  loop = 0;
  /** Result of the latest conditional trig (read by `pre` here and `nei` below). */
  lastCond = false;
  /** Index of the latest step reached, −1 before the first. */
  position = -1;

  constructor(
    public spec: TrackSpec,
    private readonly rng: Rng,
  ) {}

  reset(): void {
    this.count = 0;
    this.loop = 0;
    this.lastCond = false;
    this.position = -1;
  }

  /**
   * Plays the track steps that fall inside 16th step `g`, counted from the
   * track's start. `params` are this step's modulated values.
   */
  step(g: number, params: Readonly<TrackParams>, ctx: RunnerContext): FiredTrig[] {
    const { spec } = this;
    const scale = spec.scale > 0 ? spec.scale : 1;
    const length = Math.max(1, Math.min(spec.trigs.length, spec.length));
    const end = Math.ceil((g + 1) * scale - 1e-9);
    const out: FiredTrig[] = [];
    while (this.count < end) {
      const k = this.count++;
      const index = k % length;
      if (k > 0 && index === 0) this.loop++;
      this.position = index;
      const trig = spec.trigs[index];
      if (!trig) continue;
      const condOk = evaluateCondition(trig.cond, {
        loop: this.loop,
        fill: ctx.fill,
        pre: this.lastCond,
        nei: ctx.nei,
      });
      // Always draw, so one trig's outcome never shifts the random stream of the next.
      const roll = this.rng.next();
      const extraRoll = this.rng.next();
      const prob = effectiveProbability(trig.prob, params.prob);
      const played = condOk && roll < prob;
      if (isConditional(trig)) this.lastCond = played;
      if (!played) continue;
      const fired: FiredTrig = {
        trig,
        index,
        micro: clamp(
          k / scale - g + trig.micro + (params.micro - 0.5) * 2 * MICRO_PARAM_RANGE,
          -0.45,
          1.45,
        ),
        len: Math.max(0.25, trig.len / scale),
      };
      const retrig = effectiveRetrig(trig.retrig, params.retrig, extraRoll);
      if (retrig) fired.retrig = { ...retrig, rate: retrig.rate / scale };
      out.push(fired);
    }
    return out;
  }
}

/**
 * The `retrig` param scales a trig's retrig count (0.5 = as written); above
 * 0.8 it can add a short roll to trigs that have none.
 */
export function effectiveRetrig(
  retrig: Retrig | undefined,
  param: number,
  roll: number,
): Retrig | undefined {
  if (retrig) {
    const count = Math.min(8, Math.max(1, Math.round(retrig.count * (0.5 + param))));
    return count > 1 ? { ...retrig, count } : undefined;
  }
  if (param > 0.8 && roll < (param - 0.8) * 2.5) {
    return { count: 2 + Math.round((param - 0.8) * 10), rate: 0.5, curve: -0.3 };
  }
  return undefined;
}
