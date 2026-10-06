import { z } from 'zod';
import { ElementSchema, IdSchema, PresentationHooksSchema, TextSchema } from './common';
import { LevelScaledSchema, SuperimposedSchema } from './scaling';
import { StatIdSchema } from './stats';

/**
 * Abilities are pure data interpreted by the skills module (Phase 5/6). A character kit is a list of
 * abilities whose `effects` are executed in order; anything a generic effect cannot express is
 * delegated to a registered script handler (`{ kind: "script", handler: "..." }`), so the combat
 * engine never needs to change when a character is added.
 */

/** Damage "type" tags used by DMG% bonuses, e.g. "+20% Follow-up ATK DMG", "DoT DMG". */
export const ATTACK_TYPES = [
  'basic',
  'skill',
  'ultimate',
  'followUp',
  'dot',
  'break',
  'superBreak',
  'additional',
  'technique',
  'memosprite',
] as const;
export const AttackTypeSchema = z.enum(ATTACK_TYPES);
export type AttackType = z.infer<typeof AttackTypeSchema>;

export const ABILITY_KINDS = [
  'basic',
  'skill',
  'ultimate',
  'talent',
  'technique',
  'enhancedBasic',
  'enhancedSkill',
  'followUp',
  'memospriteSkill',
  'memospriteTalent',
  'enemy',
] as const;
export const AbilityKindSchema = z.enum(ABILITY_KINDS);
export type AbilityKind = z.infer<typeof AbilityKindSchema>;

/** The short labels shown under an ability name in the character screen. */
export const ABILITY_TAGS = ['singleTarget', 'blast', 'aoe', 'bounce', 'enhance', 'support', 'defense', 'restore', 'impair', 'summon'] as const;
export const AbilityTagSchema = z.enum(ABILITY_TAGS);

/** What the player selects when using the ability. */
export const TARGETINGS = [
  'enemySingle',
  'enemyBlast',
  'enemyAll',
  'enemyBounce',
  'allySingle',
  'allyAll',
  'self',
  'none',
] as const;
export const TargetingSchema = z.enum(TARGETINGS);
export type Targeting = z.infer<typeof TargetingSchema>;

/**
 * Who an individual effect hits, relative to the selection. `primary` is the selected target of the
 * ability (an enemy or, for ally-targeted abilities, the ally); `memosprite` is the owner's
 * memosprite and `owner` is the memosprite's owner (used by memosprite abilities and talents).
 */
export const EFFECT_TARGETS = [
  'primary',
  'adjacent',
  'allEnemies',
  'randomEnemy',
  'self',
  'selectedAlly',
  'allAllies',
  'allAlliesExceptSelf',
  'attacker',
  'memosprite',
  'owner',
] as const;
export const EffectTargetSchema = z.enum(EFFECT_TARGETS);
export type EffectTarget = z.infer<typeof EffectTargetSchema>;

export const ScalingStatSchema = z.enum(['atk', 'hp', 'def']);

/** Reference to a named parameter of the owning definition (Light Cone `passive.params`, status `params`). */
export const ParamRefSchema = z.object({ param: z.string().min(1) }).strict();
export type ParamRef = z.infer<typeof ParamRefSchema>;

const DamageEffectSchema = z
  .object({
    kind: z.literal('damage'),
    target: EffectTargetSchema,
    stat: ScalingStatSchema,
    multiplier: LevelScaledSchema,
    /** Defaults to the owner's element. */
    element: ElementSchema.optional(),
    /** Toughness reduction against enemies weak to the element (10 = one Basic ATK). */
    toughness: z.number().min(0).default(0),
    /** Hit split for multi-hit attacks; fractions must sum to 1. Each hit can crit independently. */
    hitSplit: z.array(z.number().positive()).optional(),
    /** Bounce attacks: number of extra random hits. */
    bounces: z.number().int().positive().optional(),
    /** Overrides the ability's attack type (e.g. a Skill that deals Follow-up DMG). */
    attackType: AttackTypeSchema.optional(),
  })
  .strict();

const HealEffectSchema = z
  .object({
    kind: z.literal('heal'),
    target: EffectTargetSchema,
    stat: ScalingStatSchema,
    multiplier: LevelScaledSchema,
    flat: LevelScaledSchema.optional(),
  })
  .strict();

const ShieldEffectSchema = z
  .object({
    kind: z.literal('shield'),
    target: EffectTargetSchema,
    stat: ScalingStatSchema,
    multiplier: LevelScaledSchema,
    flat: LevelScaledSchema.optional(),
    duration: z.number().int().positive(),
  })
  .strict();

