import { z } from 'zod';
import { IdSchema, TextSchema } from './common';

/**
 * Warp banner definition. Rates and pity are data; the roll itself lives in the gacha module
 * (Phase 17) and would be server-authoritative if an online backend existed.
 */
export const BannerSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    type: z.enum(['character', 'lightCone', 'standard', 'beginner']),
    cost: z.object({ item: IdSchema, count: z.number().int().positive() }).strict(),
    /** Pity counters are shared between banners in the same group (all limited character banners share one). */
    pityGroup: IdSchema,
    rates: z
      .object({
        fiveStar: z.number().min(0).max(1),
        fourStar: z.number().min(0).max(1),
      })
      .strict(),
    pity: z
      .object({
        fiveStarHard: z.number().int().positive(),
        /** Pull number (1-based) from which the 5-star rate increases each pull. */
        fiveStarSoftStart: z.number().int().positive(),
        fiveStarSoftIncrement: z.number().min(0),
        fourStarHard: z.number().int().positive(),
      })
      .strict()
      .refine((p) => p.fiveStarSoftStart < p.fiveStarHard, 'soft pity must start before hard pity'),
    featured: z
      .object({
        fiveStar: z.array(IdSchema),
        fourStar: z.array(IdSchema),
        /** Chance the 5-star is the featured one when not guaranteed (character 0.5, Light Cone 0.75). */
        fiveStarChance: z.number().min(0).max(1),
        fourStarChance: z.number().min(0).max(1),
        /** Losing the featured roll guarantees the next one. */
        guaranteeAfterLoss: z.boolean(),
      })
      .strict(),
    pools: z
      .object({
        fiveStar: z.array(IdSchema).min(1),
        fourStar: z.array(IdSchema).min(1),
        threeStar: z.array(IdSchema).min(1),
      })
      .strict(),
    tenPullDiscount: z.number().int().min(0).default(0),
  })
  .strict();
export type Banner = z.infer<typeof BannerSchema>;

/** Persistent pity state per pity group (saved). */
export interface PityState {
  pullsSinceFiveStar: number;
  pullsSinceFourStar: number;
  fiveStarGuaranteed: boolean;
  fourStarGuaranteed: boolean;
}
