import { z } from 'zod';
import { ElementSchema, IdSchema, TextSchema } from './common';
import { StatusModifierSchema, TriggerSchema } from './ability';

/**
 * Status effects: buffs, debuffs, DoTs, crowd control, shields and marks. Weakness Break side effects
 * (Bleed, Burn, Freeze, Shock, Wind Shear, Entanglement, Imprisonment) are ordinary status effects,
 * referenced from `rules/combat.json -> weaknessBreak.elements[*].status`.
 */
export const STATUS_KINDS = ['buff', 'debuff', 'neutral'] as const;
export const STATUS_CATEGORIES = ['stat', 'dot', 'cc', 'shield', 'mark', 'field', 'other'] as const;
export const CC_TYPES = ['freeze', 'entanglement', 'imprisonment', 'stun', 'dominated', 'taunt', 'outrage'] as const;
export const CcTypeSchema = z.enum(CC_TYPES);
export type CcType = z.infer<typeof CcTypeSchema>;

export const DOT_FORMULAS = [
  /** LevelMultiplier x levelMultiplier [x MaxToughnessMultiplier] [x stacks] - Burn, Shock, Wind Shear, Freeze, Entanglement. */
  'breakDot',
  /** min(maxHpRatio x enemy Max HP, capLevelMultiplier x LevelMultiplier x MaxToughnessMultiplier) - Bleed. */
  'breakBleed',
  /** multiplier x attacker stat - character-applied DoTs (e.g. a Skill's Shock). */
  'attackerScaled',
] as const;

export const DotSchema = z
  .object({
    element: ElementSchema,
    formula: z.enum(DOT_FORMULAS),
    levelMultiplier: z.number().positive().optional(),
    useToughnessMultiplier: z.boolean().optional(),
    perStack: z.boolean().optional(),
    maxHpRatio: z.object({ normal: z.number().positive(), elite: z.number().positive() }).strict().optional(),
    capLevelMultiplier: z.number().positive().optional(),
    stat: z.enum(['atk', 'hp', 'def']).optional(),
    multiplier: z.number().positive().optional(),
    /** When the damage is dealt. Freeze deals its damage when the frozen turn is skipped. */
    tickOn: z.enum(['ownerTurnStart', 'onExpire']).default('ownerTurnStart'),
    /**
     * How the damage is classified: a true DoT (Burn, Shock, Bleed, Wind Shear; boosted by DoT DMG%,
     * detonatable) or Additional DMG (Freeze on thaw, Entanglement on the target's turn).
     */
    damageType: z.enum(['dot', 'additional']).default('dot'),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.formula === 'breakDot' && d.levelMultiplier === undefined) {
      ctx.addIssue({ code: 'custom', message: 'breakDot requires levelMultiplier' });
    }
    if (d.formula === 'breakBleed' && (!d.maxHpRatio || d.capLevelMultiplier === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'breakBleed requires maxHpRatio and capLevelMultiplier' });
    }
    if (d.formula === 'attackerScaled' && (!d.stat || d.multiplier === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'attackerScaled requires stat and multiplier' });
    }
  });
export type Dot = z.infer<typeof DotSchema>;

export const CrowdControlSchema = z
  .object({
    type: CcTypeSchema,
    /** The affected unit cannot act; its turn is consumed. */
    skipsTurn: z.boolean(),
    /** Action delay applied when the effect ends (fraction of base AV). */
    delayOnExpire: z.number().min(0).max(1).optional(),
    /** Action advance applied when the effect ends. Freeze: the frozen turn is skipped, then the next action is Advanced Forward 50%. */
    advanceOnExpire: z.number().min(0).max(1).optional(),
  })
  .strict();

export const StatusEffectSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    description: TextSchema,
    kind: z.enum(STATUS_KINDS),
    category: z.enum(STATUS_CATEGORIES),
    dispellable: z.boolean(),
    maxStacks: z.number().int().positive().default(1),
    /** Stacks applied on the initial application by target rank (Wind Shear: 1 normal / 3 elite). */
    initialStacks: z.object({ normal: z.number().int().positive(), elite: z.number().int().positive() }).strict().optional(),
    duration: z
      .object({
        /** 0 = lasts until removed. */
        turns: z.number().int().min(0),
        /** Duration counts down on this event of the owner (or the caster for caster-bound buffs). */
        tickOn: z.enum(['ownerTurnStart', 'ownerTurnEnd', 'casterTurnStart', 'casterTurnEnd']),
      })
      .strict(),
    modifiers: z.array(StatusModifierSchema).default([]),
    triggers: z.array(TriggerSchema).default([]),
    dot: DotSchema.optional(),
    cc: CrowdControlSchema.optional(),
    presentation: z.object({ icon: z.string().optional(), vfx: z.string().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.category === 'dot' && !s.dot) ctx.addIssue({ code: 'custom', message: 'dot statuses need a "dot" block' });
    if (s.category === 'cc' && !s.cc) ctx.addIssue({ code: 'custom', message: 'cc statuses need a "cc" block' });
  });
export type StatusEffect = z.infer<typeof StatusEffectSchema>;
