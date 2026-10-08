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
  'summon',
  'lowestHpAlly',
  'randomAlly',
] as const;
export const EffectTargetSchema = z.enum(EFFECT_TARGETS);
export type EffectTarget = z.infer<typeof EffectTargetSchema>;

export const ScalingStatSchema = z.enum(['atk', 'hp', 'def']);

/**
 * Reference to a named parameter of the owning definition: an ability's per-level `params` table,
 * a Light Cone passive's superimposed `params`, or (inside a status) the applying effect's params.
 */
export const ParamRefSchema = z
  .object({
    param: z.string().min(1),
    /** Read the param from another ability slot of the same character (e.g. Seele's Ultimate grants the Talent's buff). */
    from: z.enum(['basic', 'skill', 'ultimate', 'talent', 'technique']).optional(),
  })
  .strict();
export type ParamRef = z.infer<typeof ParamRefSchema>;

/** A number that is constant, level-scaled, or taken from the owner's `params` by name. */
export const ValueSchema = z.union([LevelScaledSchema, ParamRefSchema]);
export type Value = z.infer<typeof ValueSchema>;

/** Which unit's stats an effect scales from (e.g. the Trailblazer's Ultimate makes Mem deal DMG from Mem's ATK). */
export const ScalingSourceSchema = z.enum(['self', 'memosprite', 'owner']);

const DamageEffectSchema = z
  .object({
    kind: z.literal('damage'),
    target: EffectTargetSchema,
    stat: ScalingStatSchema,
    multiplier: ValueSchema,
    /** Extra scaling terms added to the base (e.g. Blade: % ATK + % Max HP). */
    extraScaling: z.array(z.object({ stat: ScalingStatSchema, multiplier: ValueSchema }).strict()).optional(),
    /** Whose stats the DMG scales from. Defaults to the acting unit. */
    source: ScalingSourceSchema.default('self'),
    /** Defaults to the owner's element. */
    element: ElementSchema.optional(),
    /** Toughness reduction against enemies weak to the element (10 = one Basic ATK). */
    toughness: z.number().min(0).default(0),
    /** Reduces toughness even without a matching Weakness (e.g. some Techniques). */
    ignoresWeakness: z.boolean().optional(),
    /** Hit split for multi-hit attacks; fractions must sum to 1. Each hit can crit independently. */
    hitSplit: z.array(z.number().positive()).optional(),
    /** Bounce attacks: number of extra random hits. */
    bounces: ValueSchema.optional(),
    /** Repeat the hit once per stack of the acting unit's custom resource (Lightning-Lord's Hits Per Action). */
    repeat: z.object({ resource: IdSchema }).strict().optional(),
    /** Overrides the ability's attack type (e.g. a Skill that deals Follow-up DMG). */
    attackType: AttackTypeSchema.optional(),
    /** Only hits targets meeting these conditions (Clara's Skill: enemies with a Mark of Counter). */
    targetConditions: z.array(z.lazy(() => ConditionSchema)).optional(),
  })
  .strict();

/** Removes every instance of a status from the targets (Clara's Skill clears Marks of Counter). */
const RemoveStatusEffectSchema = z
  .object({
    kind: z.literal('removeStatus'),
    target: EffectTargetSchema,
    status: IdSchema,
  })
  .strict();

const HealEffectSchema = z
  .object({
    kind: z.literal('heal'),
    target: EffectTargetSchema,
    stat: ScalingStatSchema,
    multiplier: ValueSchema,
    flat: ValueSchema.optional(),
    /** Follow-up heals on random allies, each reduced by `decay` (Bailu's Skill). */
    repeats: z.object({ count: ValueSchema, decay: ValueSchema }).strict().optional(),
  })
  .strict();

const ShieldEffectSchema = z
  .object({
    kind: z.literal('shield'),
    target: EffectTargetSchema,
    stat: ScalingStatSchema,
    multiplier: ValueSchema,
    flat: ValueSchema.optional(),
    duration: ValueSchema,
  })
  .strict();

