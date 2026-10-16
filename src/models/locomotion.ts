import { z } from 'zod';
import { IdSchema, TextSchema } from './common';
import { AreaExtrasSchema, WorldObjectSchema } from './world';

/**
 * Phase 2 data: overworld locomotion tuning, the animation state machine, parties and walkable
 * levels. Everything the player controller does is driven by these records.
 */

const Positive = z.number().positive();

/** One locomotion gait (walk / run / sprint). Speeds are in metres per second. */
const GaitSchema = z
  .object({
    speed: Positive,
    /** Distance covered per footstep (footstep event cadence). */
    stride: Positive,
  })
  .strict();

/**
 * Animation state machine. States are evaluated in order; the first whose conditions hold wins.
 * Each state names the clip a real animation set will use later and the procedural pose
 * parameters (bob / lean / arm swing) the placeholder model uses now.
 */
export const AnimationStateSchema = z
  .object({
    id: IdSchema,
    /** Clip id for the future animation system (Phase 4/23). */
    clip: z.string().min(1),
    when: z
      .object({
        /** Horizontal speed at or above (m/s). */
        minSpeed: z.number().min(0).optional(),
        /** Gait the controller is in. */
        gait: z.enum(['walk', 'run', 'sprint']).optional(),
      })
      .strict()
      .default({}),
    /** Cross-fade time into this state (s). */
    blendIn: z.number().min(0).default(0.15),
    pose: z
      .object({
        bobAmplitude: z.number().min(0),
        /** Bob cycles per metre travelled (idle: per second). */
        bobFrequency: z.number().min(0),
        /** Forward lean in radians. */
        lean: z.number(),
        armSwing: z.number().min(0),
      })
      .strict(),
    /** Emit footstep events in this state. */
    footsteps: z.boolean().default(false),
  })
  .strict();
export type AnimationStateDef = z.infer<typeof AnimationStateSchema>;

export const LocomotionRulesSchema = z
  .object({
    id: IdSchema,
    gaits: z.object({ walk: GaitSchema, run: GaitSchema, sprint: GaitSchema }).strict(),
    /** Default gait without modifiers (the reference game runs by default; walk is a toggle). */
    defaultGait: z.enum(['walk', 'run']),
    /** Horizontal acceleration / deceleration (m/s^2). */
    acceleration: Positive,
    deceleration: Positive,
    /** Max yaw rotation speed toward the move direction (rad/s). */
    turnRate: Positive,
    /** Stick / key input magnitude below this is treated as no input. */
    inputDeadzone: z.number().min(0).max(1),
    capsule: z
      .object({
        radius: Positive,
        height: Positive,
        /** Max ledge the controller steps up onto without stopping (m). */
        stepHeight: z.number().min(0),
        /** Steepest walkable slope (degrees); steeper surfaces block like walls. */
        maxSlopeDeg: z.number().min(0).max(89),
        /** Max drop the controller sticks to the ground over (m) instead of falling. */
        snapDistance: z.number().min(0),
      })
      .strict(),
    gravity: Positive,
    interaction: z
      .object({
        /** Radius around the character in which interactables are listed (m). */
        radius: Positive,
        /** Max prompts shown at once (the list scrolls beyond). */
        maxVisible: z.number().int().positive(),
      })
      .strict(),
    animation: z.array(AnimationStateSchema).min(1),
    /** Seconds the overworld attack / Technique hooks are blocked after use. */
    actionCooldown: z.number().min(0),
  })
  .strict()
  .refine((l) => l.gaits.walk.speed < l.gaits.run.speed && l.gaits.run.speed < l.gaits.sprint.speed, 'gait speeds must increase walk < run < sprint');
export type LocomotionRules = z.infer<typeof LocomotionRulesSchema>;

/** The exploration party: up to 4 characters, slot order = number keys 1..4. */
export const PartySchema = z
  .object({
    id: IdSchema,
    members: z.array(IdSchema).min(1).max(4),
    /** Level and ascension the party fights at until the player-progress systems exist (Phase 9). */
    level: z.number().int().min(1).max(80).default(80),
    ascension: z.number().int().min(0).max(6).default(6),
  })
  .strict()
  .refine((p) => new Set(p.members).size === p.members.length, 'party members must be unique');
export type Party = z.infer<typeof PartySchema>;

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * Static level geometry. All colliders are axis-aligned:
 * - `box`: a solid block from `min` to `max` (floors, walls, steps, platforms).
 * - `ramp`: a block whose top rises linearly from `min.y`-height at the low edge to `max.y` at the
 *   high edge along `rise` (+x, -x, +z or -z). Its walkable top is a slope.
 */
export const ColliderSchema = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('box'), id: IdSchema.optional(), min: Vec3, max: Vec3, material: z.string().default('stone') }).strict(),
  z
    .object({
      shape: z.literal('ramp'),
      id: IdSchema.optional(),
      min: Vec3,
      max: Vec3,
      /** Top height at the low edge (the high edge is `max[1]`). */
      lowHeight: z.number(),
      rise: z.enum(['+x', '-x', '+z', '-z']),
      material: z.string().default('stone'),
    })
    .strict(),
]);
export type Collider = z.infer<typeof ColliderSchema>;

