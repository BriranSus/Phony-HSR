import type { Element } from '../common';
import type { CombatRules } from '../rules';
import type { Dot } from '../status';

/**
 * Toughness, Weakness Break and Break DMG.
 *
 * - Only hits of an element the enemy is weak to reduce toughness (some abilities ignore weakness).
 * - Toughness reduction is multiplied by (1 + Weakness Break Efficiency).
 * - When toughness reaches 0 the enemy is Weakness Broken: it takes Break DMG, gets the element's
 *   break status, is delayed (25% + element extra) and takes full damage (Broken multiplier 1.0 vs 0.9).
 */
type BreakRules = Pick<CombatRules, 'toughness' | 'weaknessBreak' | 'levelMultiplier'>;

export function toughnessReduction(base: number, isWeak: boolean, breakEfficiency: number, ignoresWeakness = false): number {
  if (!isWeak && !ignoresWeakness) return 0;
  return base * (1 + breakEfficiency);
}

export interface ToughnessHit {
  readonly remaining: number;
  readonly reduced: number;
  readonly broke: boolean;
}

/** Apply a toughness hit to the current value. `broke` is true only on the hit that empties the bar. */
export function applyToughnessHit(current: number, amount: number): ToughnessHit {
  if (current <= 0) return { remaining: 0, reduced: 0, broke: false };
  const reduced = Math.min(current, Math.max(0, amount));
  const remaining = current - reduced;
  return { remaining, reduced, broke: remaining <= 0 };
}

/** Max Toughness Multiplier = 0.5 + MaxToughness / 40. */
export function maxToughnessMultiplier(maxToughness: number, rules: BreakRules): number {
  return rules.toughness.multiplierBase + maxToughness / rules.toughness.multiplierDivisor;
}

/**
 * Attacker-level multiplier used by Break / Super Break / break DoT damage, read from the full
 * per-level table in `rules/combat/default.json` (Lv1-80 for characters, up to Lv95 for enemies).
 * There is no interpolation: a level missing from the table is a data error.
 */
export function levelMultiplier(level: number, rules: BreakRules): number {
  if (!Number.isInteger(level)) throw new RangeError(`Level multiplier needs an integer level (got ${level})`);
  const v = rules.levelMultiplier[String(level)];
  if (v === undefined) throw new RangeError(`No break level multiplier for Lv${level}`);
  return v;
}

/** Break DMG before DEF/RES/Vulnerability/Broken zones: ElementMult x LevelMult x MaxToughnessMult x (1 + BE). */
export function breakDamageBase(element: Element, attackerLevel: number, maxToughness: number, breakEffect: number, rules: BreakRules): number {
  const el = rules.weaknessBreak.elements[element];
  return el.breakDmgMultiplier * levelMultiplier(attackerLevel, rules) * maxToughnessMultiplier(maxToughness, rules) * (1 + breakEffect);
}

/** Total action delay applied on Weakness Break (fraction of base AV). */
export function breakActionDelay(element: Element, breakEffect: number, rules: BreakRules): number {
  const el = rules.weaknessBreak.elements[element];
  const extra = el.scalesWithBreakEffect ? el.extraDelay * (1 + breakEffect) : el.extraDelay;
  return rules.weaknessBreak.baseDelay + extra;
}

/** Super Break DMG base: LevelMult x (toughnessReduced / 10) x (1 + BE) x superBreakMultiplier. */
export function superBreakDamageBase(attackerLevel: number, toughnessReduced: number, breakEffect: number, superBreakMultiplier: number, rules: BreakRules): number {
  return levelMultiplier(attackerLevel, rules) * (toughnessReduced / rules.weaknessBreak.superBreakDivisor) * (1 + breakEffect) * superBreakMultiplier;
}

export interface BreakDotContext {
  readonly attackerLevel: number;
  readonly breakEffect: number;
  readonly targetMaxHp: number;
  readonly targetMaxToughness: number;
  readonly targetIsEliteOrHigher: boolean;
  readonly stacks: number;
}

/**
 * Per-tick break DoT damage before DEF/RES/Vulnerability/Broken zones:
 * - Bleed: min(16% / 7% (elite+) of Max HP, 2 x LevelMult x MaxToughnessMult) x (1 + BE)
 * - Burn 1x, Shock 2x, Wind Shear 1x per stack, Freeze 1x, Entanglement 0.6x per stack x MaxToughnessMult
 */
export function breakDotDamageBase(dot: Dot, ctx: BreakDotContext, rules: BreakRules): number {
  const lv = levelMultiplier(ctx.attackerLevel, rules);
  const tm = maxToughnessMultiplier(ctx.targetMaxToughness, rules);
  const be = 1 + ctx.breakEffect;
  switch (dot.formula) {
    case 'breakBleed': {
      const ratio = ctx.targetIsEliteOrHigher ? (dot.maxHpRatio?.elite ?? 0) : (dot.maxHpRatio?.normal ?? 0);
      const cap = (dot.capLevelMultiplier ?? 0) * lv * tm;
      return Math.min(ratio * ctx.targetMaxHp, cap) * be;
    }
    case 'breakDot': {
      const stacks = dot.perStack ? Math.max(1, ctx.stacks) : 1;
      const toughness = dot.useToughnessMultiplier ? tm : 1;
      return (dot.levelMultiplier ?? 0) * lv * toughness * stacks * be;
    }
    case 'attackerScaled':
      throw new Error('attackerScaled DoTs are computed from the attacker stat by the combat engine');
  }
}
