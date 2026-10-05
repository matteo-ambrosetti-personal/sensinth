import type { Trig, TrigCondition } from './types';

export interface ConditionState {
  /** Completed loops of the track since its pattern was built. */
  loop: number;
  fill: boolean;
  /** Result of the previous conditional trig on this track. */
  pre: boolean;
  /** Result of the latest conditional trig on the track above. */
  nei: boolean;
}

export function evaluateCondition(cond: TrigCondition, s: ConditionState): boolean {
  switch (cond.kind) {
    case 'always':
      return true;
    case 'ratio': {
      const b = Math.max(1, Math.round(cond.b));
      const a = Math.min(b, Math.max(1, Math.round(cond.a)));
      return s.loop % b === a - 1;
    }
    case 'fill':
      return s.fill !== cond.not;
    case 'pre':
      return s.pre !== cond.not;
    case 'nei':
      return s.nei !== cond.not;
    case 'first':
      return (s.loop === 0) !== cond.not;
  }
}

/** A trig whose outcome other trigs can refer to with `pre` and `nei`. */
export function isConditional(trig: Trig): boolean {
  return trig.cond.kind !== 'always' || trig.prob < 1;
}