/**
 * Interactables are the typed world objects of Phase 4 (signs, NPCs, chests, collectibles,
 * breakables, switches, plates, crates, gates, anchors, portals). The Phase 2 prompt list and
 * controller only read the shared fields (id, kind, label, position, message).
 */
export const InteractableSchema = WorldObjectSchema;
export type Interactable = z.infer<typeof InteractableSchema>;

export const LevelSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    subtitle: TextSchema,
    spawn: z.object({ position: Vec3, yaw: z.number() }).strict(),
    colliders: z.array(ColliderSchema).min(1),
    interactables: z.array(InteractableSchema).default([]),
    /** Named placeholder units for camera shots (dummy enemies, boss, speaker) - Phase 3 Camera Gallery. */
    markers: z.array(z.object({ id: IdSchema, kind: z.enum(['enemy', 'boss', 'npc']), position: Vec3, yaw: z.number() }).strict()).default([]),
    /** Where the Camera Gallery stages the player. */
    galleryStage: z.object({ position: Vec3, yaw: z.number() }).strict().optional(),
    /** Falling below this height respawns the player at `spawn`. */
    killHeight: z.number(),
    /** Named arrival points (portals and anchors reference them; 'default' is `spawn`), puzzles, secret rooms and enemies (Phase 4). */
    ...AreaExtrasSchema,
  })
  .strict()
  .superRefine((l, ctx) => {
    const issue = (message: string, path: Array<string | number> = []): void => ctx.addIssue({ code: "custom", path, message });
    l.colliders.forEach((c, i) => {
      for (let k = 0; k < 3; k++) if ((c.min[k] ?? 0) >= (c.max[k] ?? 0)) issue("min must be < max on every axis", ["colliders", i]);
    });
    const unique = (label: string, ids: readonly string[]): void => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) issue(`duplicate ${label} "${id}"`);
        seen.add(id);
      }
    };
    unique("interactable", l.interactables.map((o) => o.id));
    unique("puzzle", l.puzzles.map((p) => p.id));
    unique("hidden area", l.hiddenAreas.map((h) => h.id));
    unique("enemy spawn", l.enemySpawns.map((e) => e.id));
    unique("collider", l.colliders.flatMap((c) => (c.id ? [c.id] : [])));
    if ("default" in l.spawns) issue("spawn name 'default' is reserved for `spawn`");

    const objects = new Map(l.interactables.map((o) => [o.id, o]));
    const colliderIds = new Set(l.colliders.flatMap((c) => (c.id ? [c.id] : [])));
    const hiddenIds = new Set(l.hiddenAreas.map((h) => h.id));
    const puzzleIds = new Set(l.puzzles.map((p) => p.id));
    const spawnExists = (name: string): boolean => name === "default" || name in l.spawns;
    for (const o of l.interactables) {
      const at = ["interactables", o.id];
      if (o.hiddenIn && !hiddenIds.has(o.hiddenIn)) issue(`"${o.id}" is hidden in unknown hidden area "${o.hiddenIn}"`, at);
      for (const r of o.requires) {
        if (r.kind === "puzzle" && !puzzleIds.has(r.id)) issue(`"${o.id}" requires unknown puzzle "${r.id}"`, at);
        if (r.kind === "object" && !objects.has(r.id)) issue(`"${o.id}" requires unknown object "${r.id}"`, at);
        if (r.kind === "hidden" && !hiddenIds.has(r.id)) issue(`"${o.id}" requires unknown hidden area "${r.id}"`, at);
      }
      if ((o.kind === "gate" || (o.kind === "breakable" && o.collider)) && !colliderIds.has(o.kind === "gate" ? o.collider : (o.collider as string))) issue(`"${o.id}" references unknown collider`, at);
      if (o.kind === "anchor" && !spawnExists(o.spawn)) issue(`anchor "${o.id}" uses unknown spawn "${o.spawn}"`, at);
    }
    for (const p of l.puzzles) {
      const ids = p.type === "sequence" ? p.switches : p.plates;
      const want = p.type === "sequence" ? "switch" : "plate";
      for (const id of ids) if (objects.get(id)?.kind !== want) issue(`puzzle "${p.id}" needs a ${want} "${id}"`, ["puzzles", p.id]);
    }
    for (const h of l.hiddenAreas) {
      if (h.bounds.min[0] >= h.bounds.max[0] || h.bounds.min[1] >= h.bounds.max[1]) issue(`hidden area "${h.id}": min must be < max`, ["hiddenAreas", h.id]);
      if (h.discover.by === "object" && !objects.has(h.discover.object)) issue(`hidden area "${h.id}" is discovered by unknown object "${h.discover.object}"`, ["hiddenAreas", h.id]);
    }
  });
export type Level = z.infer<typeof LevelSchema>;
