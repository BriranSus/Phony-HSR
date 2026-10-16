import { z } from 'zod';
import { IdSchema } from './common';

/**
 * Battle presentation tuning (data, not code): where units stand, how the overview camera sits, how
 * long each beat of an action lasts and which camera shots play. The engine itself knows nothing
 * about this; `BattleState` (app layer) reads it to play the engine's event stream.
 */
const Seconds = z.number().min(0);

export const BattleStageSchema = z
  .object({
    id: IdSchema,
    /** Party formation: x of the first member, spacing between members, z of the row (allies face -z). */
    allies: z.object({ x: z.number(), spacing: z.number().positive(), z: z.number() }).strict(),
    /** Enemy formation: spacing between enemies (centred on x = 0) and z of the row (enemies face +z). */
    enemies: z.object({ spacing: z.number().positive(), z: z.number() }).strict(),
    /** Figure scale of enemies by rank (bosses are bigger). */
    enemyScale: z.object({ normal: z.number().positive(), elite: z.number().positive(), boss: z.number().positive() }).strict(),
    /** The idle overview camera (mode `combat`): distance behind the party, height, look height, FOV, slow sway. */
    camera: z.object({ distance: z.number().positive(), height: z.number(), lookHeight: z.number(), fov: z.number().min(20).max(90), sway: z.number().min(0) }).strict(),
    /** Camera shots (ids from `camera/shots`) for the beats of an action. */
    shots: z.object({ skill: IdSchema, ultimate: IdSchema, enemy: IdSchema }).strict(),
    /** Seconds each beat takes at animation speed 1. */
    timing: z
      .object({
        /** Pause before an action starts (the turn banner). */
        actionLead: Seconds,
        /** Lunge toward the target and back. */
        lunge: Seconds,
        /** Between two hits of one action. */
        hitGap: Seconds,
        /** Weakness Break flourish. */
        breakPause: Seconds,
        dotPause: Seconds,
        /** A unit falling. */
        downPause: Seconds,
        statusPause: Seconds,
        turnGap: Seconds,
        /** Wave / advantage banners. */
        banner: Seconds,
        /** Floating damage numbers stay this long. */
        floatSeconds: Seconds,
      })
      .strict(),
    /** How many upcoming turns the turn-order bar shows. */
    turnOrderCount: z.number().int().min(3).max(12),
  })
  .strict();
export type BattleStage = z.infer<typeof BattleStageSchema>;
