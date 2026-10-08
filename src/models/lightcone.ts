import { z } from 'zod';
import { CostSchema, IdSchema, LightConeRaritySchema, PathSchema, SourceSchema, TextSchema } from './common';
import { paramRefsIn, SuperimposedModifierSchema, TriggerSchema } from './ability';
import { lightConeTemplateProblems } from './templates';

/**
 * Light Cone definition. Base stats are HP/ATK/DEF only; they are added to the character's base
 * stats before percentage bonuses apply. Any character may equip any Light Cone, but the passive
 * ("Light Cone ability") only works when the wearer's Path matches (`rules/combat.json -> lightCone`).
 * Passive values hold one entry per Superimposition rank S1..S5.
 *
 * Lv.1 base stats follow the reference tiers (5★ 48/26.4/21-style, 4★ 43.2/19.2/18-style,
 * 3★ 38.4/14.4/12-style); every Light Cone reaches 22.05x its Lv.1 stat at Lv.80 A6
 * (`rules/progression/default.json -> lightCone`).
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
        /**
         * Template (see `models/templates.ts`): `{0}`, `{1}` index the superimposed values of
         * `modifiers` in order, then `params` in key order; `{name}` names a `params` entry.
         */
        description: TextSchema,
        modifiers: z.array(SuperimposedModifierSchema).default([]),
        /** Conditional effects. applyStatus params may reference `params` with `{ "param": "name" }`. */
        triggers: z.array(TriggerSchema).default([]),
        /** Superimposed numbers (the reference game's #1..#n per S1..S5), referenced as `{ "param": "p1" }` and `{p1}`. */
        params: z.record(z.string(), z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])).default({}),
      })
      .strict(),
    ascensionCosts: z.array(CostSchema).length(6),
    /** EXP provided when used as enhancement fodder. */
    fodderExp: z.number().int().min(0),
    lore: TextSchema,
    /** Where the reference numbers were verified. */
    sources: z.array(SourceSchema).default([]),
  })
  .strict();
export type LightCone = z.infer<typeof LightConeSchema>;

/**
 * Semantic checks: placeholders resolve, `{ "param" }` references name a passive param, and no
 * param is dead data (each one is used by a modifier, a trigger or the description).
 */
export function validateLightCone(lc: LightCone): string[] {
  const problems = lightConeTemplateProblems(lc);
  const refs = new Set(paramRefsIn([lc.passive.modifiers, lc.passive.triggers]));
  for (const r of refs) if (!(r in lc.passive.params)) problems.push(`passive references unknown param "${r}"`);
  for (const p of Object.keys(lc.passive.params)) {
    if (!refs.has(p) && !lc.passive.description.includes(`{${p}}`)) problems.push(`passive param "${p}" is not used by any modifier, trigger or the description`);
  }
  return problems;
}

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
