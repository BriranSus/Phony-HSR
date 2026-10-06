import type { CombatRules } from '../rules';
import type { TurnOrderEntry } from '../combat';

/**
 * Action Value (AV) mechanics.
 *
 * - Base AV = 10000 / SPD. The unit with the lowest remaining AV acts next; when it acts, every
 *   other unit's AV decreases by the elapsed AV and the actor's AV resets to its base AV.
 * - Action Advance X%: AV -= X * baseAV (floored at 0). Action Delay X%: AV += X * baseAV.
 * - SPD changes rescale the remaining AV: newAV = oldAV * oldSPD / newSPD (remaining distance is kept).
 */
type AvRules = Pick<CombatRules, 'actionValue'>;

export function baseActionValue(spd: number, rules: AvRules): number {
  if (!(spd > 0)) throw new RangeError(`SPD must be positive (got ${spd})`);
  return rules.actionValue.numerator / spd;
}

/** Positive fraction = Action Advance, negative = Action Delay. */
export function shiftAction(currentAv: number, spd: number, fraction: number, rules: AvRules): number {
  return Math.max(0, currentAv - fraction * baseActionValue(spd, rules));
}

export function rescaleForSpeedChange(currentAv: number, oldSpd: number, newSpd: number): number {
  if (!(oldSpd > 0) || !(newSpd > 0)) throw new RangeError('SPD must be positive');
  return (currentAv * oldSpd) / newSpd;
}

/** Cycle index (0-based) for a total elapsed AV. First cycle is 150 AV, later cycles 100 AV. */
export function cycleAt(avElapsed: number, rules: AvRules): number {
  const { firstCycle, cycle } = rules.actionValue;
  if (avElapsed < firstCycle) return 0;
  return 1 + Math.floor((avElapsed - firstCycle) / cycle);
}

export interface AvUnit {
  readonly uid: string;
  readonly spd: number;
  /** Current remaining AV (defaults to base AV, i.e. battle start). */
  readonly actionValue?: number;
}

/**
 * Predict the next `count` turns (for the turn-order bar). Ties resolve by input order, which the
 * combat engine sets to allies-first then enemies, left to right.
 */
export function predictTurnOrder(units: readonly AvUnit[], count: number, rules: AvRules): TurnOrderEntry[] {
  const sim = units.map((u) => ({ uid: u.uid, spd: u.spd, av: u.actionValue ?? baseActionValue(u.spd, rules) }));
  const out: TurnOrderEntry[] = [];
  if (sim.length === 0) return out;
  let elapsed = 0;
  for (let n = 0; n < count; n++) {
    let next = sim[0] as (typeof sim)[number];
    for (const u of sim) if (u.av < next.av - 1e-9) next = u;
    const step = next.av;
    elapsed += step;
    for (const u of sim) u.av -= step;
    out.push({ uid: next.uid, actionValue: elapsed, spd: next.spd });
    next.av = baseActionValue(next.spd, rules);
  }
  return out;
}
