import { describe, expect, it } from 'vitest';
import rulesJson from '@data/rules/combat/default.json';
import progressionJson from '@data/rules/progression/default.json';
import bleedAndFriends from '@data/status-effects/weakness-break.json';
import { CombatRulesSchema, ProgressionRulesSchema } from '@models/rules';
import { StatusEffectSchema } from '@models/status';
import {
  aggregateStat,
  applyToughnessHit,
  baseActionValue,
  breakActionDelay,
  breakDamageBase,
  breakDotDamageBase,
  canSpendSkillPoints,
  canUseUltimate,
  characterDefMultiplier,
  computeDamage,
  createSkillPointPool,
  cycleAt,
  debuffApplyChance,
  enemyDef,
  enemyDefMultiplier,
  enemyResistance,
  gainSkillPoints,
  grownStat,
  initialEnergy,
  isValidLevelForAscension,
  levelMultiplier,
  maxToughnessMultiplier,
  mitigationMultiplier,
  predictTurnOrder,
  regenerateEnergy,
  rescaleForSpeedChange,
  resMultiplier,
  shiftAction,
  spendSkillPoints,
  superBreakDamageBase,
  toughnessReduction,
} from '@models/formulas';

const rules = CombatRulesSchema.parse(rulesJson);
const progression = ProgressionRulesSchema.parse(progressionJson);
const status = (id: string) => StatusEffectSchema.parse(bleedAndFriends.find((s) => s.id === id));

describe('Action Value & turn order', () => {
  it('base AV = 10000 / SPD', () => {
    expect(baseActionValue(100, rules)).toBe(100);
    expect(baseActionValue(134, rules)).toBeCloseTo(74.627, 3);
    expect(() => baseActionValue(0, rules)).toThrow(RangeError);
  });

  it('action advance / delay shift by a fraction of base AV and never go below 0', () => {
    expect(shiftAction(80, 100, 0.25, rules)).toBe(55);
    expect(shiftAction(80, 100, -0.25, rules)).toBe(105);
    expect(shiftAction(10, 100, 1, rules)).toBe(0);
  });

  it('SPD changes keep the remaining distance (AV scales by oldSPD/newSPD)', () => {
    expect(rescaleForSpeedChange(60, 100, 120)).toBeCloseTo(50);
    expect(rescaleForSpeedChange(50, 120, 100)).toBeCloseTo(60);
  });

  it('cycles: 150 AV first, then 100 AV each', () => {
    expect(cycleAt(0, rules)).toBe(0);
    expect(cycleAt(149.9, rules)).toBe(0);
    expect(cycleAt(150, rules)).toBe(1);
    expect(cycleAt(249.9, rules)).toBe(1);
    expect(cycleAt(250, rules)).toBe(2);
  });

  it('predicts the turn order; a 2x faster unit acts twice as often', () => {
    const order = predictTurnOrder(
      [
        { uid: 'slow', spd: 100 },
        { uid: 'fast', spd: 200 },
      ],
      6,
      rules,
    );
    expect(order.map((t) => t.uid)).toEqual(['fast', 'slow', 'fast', 'fast', 'slow', 'fast']);
    expect(order.map((t) => t.actionValue)).toEqual([50, 100, 100, 150, 200, 200]);
  });

  it('respects current AV (e.g. after an action advance)', () => {
    const order = predictTurnOrder(
      [
        { uid: 'a', spd: 100, actionValue: 100 },
        { uid: 'b', spd: 100, actionValue: 10 },
      ],
      2,
      rules,
    );
    expect(order.map((t) => t.uid)).toEqual(['b', 'a']);
  });
});