const ApplyStatusEffectSchema = z
  .object({
    kind: z.literal('applyStatus'),
    target: EffectTargetSchema,
    status: IdSchema,
    /** Base chance (affected by Effect Hit Rate / Effect RES). Omit for buffs or guaranteed effects. */
    baseChance: ValueSchema.optional(),
    /** Fixed chance ignores Effect Hit Rate and Effect RES. */
    fixedChance: z.boolean().optional(),
    duration: ValueSchema.optional(),
    stacks: z.number().int().positive().optional(),
    /** Values substituted into the status effect's `{ "param": ... }` modifiers, DoT and heal blocks. */
    params: z.record(z.string(), ValueSchema).optional(),
    targetConditions: z.array(z.lazy(() => ConditionSchema)).optional(),
  })
  .strict();

/** Applies one status picked at random from `pool` (Silver Wolf's Bugs). */
const ApplyRandomStatusEffectSchema = z
  .object({
    kind: z.literal('applyRandomStatus'),
    target: EffectTargetSchema,
    pool: z.array(IdSchema).min(2),
    baseChance: ValueSchema.optional(),
    duration: ValueSchema.optional(),
    params: z.record(z.string(), ValueSchema).optional(),
  })
  .strict();

const DispelEffectSchema = z
  .object({
    kind: z.literal('dispel'),
    target: EffectTargetSchema,
    statusKind: z.enum(['buff', 'debuff']),
    count: ValueSchema,
    /** Only statuses of this category (e.g. Crowd Control). */
    category: z.enum(['cc']).optional(),
  })
  .strict();

const EnergyEffectSchema = z
  .object({
    kind: z.literal('energy'),
    target: EffectTargetSchema,
    amount: ValueSchema,
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

/** Changes a unit's custom resource (Himeko/Blade Charge, Lightning-Lord Hits Per Action, Mem's Charge). */
const GainResourceEffectSchema = z
  .object({
    kind: z.literal('gainResource'),
    target: EffectTargetSchema,
    resource: IdSchema,
    amount: ValueSchema,
    /** `untilNextAction`: the gain is removed after the unit's next action (Jing Yuan's Skill/Ultimate). */
    duration: z.enum(['permanent', 'untilNextAction']).default('permanent'),
  })
  .strict();

const SkillPointEffectSchema = z.object({ kind: z.literal('skillPoints'), amount: z.number().int() }).strict();

const ActionAdvanceEffectSchema = z
  .object({
    kind: z.literal('actionAdvance'),
    target: EffectTargetSchema,
    /** Fraction of the base action value: 0.25 = Action Advanced by 25%; negative values delay. 1 = act immediately. */
    fraction: ValueSchema,
    /** Treat `fraction` as an Action Delay (reference params are positive magnitudes). */
    delay: z.boolean().optional(),
  })
  .strict();

const SummonEffectSchema = z
  .object({
    kind: z.literal('summon'),
    /** Memosprite or summon id (from the owner's definition), or enemy id (boss summons). */
    unit: IdSchema,
    unitType: z.enum(['memosprite', 'summon', 'enemy']),
  })
  .strict();

/** Consumes or sets HP (Blade). Consumption never knocks the unit down: HP stops at 1. */
const HpChangeEffectSchema = z
  .object({
    kind: z.literal('hpChange'),
    target: EffectTargetSchema,
    mode: z.enum(['consume', 'setTo']),
    /** Fraction of Max HP. */
    ratio: ValueSchema,
  })
  .strict();

/**
 * Queues an inserted action (follow-up, counter, extra turn or an immediate memosprite/summon
 * action) into `BattleState.insertedActions`.
 */
const InsertActionEffectSchema = z
  .object({
    kind: z.literal('insertAction'),
    action: z.enum(['followUp', 'counter', 'extraTurn', 'memospriteAction']),
    /** Who acts. */
    actor: z.enum(['self', 'memosprite', 'owner', 'summon']).default('self'),
    /** Ability id to execute (omitted for an extra turn). */
    ability: IdSchema.optional(),
    /** Fixed target, e.g. the attacker for a counter. */
    target: EffectTargetSchema.optional(),
  })
  .strict();

/** Makes the target's current DoTs deal DMG immediately (Kafka). */
const DetonateDotEffectSchema = z
  .object({
    kind: z.literal('detonateDot'),
    target: EffectTargetSchema,
    /** Fraction of each DoT's original DMG. */
    fraction: ValueSchema,
    /** Limit to DoTs of these status ids (e.g. only Shock); all DoTs when omitted. */
    statuses: z.array(IdSchema).optional(),
  })
  .strict();

/** Adds a Weakness to an enemy (Silver Wolf). */
const ImplantWeaknessEffectSchema = z
  .object({
    kind: z.literal('implantWeakness'),
    target: EffectTargetSchema,
    /** `randomPartyElement`: a Type of an on-field ally character. */
    element: z.union([ElementSchema, z.literal('randomPartyElement')]),
    duration: ValueSchema,
    /** RES reduction to the implanted Type (not applied if the enemy already had that Weakness). */
    resReduction: ValueSchema.optional(),
    baseChance: ValueSchema.optional(),
  })
  .strict();

/** Deals Break DMG of the owner's Type as a fraction of their normal Break DMG (Ruan Mei). */
const BreakDamageEffectSchema = z
  .object({
    kind: z.literal('breakDamage'),
    target: EffectTargetSchema,
    multiplier: ValueSchema,
  })
  .strict();

/** Prevents a knock-down and restores HP (Gepard's Talent, Bailu's Talent). */
const ReviveEffectSchema = z
  .object({
    kind: z.literal('revive'),
    target: EffectTargetSchema,
    stat: ScalingStatSchema.default('hp'),
    /** HP restored: `ratio` x (target's own Max HP, or the source's `stat` when `fromSource`) + `flat`. */
    ratio: ValueSchema,
    flat: ValueSchema.optional(),
    fromSource: z.boolean().default(false),
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
  ApplyRandomStatusEffectSchema,
  RemoveStatusEffectSchema,
  DispelEffectSchema,
  EnergyEffectSchema,
  UltimatePointsEffectSchema,
  GainResourceEffectSchema,
  SkillPointEffectSchema,
  ActionAdvanceEffectSchema,
  SummonEffectSchema,
  HpChangeEffectSchema,
  InsertActionEffectSchema,
  DetonateDotEffectSchema,
  ImplantWeaknessEffectSchema,
  BreakDamageEffectSchema,
  ReviveEffectSchema,
  ScriptEffectSchema,
]);
export type Effect = z.infer<typeof EffectSchema>;

const isParamRef = (o: Record<string, unknown>): boolean => typeof o.param === 'string' && Object.keys(o).every((k) => k === 'param' || k === 'from');

/** Every local `{ "param": name }` reference (no `from`) anywhere inside a value. */
export function paramRefsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(paramRefsIn);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (isParamRef(o)) return o.from === undefined ? [o.param as string] : [];
    return Object.values(o).flatMap(paramRefsIn);
  }
  return [];
}

