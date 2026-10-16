import { z } from 'zod';
import { IdSchema, TextSchema } from './common';

/**
 * Phase 4 data: the world layer. A WORLD lists REGIONS, a region lists AREAS (the `levels`
 * collection: geometry plus everything placed in it). Objects, puzzles, hidden areas and enemy
 * spawns are all JSON, so a new area or a whole new world is data only.
 *
 *   world.json  ->  regions[].areas[]  ->  levels/<area>.json
 *                                            colliders, spawns, interactables (objects),
 *                                            puzzles, hiddenAreas, enemySpawns
 */

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Vec2 = z.tuple([z.number(), z.number()]);

/** An item grant. Ids are checked against the `items` collection at data load. */
export const RewardSchema = z.object({ item: IdSchema, count: z.number().int().positive() }).strict();
export type Reward = z.infer<typeof RewardSchema>;

/** Object states by kind; also the vocabulary of `requires` clauses. */
export const OBJECT_STATES = ['idle', 'closed', 'opened', 'present', 'collected', 'intact', 'broken', 'off', 'on', 'pressed', 'open', 'dormant', 'active'] as const;
export const ObjectStateSchema = z.enum(OBJECT_STATES);
export type ObjectStateName = z.infer<typeof ObjectStateSchema>;

/** A prerequisite an interactable needs before it can be used (or, for gates, opens by itself). */
export const RequirementSchema = z.discriminatedUnion('kind', [
  /** A puzzle in the same area is solved. */
  z.object({ kind: z.literal('puzzle'), id: IdSchema }).strict(),
  /** Another object in the same area is in `state`. */
  z.object({ kind: z.literal('object'), id: IdSchema, state: ObjectStateSchema }).strict(),
  /** The party holds `count` of an item (key items). `consume` takes them when used. */
  z.object({ kind: z.literal('item'), id: IdSchema, count: z.number().int().positive().default(1), consume: z.boolean().default(false) }).strict(),
  /** A hidden area in the same area has been discovered. */
  z.object({ kind: z.literal('hidden'), id: IdSchema }).strict(),
]);
export type Requirement = z.infer<typeof RequirementSchema>;

const objectBase = {
  id: IdSchema,
  /** Prompt label shown in the right-side list. */
  label: TextSchema,
  position: Vec3,
  /** Text shown when used (sign / NPC line / result line). */
  message: TextSchema.optional(),
  /** Prerequisites; unmet ones block use and show `lockedMessage`. */
  requires: z.array(RequirementSchema).default([]),
  lockedMessage: TextSchema.optional(),
  /** The object only exists once this hidden area has been discovered. */
  hiddenIn: IdSchema.optional(),
  /** Display colour (#rrggbb) for the object's glow; purely visual. */
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Counts toward the area's exploration percentage (chests, collectibles and anchors default to true). */
  progress: z.boolean().optional(),
};

/**
 * Typed interactables. Each kind is a small state machine (`modules/world/objects.ts`):
 * chest closed -> opened, collectible present -> collected, breakable intact -> broken,
 * switch off <-> on, plate idle <-> pressed, gate closed -> open, anchor dormant -> active.
 */
export const WorldObjectSchema = z.discriminatedUnion('kind', [
  z.object({ ...objectBase, kind: z.literal('sign'), message: TextSchema }).strict(),
  z.object({ ...objectBase, kind: z.literal('npc'), message: TextSchema }).strict(),
  z.object({ ...objectBase, kind: z.literal('chest'), rewards: z.array(RewardSchema).default([]) }).strict(),
  z.object({ ...objectBase, kind: z.literal('collectible'), reward: RewardSchema }).strict(),
  z
    .object({
      ...objectBase,
      kind: z.literal('breakable'),
      /** Overworld attack hits needed to break it. */
      hits: z.number().int().positive().default(2),
      /** Level collider removed when it breaks (a cracked wall). */
      collider: IdSchema.optional(),
      rewards: z.array(RewardSchema).default([]),
    })
    .strict(),
  z.object({ ...objectBase, kind: z.literal('switch'), mode: z.enum(['press', 'toggle']).default('press') }).strict(),
  z.object({ ...objectBase, kind: z.literal('plate'), radius: z.number().positive().default(0.9) }).strict(),
  z.object({ ...objectBase, kind: z.literal('crate'), step: z.number().positive().default(2), size: z.number().positive().default(1.4) }).strict(),
  z
    .object({
      ...objectBase,
      kind: z.literal('gate'),
      /** Level collider id removed when the gate opens. */
      collider: IdSchema,
      /** Opens only on interaction (key doors, one-way shortcuts); otherwise opens once `requires` hold. */
      manual: z.boolean().default(false),
      /** One-way shortcut: it can only be opened from the side this (x, z) vector points to. */
      openFrom: Vec2.optional(),
    })
    .strict(),
  z.object({ ...objectBase, kind: z.literal('anchor'), /** Spawn point (this area) the player arrives at when teleporting here. */ spawn: z.string().min(1) }).strict(),
  z.object({ ...objectBase, kind: z.literal('portal'), toArea: IdSchema, toSpawn: z.string().min(1).default('default') }).strict(),
]);
export type WorldObject = z.infer<typeof WorldObjectSchema>;
export type WorldObjectKind = WorldObject['kind'];
export const WORLD_OBJECT_KINDS = ['sign', 'npc', 'chest', 'collectible', 'breakable', 'switch', 'plate', 'crate', 'gate', 'anchor', 'portal'] as const;