describe('Damage multiplier zones', () => {
  it('DEF multiplier: equal levels -> 50%; DEF shred raises it', () => {
    expect(enemyDefMultiplier(80, 80, 0, 0, rules)).toBeCloseTo(0.5);
    expect(enemyDefMultiplier(80, 90, 0, 0, rules)).toBeCloseTo(100 / 210);
    expect(enemyDefMultiplier(80, 80, 0.4, 0, rules)).toBeCloseTo(100 / 160);
    expect(enemyDefMultiplier(80, 80, 0.8, 0.4, rules)).toBe(1);
    expect(enemyDef(80, rules)).toBe(1000);
  });

  it('character DEF multiplier vs an enemy attacker', () => {
    expect(characterDefMultiplier(1000, 80, rules)).toBeCloseTo(1 - 1000 / 2000);
  });

  it('RES: 20% default, 0% when weak, clamped to [10%, 200%]', () => {
    expect(enemyResistance(false, undefined, rules)).toBe(0.2);
    expect(enemyResistance(true, undefined, rules)).toBe(0);
    expect(enemyResistance(false, 0.4, rules)).toBe(0.4);
    expect(resMultiplier(0.2, 0, rules)).toBeCloseTo(0.8);
    expect(resMultiplier(0.2, 0.1, rules)).toBeCloseTo(0.9);
    expect(resMultiplier(1.5, 0, rules)).toBe(0.1);
    expect(resMultiplier(-2, 0, rules)).toBe(2);
  });

  it('DMG mitigation sources multiply', () => {
    expect(mitigationMultiplier([0.2, 0.1])).toBeCloseTo(0.72);
  });

  it('combines every zone multiplicatively', () => {
    const r = computeDamage(
      {
        multiplier: 2,
        scalingStat: 2000,
        isCrit: true,
        critRate: 0.5,
        critDmg: 1,
        dmgBoost: 0.5,
        attackerLevel: 80,
        targetLevel: 80,
        targetRes: 0.2,
        vulnerability: 0.1,
        targetBroken: false,
      },
      rules,
    );
    expect(r.zones.base).toBe(4000);
    expect(r.zones.crit).toBe(2);
    expect(r.zones.broken).toBe(0.9);
    expect(r.total).toBeCloseTo(4000 * 2 * 1.5 * 0.5 * 0.8 * 1.1 * 0.9);
  });

  it('uses expected CRIT when no roll is given, and broken targets take full damage', () => {
    const base = { multiplier: 1, scalingStat: 1000, critRate: 1.5, critDmg: 1, dmgBoost: 0, attackerLevel: 80, targetLevel: 80, targetRes: 0 };
    expect(computeDamage({ ...base, targetBroken: true }, rules).zones.crit).toBe(2);
    expect(computeDamage({ ...base, targetBroken: true }, rules).zones.broken).toBe(1);
  });
});

describe('Toughness & Weakness Break', () => {
  it('only matching weaknesses reduce toughness, scaled by Break Efficiency', () => {
    expect(toughnessReduction(10, false, 0)).toBe(0);
    expect(toughnessReduction(10, true, 0.5)).toBe(15);
    expect(toughnessReduction(10, false, 0, true)).toBe(10);
  });

  it('breaks exactly when toughness hits 0', () => {
    expect(applyToughnessHit(30, 20)).toEqual({ remaining: 10, reduced: 20, broke: false });
    expect(applyToughnessHit(10, 20)).toEqual({ remaining: 0, reduced: 10, broke: true });
    expect(applyToughnessHit(0, 20)).toEqual({ remaining: 0, reduced: 0, broke: false });
  });

  it('Max Toughness multiplier = 0.5 + toughness / 40', () => {
    expect(maxToughnessMultiplier(60, rules)).toBe(2);
    expect(maxToughnessMultiplier(160, rules)).toBe(4.5);
  });

  it('level multiplier uses data anchors', () => {
    expect(levelMultiplier(80, rules)).toBeCloseTo(3767.5533);
    expect(levelMultiplier(1, rules)).toBe(54);
    expect(levelMultiplier(90, rules)).toBeCloseTo(3767.5533);
  });

  it('element break DMG multipliers: Physical/Fire 2x, Wind 1.5x, Ice/Lightning 1x, Quantum/Imaginary 0.5x', () => {
    const at = (el: Parameters<typeof breakDamageBase>[0]) => breakDamageBase(el, 80, 60, 0, rules) / (3767.5533 * 2);
    expect(at('Physical')).toBeCloseTo(2);
    expect(at('Fire')).toBeCloseTo(2);
    expect(at('Wind')).toBeCloseTo(1.5);
    expect(at('Ice')).toBeCloseTo(1);
    expect(at('Lightning')).toBeCloseTo(1);
    expect(at('Quantum')).toBeCloseTo(0.5);
    expect(at('Imaginary')).toBeCloseTo(0.5);
    expect(breakDamageBase('Fire', 80, 60, 1, rules)).toBeCloseTo(2 * 3767.5533 * 2 * 2);
  });

  it('break delays: 25% base; Quantum +20% and Imaginary +30%, scaled by Break Effect', () => {
    expect(breakActionDelay('Fire', 1, rules)).toBe(0.25);
    expect(breakActionDelay('Quantum', 0, rules)).toBeCloseTo(0.45);
    expect(breakActionDelay('Quantum', 1, rules)).toBeCloseTo(0.65);
    expect(breakActionDelay('Imaginary', 0, rules)).toBeCloseTo(0.55);
  });

  it('Bleed: 16% Max HP (7% elite) capped by 2 x LevelMult x ToughnessMult', () => {
    const bleed = status('break.bleed');
    const cap = 2 * 3767.5533 * 2;
    const ctx = { attackerLevel: 80, breakEffect: 0, targetMaxToughness: 60, stacks: 1 };
    expect(breakDotDamageBase(bleed.dot!, { ...ctx, targetMaxHp: 1_000_000, targetIsEliteOrHigher: false }, rules)).toBeCloseTo(cap);
    expect(breakDotDamageBase(bleed.dot!, { ...ctx, targetMaxHp: 10_000, targetIsEliteOrHigher: true }, rules)).toBeCloseTo(700);
    expect(breakDotDamageBase(bleed.dot!, { ...ctx, targetMaxHp: 10_000, targetIsEliteOrHigher: false }, rules)).toBeCloseTo(1600);
  });

  it('Burn 1x, Shock 2x, Wind Shear 1x per stack, Entanglement 0.6x per stack x ToughnessMult', () => {
    const ctx = { attackerLevel: 80, breakEffect: 0, targetMaxHp: 1, targetMaxToughness: 60, targetIsEliteOrHigher: true };
    const lv = 3767.5533;
    expect(breakDotDamageBase(status('break.burn').dot!, { ...ctx, stacks: 1 }, rules)).toBeCloseTo(lv);
    expect(breakDotDamageBase(status('break.shock').dot!, { ...ctx, stacks: 1 }, rules)).toBeCloseTo(2 * lv);
    expect(breakDotDamageBase(status('break.wind-shear').dot!, { ...ctx, stacks: 3 }, rules)).toBeCloseTo(3 * lv);
    expect(breakDotDamageBase(status('break.entanglement').dot!, { ...ctx, stacks: 5 }, rules)).toBeCloseTo(0.6 * 5 * lv * 2);
    expect(status('break.wind-shear').initialStacks).toEqual({ normal: 1, elite: 3 });
    expect(status('break.freeze').cc).toMatchObject({ type: 'freeze', skipsTurn: true, delayOnExpire: 0.5 });
  });

  it('Super Break scales with toughness reduced', () => {
    expect(superBreakDamageBase(80, 30, 1, 1, rules)).toBeCloseTo(3767.5533 * 3 * 2);
  });
});

