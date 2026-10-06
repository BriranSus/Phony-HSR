import { z } from 'zod';
import { IdSchema } from './common';

/**
 * Ability values that scale with ability level.
 *
 * - a plain number: constant
 * - `{ curve, ref }`: standard growth curve from `rules/scaling-curves.json`, where `ref` is the value
 *   at the curve's reference level (Lv.6 for Basic ATK, Lv.10 for Skill/Ultimate/Talent).
 *   Example: `{ "curve": "standard", "ref": 2.0 }` -> 100% at Lv.1, 200% at Lv.10, 220% at Lv.12.
 * - `{ table }`: explicit per-level table for values that do not follow a standard curve.
 */
export const LevelScaledSchema = z.union([
  z.number(),
  z.object({ curve: IdSchema, ref: z.number() }).strict(),
  z.object({ table: z.array(z.number()).min(1) }).strict(),
]);
export type LevelScaled = z.infer<typeof LevelScaledSchema>;

/** Light Cone passive values for Superimposition S1..S5. */
export const SuperimposedSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]);
export type Superimposed = z.infer<typeof SuperimposedSchema>;

export const ScalingCurvesSchema = z
  .object({
    id: IdSchema,
    curves: z.record(
      z.string(),
      z.object({
        /** Level at which the ratio is 1.0 (where `ref` is specified). */
        refLevel: z.number().int().positive(),
        /** Ratio per level, index 0 = Lv.1. */
        ratios: z.array(z.number().positive()).min(1),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    for (const [name, c] of Object.entries(v.curves)) {
      const r = c.ratios[c.refLevel - 1];
      if (r === undefined || Math.abs(r - 1) > 1e-9) {
        ctx.addIssue({ code: 'custom', message: `curve "${name}" must have ratio 1.0 at refLevel ${c.refLevel}` });
      }
    }
  });
export type ScalingCurves = z.infer<typeof ScalingCurvesSchema>;
