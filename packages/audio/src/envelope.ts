import type { Envelope } from '@sensinth/core';

/**
 * Schedules an ADSR envelope on `param`, gate open from `t0` for `gate`
 * seconds. Returns the time the release has died away.
 */
export function applyEnvelope(
  param: AudioParam,
  t0: number,
  gate: number,
  env: Envelope,
  peak: number,
): number {
  const attack = Math.max(0.001, env.a);
  const tAttackEnd = t0 + Math.min(attack, gate);
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak * Math.min(1, gate / attack), tAttackEnd);
  const tOff = t0 + gate;
  if (tAttackEnd < tOff)
    param.setTargetAtTime(peak * env.s, tAttackEnd, Math.max(0.001, env.d / 3));
  const release = Math.max(0.005, env.r);
  param.setTargetAtTime(0, tOff, release / 3);
  return tOff + release * 2.5;
}