/** Every cross-ability `{ "param": name, "from": slot }` reference inside a value. */
export function crossParamRefsIn(value: unknown): Array<{ param: string; from: string }> {
  if (Array.isArray(value)) return value.flatMap(crossParamRefsIn);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (isParamRef(o)) return typeof o.from === 'string' ? [{ param: o.param as string, from: o.from }] : [];
    return Object.values(o).flatMap(crossParamRefsIn);
  }
  return [];
}

/** Script handler ids referenced anywhere inside a value. */
export function scriptHandlersIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scriptHandlersIn);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const own = o.kind === 'script' && typeof o.handler === 'string' ? [o.handler] : [];
    return [...own, ...Object.values(o).flatMap(scriptHandlersIn)];
  }
  return [];
}

/**
 * Combat events that talents, traces, eidolons, light cones, relic sets and statuses can react to.
 * "Owner" is the unit that carries the trigger (the wearer for equipment).
 *
 * - `battleStart` / `waveStart`: once per battle / per wave, before the first turn.
 * - `onEnterBattleField`: the owner enters the field (battle start, a memosprite being summoned, a
 *   revived ally re-entering).
 * - `turnStart` / `turnEnd`: the owner's own turn (extra turns included).
 * - `beforeAttack` / `afterAttack`: around any attack by the owner (Basic, Skill, Ultimate, Follow-up).
 * - `afterUseBasic` / `afterUseSkill` / `afterUseUltimate`: after the owner uses that ability, whether
 *   or not it deals damage (e.g. a buff-only Ultimate still fires `afterUseUltimate`).
 * - `onFollowUp`: the owner performs a follow-up attack or counter (an inserted action).
 * - `afterBeingHit`: the owner is hit by an enemy attack.
 * - `afterAllyAttack`: another ally (memosprites and summons included) finishes an attack.
 * - `afterAllyHit`: another ally is hit by an enemy attack (counters, "when an ally is attacked").
 * - `afterAllyUsesUltimate`: another ally uses their Ultimate.
 * - `onTargetedByAlly`: an ally uses an ability on the owner (Dan Heng's Talent).
 * - `onMemospriteSummoned` / `onMemospriteLeave`: the owner's memosprite is summoned / leaves the field.
 * - `onLeaveField`: the owner itself leaves the field (a memosprite at 0 HP).
 * - `onKill`: the owner defeats an enemy. `onEnemyDefeated`: any enemy is defeated.
 * - `onWeaknessBreak`: the owner breaks an enemy. `afterAllyWeaknessBreak`: any ally (owner included) breaks one.
 * - `onToughnessRecover`: an enemy is about to recover from Weakness Break (Ruan Mei's Thanatoplum Rebloom).
 * - `beforeKnockedDown` / `beforeAllyKnockedDown`: the owner / a teammate receives a killing blow (revives).
 * - `onDebuffApplied`, `onHpChanged` (HP lost or consumed), `onShieldBroken`.
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
  'onTargetedByAlly',
  'onMemospriteSummoned',
  'onMemospriteLeave',
  'onLeaveField',
  'onKill',
  'onWeaknessBreak',
  'afterAllyWeaknessBreak',
  'onToughnessRecover',
  'beforeKnockedDown',
  'beforeAllyKnockedDown',
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
 * - `attackType { is }`: the triggering attack has this attack type (`is` may be a list).
 * - `attackerHasStatus { status }` / `targetHasStatus { status }` / `hasStatus { status }` (the unit receiving a modifier).
 * - `attackerIsOwnMemosprite`: the triggering unit is the owner's memosprite.
 * - `sourceIsMemosprite`: the damage source is a memosprite (for DMG% modifiers).
 * - `memospriteOnField`: the owner's memosprite is currently on the field.
 * - `targetHasShield`: the triggering ally / target currently has a Shield.
 * - `abilityTargetsAlly`: the triggering ability was used on an ally (Messenger 4pc, Harmony cones).
 * - `hpBelow { ratio }` / `hpAtLeast { ratio }` / `statAtLeast { stat, value }`: the owner's HP ratio / panel stat.
 * - `targetHpBelow { ratio }` / `targetHpAtLeast { ratio }`: the target's current HP ratio.
 * - `targetIsWeaknessBroken`, `targetIsDebuffed`, `targetIsSlowed`, `targetHasDot`.
 * - `targetHasWeakness { element }`: the target is weak to the element.
 * - `debuffCountAtLeast { count }`: the target has at least `count` debuffs.
 * - `enemyCountAtMost { count }`: at most `count` enemies are on the field.
 * - `energyFull`: the owner's Energy is at its maximum.
 * - `isCrit`: the triggering hit was a CRIT.
 * - `fixedChance { chance }`: triggers with a fixed probability.
 * - `resourceAtLeast { resource, value }`: the owner's custom resource is at least `value`.
 * - `damageElement { is }`: the DMG being dealt / taken is of this Type.
 *
 * In trigger contexts `primary` is the event's subject (the hit enemy, the ally being attacked or
 * knocked down) and `attacker` is the unit that attacked.
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
  'hpAtLeast',
  'statAtLeast',
  'targetHpBelow',
  'targetHpAtLeast',
  'targetIsWeaknessBroken',
  'targetIsDebuffed',
  'targetIsSlowed',
  'targetHasDot',
  'targetHasWeakness',
  'debuffCountAtLeast',
  'enemyCountAtMost',
  'energyFull',
  'isCrit',
  'fixedChance',
  'resourceAtLeast',
  'damageElement',
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
    /** Max activations per battle (revives: 1). */
    limitPerBattle: z.number().int().positive().optional(),
    /** Owner turns before the trigger can fire again. */
    cooldown: z.number().int().positive().optional(),
  })
  .strict();
