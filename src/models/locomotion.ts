import { z } from 'zod';
import { IdSchema, TextSchema } from './common';

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

export const InteractableSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['sign', 'chest', 'npc']),
    /** Prompt label shown in the right-side list. */
    label: TextSchema,
    position: Vec3,
    /** Text shown when interacted with (sign / NPC line / chest result). */
    message: TextSchema,
  })
  .strict();
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
  })
  .strict()
  .superRefine((l, ctx) => {
    l.colliders.forEach((c, i) => {
      for (let k = 0; k < 3; k++) if ((c.min[k] ?? 0) >= (c.max[k] ?? 0)) ctx.addIssue({ code: 'custom', path: ['colliders', i], message: 'min must be < max on every axis' });
    });
    const ids = new Set<string>();
    for (const it of l.interactables) {
      if (ids.has(it.id)) ctx.addIssue({ code: 'custom', message: `duplicate interactable "${it.id}"` });
      ids.add(it.id);
    }
  });
export type Level = z.infer<typeof LevelSchema>;
