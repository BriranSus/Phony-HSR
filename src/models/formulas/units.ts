import type { Combatant, CombatantPresence } from '../combat';

/**
 * Unit lifecycle rules shared by the combat engine and tests.
 *
 * - A character or enemy at 0 HP is `downed`.
 * - A memosprite at 0 HP `leftField`: it leaves the timeline, its owner is unaffected and it can be
 *   summoned again.
 * - When an owner is downed, the units it owns (memosprites, summons) leave the field with it.
 */
export function presenceAtZeroHp(unit: Pick<Combatant, 'onZeroHp'>): CombatantPresence {
  return unit.onZeroHp === 'leaveField' ? 'leftField' : 'downed';
}

/** Units that take turns on the Action Value timeline. */
export function isOnTimeline(unit: Pick<Combatant, 'presence'>): boolean {
  return unit.presence === 'active';
}

/**
 * Apply the 0-HP transition to `uid` (mutates `units`). Returns every unit whose presence changed,
 * in order: the unit itself, then units it owns.
 */
export function resolveZeroHp(units: Combatant[], uid: string): Combatant[] {
  const unit = units.find((u) => u.uid === uid);
  if (!unit || unit.presence !== 'active') return [];
  unit.hp = 0;
  unit.presence = presenceAtZeroHp(unit);
  const changed = [unit];
  if (unit.presence === 'downed') {
    for (const owned of units) {
      if (owned.ownerUid === unit.uid && owned.presence === 'active') {
        owned.presence = 'leftField';
        changed.push(owned);
      }
    }
  }
  return changed;
}