export const SpawnPointSchema = z.object({ position: Vec3, yaw: z.number() }).strict();
export type SpawnPoint = z.infer<typeof SpawnPointSchema>;

/** A secret room: found by walking into it or by using an object (a cracked wall, a switch). */
export const HiddenAreaSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    /** Footprint (x, z) of the veiled room. */
    bounds: z.object({ min: Vec2, max: Vec2 }).strict(),
    discover: z.discriminatedUnion('by', [z.object({ by: z.literal('enter') }).strict(), z.object({ by: z.literal('object'), object: IdSchema }).strict()]),
  })
  .strict();
export type HiddenArea = z.infer<typeof HiddenAreaSchema>;

export const PuzzleSchema = z.discriminatedUnion('type', [
  /** Press the switches in order; a wrong press resets the sequence. */
  z.object({ id: IdSchema, name: TextSchema, type: z.literal('sequence'), switches: z.array(IdSchema).min(2), rewards: z.array(RewardSchema).default([]), hint: TextSchema.optional() }).strict(),
  /** Hold every plate down at once (the player's weight, or a crate's). */
  z.object({ id: IdSchema, name: TextSchema, type: z.literal('plates'), plates: z.array(IdSchema).min(1), rewards: z.array(RewardSchema).default([]), hint: TextSchema.optional() }).strict(),
]);
export type Puzzle = z.infer<typeof PuzzleSchema>;

export const RespawnSchema = z
  .object({
    /** never: stays defeated; timer: returns after `seconds`; reenter: returns when the area is entered again. */
    mode: z.enum(['never', 'timer', 'reenter']),
    seconds: z.number().positive().optional(),
  })
  .strict();
export type Respawn = z.infer<typeof RespawnSchema>;

/** An overworld enemy (group): the first member is the figure shown, all fight together. */
export const EnemySpawnSchema = z
  .object({
    id: IdSchema,
    enemies: z.array(IdSchema).min(1).max(5),
    position: Vec3,
    yaw: z.number().default(0),
    /** Patrol route (x, z); without one the group idles in place. */
    patrol: z.array(Vec2).default([]),
    /** Overrides for the world rules. */
    detectionRadius: z.number().positive().optional(),
    respawn: RespawnSchema.optional(),
    /** Enemy level in the battle (defaults to `rules/world -> encounter.enemyLevel`). */
    level: z.number().int().min(1).max(95).optional(),
  })
  .strict();
export type EnemySpawn = z.infer<typeof EnemySpawnSchema>;

/** The extra per-area fields (merged into the level schema). */
export const AreaExtrasSchema = {
  spawns: z.record(z.string().min(1), SpawnPointSchema).default({}),
  puzzles: z.array(PuzzleSchema).default([]),
  hiddenAreas: z.array(HiddenAreaSchema).default([]),
  enemySpawns: z.array(EnemySpawnSchema).default([]),
};

const Advantage = z.enum(['playerStrike', 'neutral', 'ambush']);
export type Advantage = z.infer<typeof Advantage>;
export const AdvantageSchema = Advantage;

