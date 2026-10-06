import { z } from 'zod';
import { CostSchema, IdSchema, LightConeRaritySchema, PathSchema, TextSchema } from './common';
import { SuperimposedModifierSchema, TriggerSchema } from './ability';

/**
 * Light Cone definition. Base stats are HP/ATK/DEF only; they are added to the character's base
 * stats before percentage bonuses apply. Any character may equip any Light Cone, but the passive
 * ("Light Cone ability") only works when the wearer's Path matches (`rules/combat.json -> lightCone`).
 * Passive values hold one entry per Superimposition rank S1..S5.
 */
export const LightConeSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    rarity: LightConeRaritySchema,
    path: PathSchema,
    baseStats: z.object({ hp: z.number().positive(), atk: z.number().positive(), def: z.number().positive() }).strict(),
    passive: z
      .object({
        name: TextSchema,
        /** Template; "{0}", "{1}" are replaced with the superimposed values of modifiers/params in order. */
        description: TextSchema,
        modifiers: z.array(SuperimposedModifierSchema).default([]),
        triggers: z.array(TriggerSchema).default([]),
        /** Extra superimposed numbers referenced by triggers/scripts. */
        params: z.record(z.string(), z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])).default({}),
      })
      .strict(),
    ascensionCosts: z.array(CostSchema).length(6),
    /** EXP provided when used as enhancement fodder. */
    fodderExp: z.number().int().min(0),
    lore: TextSchema,
  })
  .strict();
export type LightCone = z.infer<typeof LightConeSchema>;

/** Player-owned Light Cone (saved). */
export interface LightConeInstance {
  readonly uid: string;
  readonly lightConeId: string;
  level: number;
  ascension: number;
  exp: number;
  /** 1..5 (S1..S5). */
  superimposition: number;
  locked: boolean;
  equippedBy: string | null;
}