export type Trigger = z.infer<typeof TriggerSchema>;

/**
 * Stack-scaled modifiers: the value is multiplied by
 *   min(max, (amount - offset) / step)   (never below 0; rounded down to whole steps when `whole`)
 * where `amount` is a custom resource's stacks, a stat (In the Night: SPD above 100 per 10), the
 * number of enemies on the field, or the target's debuff / DoT count.
 */
export const ModifierScalingSchema = z
  .object({
    /** `stat`: the modifier owner's stat; `sourceStat`: the stat of the unit that applied the status. */
    per: z.enum(['resource', 'stat', 'sourceStat', 'enemyCount', 'targetDebuffCount', 'targetDotCount', 'statusStacks']),
    /** Resource id, stat id or status id, depending on `per`. */
    id: z.string().min(1).optional(),
    step: z.number().positive().default(1),
    offset: z.number().default(0),
    max: z.number().positive().optional(),
    /** Count whole steps only (In the Night: every full 10 SPD above 100). */
    whole: z.boolean().optional(),
  })
  .strict();

/** A stat change. `scope` decides who receives it (self, whole team, all enemies). */
function modifierSchema<V extends z.ZodType>(value: V) {
  return z
    .object({
      stat: StatIdSchema,
      value,
      scope: z.enum(['self', 'team', 'teamExceptSelf', 'allEnemies', 'memosprite', 'summon']).default('self'),
      conditions: z.array(ConditionSchema).optional(),
      scaling: ModifierScalingSchema.optional(),
      /** Apply the value as a reduction (debuffs whose params are given as positive magnitudes). */
      negate: z.boolean().optional(),
    })
    .strict();
}