/** Tuning for the overworld: enemy AI, encounter advantage, Technique, breakables, respawn. */
export const WorldRulesSchema = z
  .object({
    id: IdSchema,
    enemy: z
      .object({
        detectionRadius: z.number().positive(),
        /** Field of view of the detection cone (deg). Inside `closeRadius` enemies notice you regardless. */
        detectionFovDeg: z.number().min(10).max(360),
        closeRadius: z.number().positive(),
        /** Beyond this distance a chasing enemy starts losing you. */
        loseRadius: z.number().positive(),
        loseSeconds: z.number().positive(),
        alertSeconds: z.number().positive(),
        patrolSpeed: z.number().positive(),
        chaseSpeed: z.number().positive(),
        returnSpeed: z.number().positive(),
        contactRadius: z.number().positive(),
        patrolPause: z.number().min(0),
        stunSeconds: z.number().positive(),
        /** Collision radius when moving around level geometry. */
        radius: z.number().positive(),
      })
      .strict(),
    encounter: z
      .object({
        /** Contact from behind the player's facing by more than this angle is an ambush. */
        ambushAngleDeg: z.number().min(0).max(180),
        /** Overworld attack: advantage by the enemy's awareness. */
        playerAttack: z.object({ unaware: Advantage, aware: Advantage, stunned: Advantage }).strict(),
        /** Enemy touches the player: advantage by where the enemy came from. */
        enemyContact: z.object({ behind: Advantage, front: Advantage }).strict(),
        attackRange: z.number().positive(),
        attackArcDeg: z.number().min(10).max(360),
        /** Default enemy level of battles started from the overworld. */
        enemyLevel: z.number().int().min(1).max(95),
      })
      .strict(),
    technique: z.object({ radius: z.number().positive(), effect: z.literal('stun') }).strict(),
    respawn: z.object({ mode: z.enum(['never', 'timer', 'reenter']), seconds: z.number().positive() }).strict(),
    breakable: z.object({ reach: z.number().positive(), arcDeg: z.number().min(10).max(360) }).strict(),
    /** Plates are pressed by the player within `radius` (own radius) or a crate centred on them. */
    plates: z.object({ crateRadius: z.number().positive() }).strict(),
    /** Seconds a hidden area's veil takes to fade out. */
    hiddenFadeSeconds: z.number().positive(),
  })
  .strict();
export type WorldRules = z.infer<typeof WorldRulesSchema>;

export const RegionSchema = z.object({ id: IdSchema, name: TextSchema, areas: z.array(IdSchema).min(1) }).strict();
export type Region = z.infer<typeof RegionSchema>;

export const WorldSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    description: TextSchema.optional(),
    startArea: IdSchema,
    startSpawn: z.string().min(1).default('default'),
    regions: z.array(RegionSchema).min(1),
  })
  .strict()
  .superRefine((w, ctx) => {
    const regions = new Set<string>();
    const areas = new Set<string>();
    for (const r of w.regions) {
      if (regions.has(r.id)) ctx.addIssue({ code: 'custom', message: `duplicate region "${r.id}"` });
      regions.add(r.id);
      for (const a of r.areas) {
        if (areas.has(a)) ctx.addIssue({ code: 'custom', message: `area "${a}" is listed in more than one region` });
        areas.add(a);
      }
    }
    if (!areas.has(w.startArea)) ctx.addIssue({ code: 'custom', message: `startArea "${w.startArea}" is not part of any region` });
  });
export type World = z.infer<typeof WorldSchema>;

/** Serialisable world progress. `version` lets the Phase 21 save system migrate old saves. */
export const WORLD_STATE_VERSION = 1;
export const WorldStateSchema = z
  .object({
    version: z.number().int().positive(),
    worldId: IdSchema,
    area: IdSchema,
    visited: z.array(IdSchema),
    /** Keyed "<area>/<object>". */
    objects: z.record(z.string(), z.object({ state: z.string(), hits: z.number().int().min(0).optional(), x: z.number().optional(), z: z.number().optional() }).strict()),
    puzzles: z.record(z.string(), z.object({ progress: z.number().int().min(0), solved: z.boolean() }).strict()),
    /** "<area>/<hiddenArea>" keys. */
    discovered: z.array(z.string()),
    /** "<area>/<spawn>" -> world clock (s) at which the group was defeated. */
    defeated: z.record(z.string(), z.number()),
    /** Items granted by the world (the Phase 8 inventory takes over from the events). */
    items: z.record(z.string(), z.number().int().positive()),
    clock: z.number().min(0),
  })
  .strict();
export type WorldStateData = z.infer<typeof WorldStateSchema>;
