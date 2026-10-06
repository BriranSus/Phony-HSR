import { z } from 'zod';
import { ElementSchema, IdSchema, PathSchema, TextSchema } from './common';

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
    /** Break-damage level multiplier anchors (attacker level -> multiplier). Phase 8 completes the table. */
    levelMultiplier: z.record(z.string().regex(/^\d+$/), z.number().positive()),
  })
  .strict();
export type CombatRules = z.infer<typeof CombatRulesSchema>;

const GrowthCurveSchema = z
  .object({
    /** stat(level, asc) = base * (1 + ascensionStep * asc) + base * levelGrowth * (level - 1) */
    levelGrowth: z.number().min(0),
    ascensionStep: z.number().min(0),
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
    abilityMaxLevel: z.object({ basic: z.number().int(), skill: z.number().int(), ultimate: z.number().int(), talent: z.number().int() }).strict(),
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
