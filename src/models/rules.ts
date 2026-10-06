import { z } from 'zod';
import { ElementSchema, IdSchema, PathSchema, SourceSchema, TextSchema } from './common';

/**
 * Global combat rules. Every tunable constant of the battle system lives here (data), never in code.
 * Values mirror the reference game's published mechanics.
 */
const PerElement = <T extends z.ZodType>(v: T) =>
  z.object({
    Physical: v,
    Fire: v,
    Ice: v,
    Lightning: v,
    Wind: v,
    Quantum: v,
    Imaginary: v,
  });

export const CombatRulesSchema = z
  .object({
    id: IdSchema,
    actionValue: z
      .object({
        /** Base AV = numerator / SPD. */
        numerator: z.number().positive(),
        /** Length of the first cycle in AV (Memory-style stages count cycles). */
        firstCycle: z.number().positive(),
        cycle: z.number().positive(),
      })
      .strict(),
    skillPoints: z
      .object({
        max: z.number().int().positive(),
        start: z.number().int().min(0),
        basicGain: z.number().int().min(0),
        skillCost: z.number().int().min(0),
      })
      .strict()
      .refine((s) => s.start <= s.max, 'start must be <= max'),
    energy: z
      .object({
        basic: z.number().min(0),
        skill: z.number().min(0),
        ultimate: z.number().min(0),
        kill: z.number().min(0),
        /** Fraction of max energy characters start with in a fresh battle setup. */
        initialRatio: z.number().min(0).max(1),
      })
      .strict(),
    techniquePoints: z.object({ max: z.number().int().positive(), regenPerDay: z.number().int().min(0) }).strict(),
    crit: z.object({ baseRate: z.number().min(0).max(1), baseDmg: z.number().min(0) }).strict(),
    defense: z
      .object({
        /** Enemy DEF = base + perLevel * level. */
        enemyBase: z.number().min(0),
        enemyPerLevel: z.number().min(0),
        /** DEF multiplier level offset: (Lv_attacker + offset) / ((Lv_target + offset) * (1 - DEF reduction - DEF ignore) + Lv_attacker + offset). */
        levelOffset: z.number().min(0),
        /** Character-as-target DEF multiplier: 1 - DEF / (DEF + charBase + charPerLevel * Lv_attacker). */
        charBase: z.number().min(0),
        charPerLevel: z.number().min(0),
      })
      .strict(),
    resistance: z
      .object({
        defaultEnemyRes: z.number(),
        weakEnemyRes: z.number(),
        multiplierMin: z.number(),
        multiplierMax: z.number(),
      })
      .strict(),
    /** DMG multiplier vs. enemies whose toughness is not broken (0.9) and broken (1.0). */
    brokenMultiplier: z.object({ unbroken: z.number().positive(), broken: z.number().positive() }).strict(),
    toughness: z
      .object({
        /** Standard toughness reduction by ability type (one bar segment = 10 in data units). */
        basic: z.number().min(0),
        skill: z.number().min(0),
        ultimate: z.number().min(0),
        /** Max Toughness Multiplier = base + maxToughness / divisor. */
        multiplierBase: z.number().min(0),
        multiplierDivisor: z.number().positive(),
      })
      .strict(),
    weaknessBreak: z
      .object({
        /** Every Weakness Break delays the enemy's action by this fraction. */
        baseDelay: z.number().min(0).max(1),
        /** Super Break DMG = LevelMult x (toughnessReduced / divisor) x (1 + BE) x ... */
        superBreakDivisor: z.number().positive(),
        /** Broken enemies recover toughness at the start of their next turn. */
        recoverOnNextTurn: z.boolean(),
        /** Base chance of the break debuff (1.5 = 150%), before Effect Hit Rate / Effect RES / Debuff RES. */
        statusBaseChance: z.number().positive(),
        elements: PerElement(
          z
            .object({
              /** Break DMG = multiplier x LevelMult x MaxToughnessMult x (1 + BE) x DEF x RES x Vuln x Broken. */
              breakDmgMultiplier: z.number().positive(),
              /** Status inflicted on break (status effect id). */
              status: IdSchema,
              /** Additional action delay on break: extraDelay x (1 + Break Effect) when scalesWithBreakEffect. */
              extraDelay: z.number().min(0).default(0),
              scalesWithBreakEffect: z.boolean().default(false),
              summary: TextSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    effectHit: z.object({ minChance: z.number().min(0), maxChance: z.number().max(1) }).strict(),
    lightCone: z
      .object({
        /** The reference game lets any Path equip any Light Cone; only the passive requires a match. */
        equipRequiresMatchingPath: z.boolean(),
        passiveRequiresMatchingPath: z.boolean(),
        maxSuperimposition: z.number().int().positive(),
      })
      .strict(),
    party: z.object({ maxActive: z.number().int().positive(), maxEnemiesPerWave: z.number().int().positive() }).strict(),
    /**
     * Break / Super Break / break-DoT level multiplier, one entry per attacker level. Levels 1..80 are
     * required (character levels); 81..95 are enemy-only. The table must be contiguous and increasing;
     * nothing is interpolated.
     */
    levelMultiplier: z.record(z.string().regex(/^\d+$/), z.number().positive()),
    /** Where reference-game numbers in this file were verified. */
    sources: z.array(SourceSchema).default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    const levels = Object.keys(r.levelMultiplier)
      .map(Number)
      .sort((a, b) => a - b);
    const max = levels[levels.length - 1] ?? 0;
    if (levels[0] !== 1 || max < 80 || levels.length !== max) {
      ctx.addIssue({
        code: 'custom',
        path: ['levelMultiplier'],
        message: `levelMultiplier must list every level from 1 to at least 80 (got ${levels.length} entries up to Lv${max})`,
      });
    }
    for (let l = 2; l <= max; l++) {
      const prev = r.levelMultiplier[String(l - 1)];
      const cur = r.levelMultiplier[String(l)];
      if (prev !== undefined && cur !== undefined && cur <= prev) {
        ctx.addIssue({ code: 'custom', path: ['levelMultiplier', String(l)], message: `levelMultiplier must increase (Lv${l - 1} ${prev} >= Lv${l} ${cur})` });
      }
    }
  });
export type CombatRules = z.infer<typeof CombatRulesSchema>;

/**
 * Base-stat growth, matching the reference game's promotion data:
 *   stat(level, asc) = base x (1 + ascensionBonus[asc] + levelGrowth x (level - 1))
 * Characters: +0.05 x base per level and +0.4 x base per ascension phase.
 * Light Cones: +0.15 x base per level; cumulative ascension bonus 0, 1.2, 2.8, 4.4, 6.0, 7.6, 9.2 (x base),
 * i.e. every Light Cone reaches 22.05 x its Lv.1 stat at Lv.80 (48 HP -> 1058.4).
 */
const GrowthCurveSchema = z
  .object({
    levelGrowth: z.number().min(0),
    /** Cumulative bonus (in multiples of the Lv.1 base) for ascension phases 0..6. */
    ascensionBonus: z
      .array(z.number().min(0))
      .length(7)
      .refine((a) => a[0] === 0 && a.every((v, i) => i === 0 || v >= (a[i - 1] ?? 0)), 'ascensionBonus must start at 0 and never decrease'),
  })
  .strict();

export const ProgressionRulesSchema = z
  .object({
    id: IdSchema,
    maxLevel: z.number().int().positive(),
    /** Level cap for ascension phases 0..6. */
    levelCaps: z.array(z.number().int().positive()).length(7),
    character: GrowthCurveSchema,
    lightCone: GrowthCurveSchema,
    enemy: z.object({ hpPerLevel: z.number().min(0), atkPerLevel: z.number().min(0) }).strict(),
    /** Ascension phase required to unlock Major Traces A2/A4/A6. */
    majorTraceAscension: z.array(z.number().int().min(0).max(6)).length(3),
    eidolons: z.object({ max: z.number().int().positive() }).strict(),
    /** Natural (trace) max level per ability slot; Eidolon bonuses go above it. */
    abilityMaxLevel: z
      .object({
        basic: z.number().int().positive(),
        skill: z.number().int().positive(),
        ultimate: z.number().int().positive(),
        talent: z.number().int().positive(),
        memospriteSkill: z.number().int().positive(),
        memospriteTalent: z.number().int().positive(),
      })
      .strict(),
    /** Where reference-game numbers in this file were verified. */
    sources: z.array(SourceSchema).default([]),
  })
  .strict()
  .refine((p) => p.levelCaps.every((c, i, a) => i === 0 || c > (a[i - 1] ?? 0)), 'levelCaps must increase')
  .refine((p) => p.levelCaps[6] === p.maxLevel, 'last level cap must equal maxLevel');
export type ProgressionRules = z.infer<typeof ProgressionRulesSchema>;

export const ElementDefSchema = z
  .object({
    id: IdSchema,
    element: ElementSchema,
    name: TextSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    breakEffectName: TextSchema,
    description: TextSchema,
  })
  .strict();
export type ElementDef = z.infer<typeof ElementDefSchema>;

export const PathDefSchema = z
  .object({
    id: IdSchema,
    path: PathSchema,
    name: TextSchema,
    role: TextSchema,
    description: TextSchema,
    /** Base aggro: chance weight of being targeted by single-target enemy attacks. */
    baseAggro: z.number().positive(),
  })
  .strict();
export type PathDef = z.infer<typeof PathDefSchema>;

export const InputBindingsSchema = z
  .object({
    id: IdSchema,
    actions: z.record(
      z.string().regex(/^[a-z][A-Za-z0-9]*$/),
      z.object({ label: TextSchema, codes: z.array(z.string().min(1)).min(1), category: z.enum(['movement', 'camera', 'ui', 'combat', 'debug']) }).strict(),
    ),
  })
  .strict();
export type InputBindingsDef = z.infer<typeof InputBindingsSchema>;

export const LoadingTipSchema = z.object({ id: IdSchema, title: TextSchema, text: TextSchema }).strict();
export type LoadingTip = z.infer<typeof LoadingTipSchema>;
