import type { CombatRules } from '../rules';

/**
 * Outgoing damage = Base DMG x CRIT x DMG Boost x Weaken x DEF x RES x Vulnerability x DMG Mitigation x Broken
 *
 * Every zone is a separate multiplier; bonuses inside a zone add up, zones multiply together.
 */
type DmgRules = Pick<CombatRules, 'defense' | 'resistance' | 'brokenMultiplier'>;

/** Base DMG = (ability multiplier + extra multiplier) x scaling stat + extra flat DMG. */
export function baseDamage(multiplier: number, scalingStat: number, extraMultiplier = 0, extraFlat = 0): number {
  return (multiplier + extraMultiplier) * scalingStat + extraFlat;
}

export function critMultiplier(isCrit: boolean, critDmg: number): number {
  return isCrit ? 1 + critDmg : 1;
}

/** Average CRIT multiplier, CRIT Rate clamped to [0, 1]. */
export function expectedCritMultiplier(critRate: number, critDmg: number): number {
  return 1 + Math.min(1, Math.max(0, critRate)) * critDmg;
}

/** DMG Boost zone: 1 + elemental DMG% + all-type DMG% + attack-type DMG% (e.g. DoT, Follow-up). */
export function dmgBoostMultiplier(totalBoost: number): number {
  return 1 + totalBoost;
}

export function weakenMultiplier(weaken: number): number {
  return 1 - weaken;
}

/** DEF zone when a character hits an enemy. Enemy DEF = 200 + 10 x Lv, folded into the level formula. */
export function enemyDefMultiplier(attackerLevel: number, targetLevel: number, defReduction: number, defIgnore: number, rules: DmgRules): number {
  const o = rules.defense.levelOffset;
  const k = Math.max(0, 1 - defReduction - defIgnore);
  return (attackerLevel + o) / ((targetLevel + o) * k + attackerLevel + o);
}

/** Raw enemy DEF value, for display. */
export function enemyDef(level: number, rules: DmgRules): number {
  return rules.defense.enemyBase + rules.defense.enemyPerLevel * level;
}

/** DEF zone when an enemy hits a character. */
export function characterDefMultiplier(targetDef: number, attackerLevel: number, rules: DmgRules): number {
  const def = Math.max(0, targetDef);
  return 1 - def / (def + rules.defense.charBase + rules.defense.charPerLevel * attackerLevel);
}

/** RES zone: 1 - (RES - RES PEN), clamped (10% .. 200% by default). */
export function resMultiplier(res: number, resPen: number, rules: DmgRules): number {
  const m = 1 - (res - resPen);
  return Math.min(rules.resistance.multiplierMax, Math.max(rules.resistance.multiplierMin, m));
}

/** Target's RES to an element: weakness -> 0%, otherwise explicit override or 20%. */
export function enemyResistance(isWeak: boolean, override: number | undefined, rules: DmgRules): number {
  if (override !== undefined) return override;
  return isWeak ? rules.resistance.weakEnemyRes : rules.resistance.defaultEnemyRes;
}

export function vulnerabilityMultiplier(vulnerability: number): number {
  return 1 + vulnerability;
}

/** DMG Mitigation sources multiply: (1 - m1) x (1 - m2) x ... */
export function mitigationMultiplier(mitigations: readonly number[]): number {
  return mitigations.reduce((acc, m) => acc * (1 - m), 1);
}

export function toughnessBrokenMultiplier(broken: boolean, rules: DmgRules): number {
  return broken ? rules.brokenMultiplier.broken : rules.brokenMultiplier.unbroken;
}

export interface DamageInput {
  readonly multiplier: number;
  readonly scalingStat: number;
  readonly extraMultiplier?: number;
  readonly extraFlat?: number;
  /** Concrete crit roll; omit to get the expected (average) value. */
  readonly isCrit?: boolean;
  readonly critRate: number;
  readonly critDmg: number;
  readonly dmgBoost: number;
  readonly weaken?: number;
  readonly attackerLevel: number;
  readonly targetLevel: number;
  readonly defReduction?: number;
  readonly defIgnore?: number;
  readonly targetRes: number;
  readonly resPen?: number;
  readonly vulnerability?: number;
  readonly mitigations?: readonly number[];
  readonly targetBroken: boolean;
  /** DEF zone computed by the caller (enemy -> character hits use the target's DEF stat, see `characterDefMultiplier`). */
  readonly defMultiplier?: number;
}

export interface DamageResult {
  readonly total: number;
  readonly zones: {
    readonly base: number;
    readonly crit: number;
    readonly dmgBoost: number;
    readonly weaken: number;
    readonly def: number;
    readonly res: number;
    readonly vulnerability: number;
    readonly mitigation: number;
    readonly broken: number;
  };
}

/** Character -> enemy damage with every multiplier zone exposed (for tests and damage breakdown UI). */
export function computeDamage(i: DamageInput, rules: DmgRules): DamageResult {
  const zones = {
    base: baseDamage(i.multiplier, i.scalingStat, i.extraMultiplier, i.extraFlat),
    crit: i.isCrit === undefined ? expectedCritMultiplier(i.critRate, i.critDmg) : critMultiplier(i.isCrit, i.critDmg),
    dmgBoost: dmgBoostMultiplier(i.dmgBoost),
    weaken: weakenMultiplier(i.weaken ?? 0),
    def: i.defMultiplier ?? enemyDefMultiplier(i.attackerLevel, i.targetLevel, i.defReduction ?? 0, i.defIgnore ?? 0, rules),
    res: resMultiplier(i.targetRes, i.resPen ?? 0, rules),
    vulnerability: vulnerabilityMultiplier(i.vulnerability ?? 0),
    mitigation: mitigationMultiplier(i.mitigations ?? []),
    broken: toughnessBrokenMultiplier(i.targetBroken, rules),
  };
  const total = Object.values(zones).reduce((a, b) => a * b, 1);
  return { total, zones };
}