describe('Skill Points, Energy, effect hit', () => {
  it('party-shared SP pool starts at 3, caps at 5, Skill needs 1', () => {
    let pool = createSkillPointPool(rules);
    expect(pool).toEqual({ current: 3, max: 5 });
    pool = gainSkillPoints(gainSkillPoints(gainSkillPoints(pool, 1), 1), 1);
    expect(pool.current).toBe(5);
    for (let i = 0; i < 5; i++) pool = spendSkillPoints(pool, 1);
    expect(canSpendSkillPoints(pool, 1)).toBe(false);
    expect(() => spendSkillPoints(pool, 1)).toThrow(/Not enough Skill Points/);
  });

  it('energy regen scales with ERR unless fixed, and caps at max', () => {
    expect(regenerateEnergy(0, 120, 20, 0.194)).toBeCloseTo(23.88);
    expect(regenerateEnergy(0, 120, 50, 0.194, true)).toBe(50);
    expect(regenerateEnergy(110, 120, 30, 0)).toBe(120);
    expect(canUseUltimate(120, 120)).toBe(true);
    expect(canUseUltimate(119, 120)).toBe(false);
    expect(initialEnergy(120, rules)).toBe(60);
  });

  it('debuff chance = base x (1 + EHR) x (1 - Effect RES) x (1 - Debuff RES)', () => {
    expect(debuffApplyChance(1, 0.5, 0.3, 0.5, rules)).toBeCloseTo(0.525);
    expect(debuffApplyChance(0.6, 1, 0, 0, rules)).toBe(1);
    expect(debuffApplyChance(0.6, 1, 0.9, 0, rules, true)).toBe(0.6);
  });
});

describe('Stat growth', () => {
  it('reproduces the promotion formula (5-star ATK 87.12 -> 640 at Lv80 A6)', () => {
    expect(grownStat(87.12, 80, 6, progression.character)).toBeCloseTo(640.33, 1);
    expect(grownStat(87.12, 1, 0, progression.character)).toBeCloseTo(87.12);
  });

  it('validates level / ascension combinations against level caps', () => {
    expect(isValidLevelForAscension(20, 0, progression)).toBe(true);
    expect(isValidLevelForAscension(21, 0, progression)).toBe(false);
    expect(isValidLevelForAscension(20, 1, progression)).toBe(true);
    expect(isValidLevelForAscension(80, 6, progression)).toBe(true);
  });

  it('aggregates base x (1 + %) + flat', () => {
    expect(aggregateStat('atk', 1000, { atkPct: 0.5, atk: 352.8 })).toBeCloseTo(1852.8);
    expect(aggregateStat('spd', 100, { spd: 25 })).toBe(125);
  });
});
