import { z } from 'zod';
import { CostSchema, IdSchema, ItemRaritySchema, TextSchema } from './common';

/** Reusable upgrade cost ladders (trace levels, ascensions...), shared by many characters. */
export const CostTableSchema = z
  .object({
    id: IdSchema,
    description: z.string().min(1),
    /** steps[i] = cost of upgrade step i+1. */
    steps: z.array(CostSchema).min(1),
  })
  .strict();
export type CostTable = z.infer<typeof CostTableSchema>;

/** Inventory item categories (materials, consumables, currencies...). Relics and Light Cones are instances, not stacks. */
export const ITEM_CATEGORIES = [
  'currency',
  'premiumCurrency',
  'warpPass',
  'characterExp',
  'lightConeExp',
  'relicExp',
  'ascension',
  'trace',
  'eidolon',
  'consumable',
  'quest',
  'event',
  'misc',
] as const;
export const ItemCategorySchema = z.enum(ITEM_CATEGORIES);
export type ItemCategory = z.infer<typeof ItemCategorySchema>;

export const ItemSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    category: ItemCategorySchema,
    rarity: ItemRaritySchema,
    description: TextSchema,
    maxStack: z.number().int().positive(),
    /** EXP granted when consumed (EXP materials). */
    exp: z.number().int().positive().optional(),
    /** Consumable effect handler id (Phase 12). */
    use: z.string().optional(),
    /** Hidden from the inventory UI (e.g. account-level currencies shown in the top bar). */
    hidden: z.boolean().default(false),
  })
  .strict()
  .superRefine((i, ctx) => {
    if ((i.category === 'characterExp' || i.category === 'lightConeExp' || i.category === 'relicExp') && i.exp === undefined) {
      ctx.addIssue({ code: 'custom', message: 'EXP materials need "exp"' });
    }
  });
export type Item = z.infer<typeof ItemSchema>;

/**
 * A documented script handler: behaviour that is not expressible as generic effects (unique kit
 * mechanics). Data may only reference handlers listed here; the skills module (Phase 5) registers
 * an implementation for each id.
 */
export const ScriptHandlerSchema = z
  .object({
    id: IdSchema,
    /** Roadmap phase that implements the handler. */
    phase: z.number().int().positive(),
    description: TextSchema,
  })
  .strict();
export type ScriptHandler = z.infer<typeof ScriptHandlerSchema>;