const ApplyStatusEffectSchema = z
  .object({
    kind: z.literal('applyStatus'),
    target: EffectTargetSchema,
    status: IdSchema,
    /** Base chance (affected by Effect Hit Rate / Effect RES). Omit for buffs or guaranteed effects. */
    baseChance: LevelScaledSchema.optional(),
    /** Fixed chance ignores Effect Hit Rate and Effect RES. */
    fixedChance: z.boolean().optional(),
    duration: z.number().int().positive().optional(),
    stacks: z.number().int().positive().optional(),
    /**
     * Values substituted into the status effect's modifiers (e.g. the ATK% of a buff at this level).
     * `{ "param": "name" }` takes the value from the owning definition's own params instead, e.g. a
     * Light Cone passive's superimposed `params` at the equipped Superimposition rank.
     */
    params: z.record(z.string(), z.union([LevelScaledSchema, ParamRefSchema])).optional(),
  })
  .strict();

const DispelEffectSchema = z
  .object({
    kind: z.literal('dispel'),
    target: EffectTargetSchema,
    statusKind: z.enum(['buff', 'debuff']),
    count: z.number().int().positive(),
  })
  .strict();

const EnergyEffectSchema = z
  .object({
    kind: z.literal('energy'),
    target: EffectTargetSchema,
    amount: z.number(),
    /** Fixed energy ignores Energy Regeneration Rate. */
    fixed: z.boolean().optional(),
  })
  .strict();

/**
 * Charges a points-based Ultimate (characters whose `ultimate.resource` is `points`, e.g. stacks
 * gained from allies' Skills instead of Energy). Energy-based Ultimates use the `energy` effect.
 */
const UltimatePointsEffectSchema = z
  .object({
    kind: z.literal('ultimatePoints'),
    target: EffectTargetSchema,
    amount: z.number().int(),
  })
  .strict();

const SkillPointEffectSchema = z.object({ kind: z.literal('skillPoints'), amount: z.number().int() }).strict();

const ActionAdvanceEffectSchema = z
  .object({
    kind: z.literal('actionAdvance'),
    target: EffectTargetSchema,
    /** Fraction of the base action value: 0.25 = Action Advanced by 25%; negative values delay. */
    fraction: z.number().min(-1).max(1),
  })
  .strict();

const SummonEffectSchema = z
  .object({
    kind: z.literal('summon'),
    /** Memosprite id (from the owner's definition) or enemy id (boss summons). */
    unit: IdSchema,
    unitType: z.enum(['memosprite', 'enemy']),
  })
  .strict();

