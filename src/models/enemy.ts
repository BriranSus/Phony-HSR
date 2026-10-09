import { z } from 'zod';
import { ElementSchema, IdSchema, PresentationHooksSchema, SourceSchema, TextSchema } from './common';
import { AbilityBaseSchema, checkAbilityParams, ConditionSchema, EffectSchema } from './ability';
import { CC_TYPES } from './status';
import { abilityTemplateSlots, templateProblems } from './templates';

export const ENEMY_RANKS = ['normal', 'elite', 'boss', 'weeklyBoss', 'storyBoss', 'event'] as const;
export const EnemyRankSchema = z.enum(ENEMY_RANKS);
export type EnemyRank = z.infer<typeof EnemyRankSchema>;

/** Ranks that count as "Elite or higher" for break formulas (Bleed HP%, Wind Shear stacks). */
export const ELITE_OR_HIGHER: ReadonlySet<EnemyRank> = new Set<EnemyRank>(['elite', 'boss', 'weeklyBoss', 'storyBoss']);

export const EnemyAbilitySchema = AbilityBaseSchema.extend({
  kind: z.literal('enemy'),
  /** Energy the hit character regenerates (before ERR), e.g. 10 for a single-target hit. */
  energyToTarget: z.number().min(0).default(10),
  /** AI selection weight within the current phase. */
  aiWeight: z.number().min(0).default(1),
  /** Turns before the ability can be used again. */
  cooldown: z.number().int().min(0).default(0),
  /** Multi-turn charge-ups: telegraph for N turns before release (boss mechanics). */
  chargeTurns: z.number().int().min(0).default(0),
})
  .strict()
  .superRefine(checkAbilityParams);
export type EnemyAbility = z.infer<typeof EnemyAbilitySchema>;

/** Debuffs an enemy can resist: Crowd Control types plus the break DoTs (Flamespawn resists Burn). */
export const DEBUFF_RES_KEYS = [...CC_TYPES, 'burn', 'shock', 'bleed', 'windShear'] as const;
export const DebuffResKeySchema = z.enum(DEBUFF_RES_KEYS);

export const EnemyPhaseSchema = z
  .object({
    id: IdSchema,
    /**
     * Phase starts when HP fraction drops to or below this value (1 = initial phase). With
     * `restoreHpTo`, 0 means "when the previous phase's HP bar is depleted" (multi-bar bosses).
     */
    hpThreshold: z.number().min(0).max(1),
    /** HP set to this fraction of Max HP when the phase starts (Cocolia phase 2: 0.75, i.e. Max HP reduced by 25%). */
    restoreHpTo: z.number().min(0).max(1).optional(),
    /** Overrides for the phase (bosses can change weaknesses / toughness between phases). */
    toughness: z.number().positive().optional(),
    weaknesses: z.array(ElementSchema).optional(),
    abilities: z.array(IdSchema).min(1),
    onEnter: z.array(EffectSchema).default([]),
    /** Units summoned when the phase begins. */
    summons: z.array(IdSchema).default([]),
  })
  .strict();

export const EnemySchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    rank: EnemyRankSchema,
    faction: TextSchema,
    /**
     * Template stats before level scaling (reference-game `HPBase x HPModifyRatio x EliteGroup` etc.).
     * Stat at level L = base x the level curve in `rules/progression/default.json -> enemy.levels[L]`.
     * DEF comes from combat rules (200 + 10 x level).
     */
    baseStats: z
      .object({
        hp: z.number().positive(),
        atk: z.number().positive(),
        spd: z.number().positive(),
        effectHitRate: z.number().min(0).default(0),
        effectRes: z.number().min(0).default(0),
      })
      .strict(),
    /** Max Toughness (Basic ATK of a matching element reduces 10; reference stance / 3). */
    toughness: z.number().positive(),
    weaknesses: z.array(ElementSchema).min(1),
    /**
     * Elemental RES overrides. Unlisted elements use rules defaults (20%, or 0% if the enemy is weak to it).
     */
    resistances: z.partialRecord(ElementSchema, z.number().min(-1).max(1)).default({}),
    /** Resistance against specific crowd control (e.g. bosses resist Freeze). */
    debuffRes: z.partialRecord(DebuffResKeySchema, z.number().min(0).max(1)).default({}),
    abilities: z.array(EnemyAbilitySchema).min(1),
    ai: z
      .object({
        pattern: z.enum(['sequence', 'weighted', 'script']),
        /** For "sequence": ability ids in repeating order. */
        sequence: z.array(IdSchema).optional(),
        script: z.string().optional(),
        conditions: z.array(ConditionSchema).optional(),
      })
      .strict(),
    phases: z.array(EnemyPhaseSchema).default([]),
    lootTable: IdSchema.optional(),
    /** Short in-game description. */
    description: TextSchema.optional(),
    /** Where the reference numbers were verified (datamine ids). */
    sources: z.array(SourceSchema).default([]),
    presentation: z
      .object({
        model: z.string(),
        scale: z.number().positive().default(1),
        hooks: PresentationHooksSchema.optional(),
        /** Boss-specific UI and music cues (Phase 7/22). */
        bossBar: z.boolean().default(false),
        music: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type Enemy = z.infer<typeof EnemySchema>;

export function validateEnemy(e: Enemy): string[] {
  const problems: string[] = [];
  const abilityIds = new Set(e.abilities.map((a) => a.id));
  for (const id of e.ai.sequence ?? []) if (!abilityIds.has(id)) problems.push(`ai.sequence references unknown ability "${id}"`);
  for (const p of e.phases) for (const id of p.abilities) if (!abilityIds.has(id)) problems.push(`phase "${p.id}" references unknown ability "${id}"`);
  for (const a of e.abilities) for (const p of templateProblems(a.description, abilityTemplateSlots(a))) problems.push(`${a.id}: description placeholder ${p} does not resolve`);
  for (const w of e.weaknesses) {
    const res = e.resistances[w];
    if (res !== undefined && res > 0) problems.push(`enemy is weak to ${w} but has positive ${w} RES`);
  }
  if (e.ai.pattern === 'sequence' && !e.ai.sequence?.length) problems.push('ai.pattern "sequence" needs ai.sequence');
  if ((e.rank === 'boss' || e.rank === 'weeklyBoss' || e.rank === 'storyBoss') && e.phases.length === 0) {
    problems.push('bosses must define at least one phase');
  }
  return problems;
}

export const LootTableSchema = z
  .object({
    id: IdSchema,
    entries: z
      .array(
        z
          .object({
            item: IdSchema,
            min: z.number().int().min(0),
            max: z.number().int().min(0),
            chance: z.number().min(0).max(1),
          })
          .strict()
          .refine((e) => e.max >= e.min, 'max must be >= min'),
      )
      .min(1),
  })
  .strict();
export type LootTable = z.infer<typeof LootTableSchema>;
