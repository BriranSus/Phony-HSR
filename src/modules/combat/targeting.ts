import type { Combatant } from '@models/combat';
import { isActive, opposing, statValue, type BattleView } from './stats';

/**
 * Targeting rules.
 *
 * - Blast: the main target plus the units next to it (left and right) on the same side. Positions are
 *   the order of the units on the field (allies and enemies each left to right).
 * - AoE: every active unit of the opposing side.
 * - Enemy single-target attacks pick an ally at random weighted by aggro (the Path's taunt value
 *   times (1 + aggro modifiers)); a "Locked On" mark the enemy placed forces that target.
 */
export function sideUnits(b: BattleView, side: Combatant['side']): Combatant[] {
  return b.units.filter((u) => u.side === side && isActive(u));
}

/** The units directly left and right of `selected` on its side (blast splash targets). */
export function adjacentTo(b: BattleView, selected: Combatant): Combatant[] {
  const row = sideUnits(b, selected.side);
  const i = row.indexOf(selected);
  if (i < 0) return [];
  return [row[i - 1], row[i + 1]].filter((u): u is Combatant => u !== undefined);
}

export function aggroWeight(b: BattleView, unit: Combatant): number {
  return Math.max(0, statValue(b, unit, 'aggro'));
}

export const LOCK_ON_STATUS = 'enemy.lock-on';

/** The ally an enemy attacks with a single-target ability (aggro-weighted; `Locked On` wins). */
export function pickEnemyTarget(b: BattleView, attacker: Combatant): Combatant | null {
  const pool = opposing(b, attacker);
  if (pool.length === 0) return null;
  const marked = pool.find((u) => u.statuses.some((s) => s.statusId === LOCK_ON_STATUS && s.sourceId === attacker.uid));
  if (marked) return marked;
  return b.rng.weighted(pool, (u) => aggroWeight(b, u)) ?? pool[0] ?? null;
}
