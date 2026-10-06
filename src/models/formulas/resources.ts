import type { CombatRules } from '../rules';
import type { SkillPointPool } from '../combat';

/**
 * Skill Points (party-shared), Energy and effect-hit chance.
 */
type SpRules = Pick<CombatRules, 'skillPoints'>;

export function createSkillPointPool(rules: SpRules): SkillPointPool {
  return { current: rules.skillPoints.start, max: rules.skillPoints.max };
}

/** Basic ATK: +1 SP (excess beyond max is lost). Returns a new pool. */
export function gainSkillPoints(pool: SkillPointPool, amount: number): SkillPointPool {
  return { ...pool, current: Math.min(pool.max, pool.current + amount) };
}

export function canSpendSkillPoints(pool: SkillPointPool, cost: number): boolean {
  return pool.current >= cost;
}

/** Skill: -1 SP. Throws if not enough SP (the UI greys out the Skill button instead). */
export function spendSkillPoints(pool: SkillPointPool, cost: number): SkillPointPool {
  if (!canSpendSkillPoints(pool, cost)) throw new RangeError(`Not enough Skill Points (${pool.current}/${cost})`);
  return { ...pool, current: pool.current - cost };
}

/** Energy regenerated = base x (1 + Energy Regeneration Rate), unless fixed. Clamped to max energy. */
export function regenerateEnergy(current: number, max: number, base: number, energyRegen: number, fixed = false): number {
  const gain = fixed ? base : base * (1 + energyRegen);
  return Math.min(max, current + gain);
}

/** Ultimate is available when energy is full. Using it resets energy to 0 then grants the Ultimate's own energy. */
export function canUseUltimate(current: number, max: number): boolean {
  return current >= max - 1e-9;
}

export function initialEnergy(max: number, rules: Pick<CombatRules, 'energy'>): number {
  return max * rules.energy.initialRatio;
}

/**
 * Real chance to apply a debuff:
 *   Base Chance x (1 + Effect Hit Rate) x (1 - Effect RES) x (1 - Debuff RES)
 * Fixed-chance effects ignore EHR and Effect RES.
 */
export function debuffApplyChance(
  baseChance: number,
  effectHitRate: number,
  effectRes: number,
  debuffRes: number,
  rules: Pick<CombatRules, 'effectHit'>,
  fixed = false,
): number {
  const raw = fixed ? baseChance : baseChance * (1 + effectHitRate) * (1 - effectRes) * (1 - debuffRes);
  return Math.min(rules.effectHit.maxChance, Math.max(rules.effectHit.minChance, raw));
}
