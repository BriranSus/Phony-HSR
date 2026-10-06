import { z } from 'zod';

/** Lower-case dotted/dashed identifiers, e.g. "char.ignatius", "break.burn", "lc.ember-oath". */
export const IdSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'ids must be lower-case, dot/dash separated');
export type Id = z.infer<typeof IdSchema>;

/** Display text. Kept as plain strings in Phase 1; Phase 16 swaps in localisation keys. */
export const TextSchema = z.string().min(1);

export const ELEMENTS = ['Physical', 'Fire', 'Ice', 'Lightning', 'Wind', 'Quantum', 'Imaginary'] as const;
export const ElementSchema = z.enum(ELEMENTS);
export type Element = z.infer<typeof ElementSchema>;

/**
 * Paths (combat roles). New Paths introduced by future content are added here and in
 * `src/data/paths/paths.json`; nothing else in the engine enumerates them.
 */
export const PATHS = ['Destruction', 'Hunt', 'Erudition', 'Harmony', 'Nihility', 'Preservation', 'Abundance', 'Remembrance'] as const;
export const PathSchema = z.enum(PATHS);
export type Path = z.infer<typeof PathSchema>;

export const CharacterRaritySchema = z.union([z.literal(4), z.literal(5)]);
export const LightConeRaritySchema = z.union([z.literal(3), z.literal(4), z.literal(5)]);
export const RelicRaritySchema = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export const ItemRaritySchema = z.number().int().min(1).max(5);

/** Ascension (promotion) phase 0..6. Level caps per phase live in `rules/progression.json`. */
export const AscensionSchema = z.number().int().min(0).max(6);
export const LevelSchema = z.number().int().min(1).max(80);

/** Fractions, not percentages: 0.12 means 12%. */
export const FractionSchema = z.number().min(-10).max(10);

export const ItemStackSchema = z.object({
  item: IdSchema,
  count: z.number().int().positive(),
});
export type ItemStack = z.infer<typeof ItemStackSchema>;

/** Cost of one upgrade step (ascension, trace node level, ...). Credits are an item id too. */
export const CostSchema = z.array(ItemStackSchema);
export type Cost = z.infer<typeof CostSchema>;

/** Presentation hooks: animation, VFX, SFX, voice and camera cues resolved by their modules by id. */
export const PresentationHooksSchema = z
  .object({
    animation: z.string().optional(),
    vfx: z.array(z.string()).optional(),
    sfx: z.array(z.string()).optional(),
    voice: z.string().optional(),
    camera: z.string().optional(),
  })
  .strict();
export type PresentationHooks = z.infer<typeof PresentationHooksSchema>;
