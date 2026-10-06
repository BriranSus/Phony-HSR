import { z } from 'zod';
import { CostSchema, IdSchema, LightConeRaritySchema, PathSchema, TextSchema } from './common';
import { paramRefsOf, SuperimposedModifierSchema, TriggerSchema } from './ability';
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
        /** Extra superimposed numbers referenced by triggers (every entry must be used by one). */
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

/** Semantic checks: placeholders resolve, trigger param references exist, and no param is dead data. */
export function validateLightCone(lc: LightCone): string[] {
  const problems = lightConeTemplateProblems(lc);
  const refs = new Set(paramRefsOf(lc.passive.triggers.flatMap((t) => t.effects)));
  for (const r of refs) if (!(r in lc.passive.params)) problems.push(`trigger references unknown passive param "${r}"`);
  for (const p of Object.keys(lc.passive.params)) if (!refs.has(p)) problems.push(`passive param "${p}" is not used by any trigger`);
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