export const StatModifierSchema = modifierSchema(ValueSchema);
export type StatModifier = z.infer<typeof StatModifierSchema>;

/**
 * Status-effect modifiers may take their value from the applying effect's `params`
 * (`{ "param": "atkPct" }`), so one status definition serves every ability level.
 */
export const StatusModifierSchema = modifierSchema(ValueSchema);
export type StatusModifier = z.infer<typeof StatusModifierSchema>;

/** Light Cone passive modifiers hold one value per Superimposition rank, or reference a passive param. */
export const SuperimposedModifierSchema = modifierSchema(z.union([SuperimposedSchema, ParamRefSchema]));
export type SuperimposedModifier = z.infer<typeof SuperimposedModifierSchema>;

/** Ability shape without cross-field checks (extended by enemy abilities). */
export const AbilityBaseSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    kind: AbilityKindSchema,
    tags: z.array(AbilityTagSchema).default([]),
    targeting: TargetingSchema,
    /** Natural max level from traces (Basic 6, others 10). Eidolons add bonus levels. */
    maxLevel: z.number().int().min(1).max(15),
    /**
     * Named per-level values (index 0 = Lv.1), e.g. the reference game's ability parameters
     * `p1`, `p2`, ... Effects reference them with `{ "param": "p1" }`; descriptions with `{p1}`.
     */
    params: z.record(z.string(), z.array(z.number()).min(1)).default({}),
    /** Description template (see models/templates.ts). */
    description: TextSchema,
    /** Skill Points consumed (Skill: 1). */
    spCost: z.number().int().min(0).default(0),
    /** Skill Points generated (Basic ATK: 1). */
    spGain: z.number().int().min(0).default(0),
    /** Energy regenerated on use, before Energy Regeneration Rate (Basic 20, Skill 30, Ultimate 5). */
    energyGain: z.number().min(0).default(0),
    /** Technique Points consumed outside combat (Technique: 1). */
    techniquePointCost: z.number().int().min(0).default(0),
    /** Using the ability does not end the turn (Blade's Skill). */
    keepsTurn: z.boolean().default(false),
    effects: z.array(EffectSchema).default([]),
    triggers: z.array(TriggerSchema).default([]),
    modifiers: z.array(StatModifierSchema).default([]),
    presentation: PresentationHooksSchema.optional(),
  })
  .strict();

/** Every `{ param }` reference must name an ability param, and per-level tables must cover maxLevel. */
export function checkAbilityParams(a: z.infer<typeof AbilityBaseSchema>, ctx: z.RefinementCtx): void {
    for (const ref of paramRefsIn([a.effects, a.triggers, a.modifiers])) {
      if (!(ref in a.params)) ctx.addIssue({ code: 'custom', message: `${a.id} references unknown param "${ref}"` });
    }
    for (const [k, v] of Object.entries(a.params)) {
      if (v.length > 1 && v.length < a.maxLevel) ctx.addIssue({ code: 'custom', message: `${a.id} param "${k}" has ${v.length} levels but maxLevel is ${a.maxLevel}` });
    }
}

export const AbilitySchema = AbilityBaseSchema.superRefine(checkAbilityParams);
export type Ability = z.infer<typeof AbilitySchema>;