const ScriptEffectSchema = z
  .object({
    kind: z.literal('script'),
    /** Id of a handler registered by the skills module for character-specific mechanics. */
    handler: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const EffectSchema = z.discriminatedUnion('kind', [
  DamageEffectSchema,
  HealEffectSchema,
  ShieldEffectSchema,
  ApplyStatusEffectSchema,
  DispelEffectSchema,
  EnergyEffectSchema,
  UltimatePointsEffectSchema,
  SkillPointEffectSchema,
  ActionAdvanceEffectSchema,
  SummonEffectSchema,
  ScriptEffectSchema,
]);
export type Effect = z.infer<typeof EffectSchema>;

/** Names of `{ "param": ... }` references used by applyStatus effects. */
export function paramRefsOf(effects: readonly Effect[]): string[] {
  return effects.flatMap((e) =>
    e.kind === 'applyStatus' ? Object.values(e.params ?? {}).flatMap((v) => (typeof v === 'object' && 'param' in v ? [v.param] : [])) : [],
  );
}

/**
 * Combat events that talents, traces, eidolons, light cones, relic sets and statuses can react to.
 * "Owner" is the unit that carries the trigger (the wearer for equipment).
 *
 * - `battleStart` / `waveStart`: once per battle / per wave, before the first turn.
 * - `onEnterBattleField`: the owner enters the field (battle start, a memosprite being summoned, a
 *   revived ally re-entering). Fires before `battleStart` handlers of other units see it.
 * - `turnStart` / `turnEnd`: the owner's own turn (extra turns included).
 * - `beforeAttack` / `afterAttack`: around any attack by the owner (Basic, Skill, Ultimate, Follow-up).
 * - `afterUseBasic` / `afterUseSkill` / `afterUseUltimate`: after the owner uses that ability, whether
 *   or not it deals damage (e.g. a buff-only Ultimate still fires `afterUseUltimate`).
 * - `onFollowUp`: the owner performs a follow-up attack or counter (an inserted action).
 * - `afterBeingHit`: the owner is hit by an enemy attack.
 * - `afterAllyAttack`: another ally (memosprites included) finishes an attack.
 * - `afterAllyHit`: another ally is hit by an enemy attack (counters, "when an ally is attacked").
 * - `afterAllyUsesUltimate`: another ally uses their Ultimate.
 * - `onMemospriteSummoned` / `onMemospriteLeave`: the owner's memosprite is summoned / leaves the field.
 * - `onKill`, `onWeaknessBreak`, `onDebuffApplied`, `onEnemyDefeated`, `onHpChanged`, `onShieldBroken`.
 */
export const TRIGGER_EVENTS = [
  'battleStart',
  'waveStart',
  'onEnterBattleField',
  'turnStart',
  'turnEnd',
  'beforeAttack',
  'afterAttack',
  'afterUseBasic',
  'afterUseSkill',
  'afterUseUltimate',
  'onFollowUp',
  'afterBeingHit',
  'afterAllyAttack',
  'afterAllyHit',
  'afterAllyUsesUltimate',
  'onMemospriteSummoned',
  'onMemospriteLeave',
  'onKill',
  'onWeaknessBreak',
  'onDebuffApplied',
  'onEnemyDefeated',
  'onHpChanged',
  'onShieldBroken',
] as const;
export const TriggerEventSchema = z.enum(TRIGGER_EVENTS);
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

/**
 * Condition types understood by the combat engine's condition registry (Phase 5). A closed list, so
 * a typo in data fails at load time instead of silently never matching.
 *
 * - `attackType { is }`: the triggering attack has this attack type.
 * - `attackerHasStatus { status }` / `targetHasStatus { status }` / `hasStatus { status }` (the unit receiving a modifier).
 * - `attackerIsOwnMemosprite`: the triggering unit is the owner's memosprite.
 * - `sourceIsMemosprite`: the damage source is a memosprite (for DMG% modifiers).
 * - `memospriteOnField`: the owner's memosprite is currently on the field.
 * - `targetHasShield`: the triggering ally / target currently has a Shield.
 * - `abilityTargetsAlly`: the triggering ability was used on an ally (Courier 4pc, Harmony cones).
 * - `hpBelow { ratio }` / `statAtLeast { stat, value }`: the owner's current HP ratio / panel stat.
 */
export const CONDITION_TYPES = [
  'attackType',
  'attackerHasStatus',
  'attackerIsOwnMemosprite',
  'sourceIsMemosprite',
  'memospriteOnField',
  'hasStatus',
  'targetHasStatus',
  'targetHasShield',
  'abilityTargetsAlly',
  'hpBelow',
  'statAtLeast',
] as const;
export const ConditionTypeSchema = z.enum(CONDITION_TYPES);
export type ConditionType = z.infer<typeof ConditionTypeSchema>;

/** Structured condition evaluated by the combat engine's condition registry (Phase 5). */
export const ConditionSchema = z
  .object({
    type: ConditionTypeSchema,
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type Condition = z.infer<typeof ConditionSchema>;

export const TriggerSchema = z
  .object({
    on: TriggerEventSchema,
    conditions: z.array(ConditionSchema).optional(),
    effects: z.array(EffectSchema).min(1),
    /** Max activations per owner turn (0 = unlimited). */
    limitPerTurn: z.number().int().min(0).optional(),
  })
  .strict();
export type Trigger = z.infer<typeof TriggerSchema>;

/** A stat change. `scope` decides who receives it (self, whole team, all enemies). */
function modifierSchema<V extends z.ZodType>(value: V) {
  return z
    .object({
      stat: StatIdSchema,
      value,
      scope: z.enum(['self', 'team', 'teamExceptSelf', 'allEnemies']).default('self'),
      conditions: z.array(ConditionSchema).optional(),
    })
    .strict();
}

export const StatModifierSchema = modifierSchema(LevelScaledSchema);
export type StatModifier = z.infer<typeof StatModifierSchema>;

/**
 * Status-effect modifiers may take their value from the applying effect's `params`
 * (`{ "param": "atkPct" }`), so one status definition serves every ability level.
 */
export const StatusModifierSchema = modifierSchema(z.union([LevelScaledSchema, z.object({ param: z.string().min(1) }).strict()]));
export type StatusModifier = z.infer<typeof StatusModifierSchema>;

/** Light Cone passive modifiers hold one value per Superimposition rank. */
export const SuperimposedModifierSchema = modifierSchema(SuperimposedSchema);
export type SuperimposedModifier = z.infer<typeof SuperimposedModifierSchema>;

export const AbilitySchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    kind: AbilityKindSchema,
    tags: z.array(AbilityTagSchema).default([]),
    targeting: TargetingSchema,
    /** Natural max level from traces (Basic 6, others 10). Eidolons add bonus levels. */
    maxLevel: z.number().int().min(1).max(15),
    /** Description template; {name} placeholders are filled from effect values at the current level. */
    description: TextSchema,
    /** Skill Points consumed (Skill: 1). */
    spCost: z.number().int().min(0).default(0),
    /** Skill Points generated (Basic ATK: 1). */
    spGain: z.number().int().min(0).default(0),
    /** Energy regenerated on use, before Energy Regeneration Rate (Basic 20, Skill 30, Ultimate 5). */
    energyGain: z.number().min(0).default(0),
    /** Technique Points consumed outside combat (Technique: 1). */
    techniquePointCost: z.number().int().min(0).default(0),
    effects: z.array(EffectSchema).default([]),
    triggers: z.array(TriggerSchema).default([]),
    modifiers: z.array(StatModifierSchema).default([]),
    presentation: PresentationHooksSchema.optional(),
  })
  .strict();
export type Ability = z.infer<typeof AbilitySchema>;
