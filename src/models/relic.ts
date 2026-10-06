import { z } from 'zod';
import { IdSchema, TextSchema } from './common';
import { StatModifierSchema, TriggerSchema } from './ability';
import { StatIdSchema } from './stats';

/**
 * Relics: four Cavern Relic slots (Head, Hands, Body, Feet) and two Planar Ornament slots
 * (Planar Sphere, Link Rope). Cavern sets have 2-piece and 4-piece bonuses; Planar sets have a
 * 2-piece bonus only. Main-stat growth and substat roll values are data (`relics/stat-tables`).
 */
export const CAVERN_SLOTS = ['head', 'hands', 'body', 'feet'] as const;
export const PLANAR_SLOTS = ['planarSphere', 'linkRope'] as const;
export const RELIC_SLOTS = [...CAVERN_SLOTS, ...PLANAR_SLOTS] as const;
export const RelicSlotSchema = z.enum(RELIC_SLOTS);
export type RelicSlot = z.infer<typeof RelicSlotSchema>;

export const RelicSetSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    kind: z.enum(['cavern', 'planar']),
    /** Piece names per slot. */
    pieces: z.partialRecord(RelicSlotSchema, TextSchema),
    bonuses: z
      .array(
        z
          .object({
            pieces: z.union([z.literal(2), z.literal(4)]),
            description: TextSchema,
            modifiers: z.array(StatModifierSchema).default([]),
            triggers: z.array(TriggerSchema).default([]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const slots = Object.keys(s.pieces).sort().join(',');
    const expected = (s.kind === 'cavern' ? [...CAVERN_SLOTS] : [...PLANAR_SLOTS]).sort().join(',');
    if (slots !== expected) ctx.addIssue({ code: 'custom', message: `${s.kind} sets must name exactly the slots ${expected} (got ${slots})` });
    const counts = s.bonuses.map((b) => b.pieces).sort().join(',');
    const expectedCounts = s.kind === 'cavern' ? '2,4' : '2';
    if (counts !== expectedCounts) ctx.addIssue({ code: 'custom', message: `${s.kind} sets need bonuses for ${expectedCounts} pieces (got ${counts})` });
  });
export type RelicSet = z.infer<typeof RelicSetSchema>;

const GrowthSchema = z.object({ base: z.number().positive(), step: z.number().min(0) }).strict();

export const RelicStatTablesSchema = z
  .object({
    id: IdSchema,
    /** Per rarity: max level, main stat growth (value = base + step * level) and substat roll tiers. */
    rarities: z.partialRecord(
      z.enum(['2', '3', '4', '5']),
      z
        .object({
          maxLevel: z.number().int().positive(),
          /** Substats are added/upgraded every N levels (3). */
          substatInterval: z.number().int().positive(),
          initialSubstats: z.object({ min: z.number().int().min(0), max: z.number().int().max(4), maxChance: z.number().min(0).max(1) }).strict(),
          mainStats: z.partialRecord(StatIdSchema, GrowthSchema),
          /** Roll value = base + step * tier, tier in {0 (low), 1 (mid), 2 (high)}. */
          subStats: z.partialRecord(StatIdSchema, GrowthSchema),
        })
        .strict(),
    ),
    /** Allowed main stats per slot with drop weights. */
    mainStatPools: z.record(RelicSlotSchema, z.partialRecord(StatIdSchema, z.number().positive())),
    /** Substat pool with weights; a substat cannot duplicate the main stat. */
    subStatPool: z.partialRecord(StatIdSchema, z.number().positive()),
    maxSubstats: z.number().int().positive(),
  })
  .strict();
export type RelicStatTables = z.infer<typeof RelicStatTablesSchema>;

/** Player-owned relic (saved). Substat value = sum over rolls of (base + step * tier). */
export interface RelicSubstat {
  readonly stat: z.infer<typeof StatIdSchema>;
  /** Number of times this substat rolled (1 when it appears, +1 per upgrade). */
  rolls: number;
  /** Sum of roll tiers (0..2 each). */
  tierSum: number;
}

export interface RelicInstance {
  readonly uid: string;
  readonly setId: string;
  readonly slot: RelicSlot;
  readonly rarity: 2 | 3 | 4 | 5;
  level: number;
  exp: number;
  readonly mainStat: z.infer<typeof StatIdSchema>;
  substats: RelicSubstat[];
  locked: boolean;
  /** Marked for salvage ("discard"). */
  discard: boolean;
  equippedBy: string | null;
}
