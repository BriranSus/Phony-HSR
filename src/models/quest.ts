import { z } from 'zod';
import { IdSchema, ItemStackSchema, TextSchema } from './common';

/**
 * Quest and dialogue schemas. Declared now so the save format and dependency graph are stable;
 * the runtime systems are Phase 13 (quests) and Phase 14 (dialogue).
 */
export const QUEST_TYPES = ['main', 'adventure', 'companion', 'daily', 'event', 'tutorial'] as const;

export const ObjectiveSchema = z
  .object({
    id: IdSchema,
    text: TextSchema,
    type: z.enum(['talk', 'reach', 'defeat', 'collect', 'interact', 'cutscene', 'custom']),
    target: z.string().optional(),
    count: z.number().int().positive().default(1),
    /** Map marker shown while this objective is active. */
    marker: z.object({ map: IdSchema, x: z.number(), y: z.number(), z: z.number() }).strict().optional(),
    /** Dialogue played when the objective starts. */
    dialogue: IdSchema.optional(),
    /** Branching: objective ids that become active after this one, optionally keyed by dialogue choice. */
    next: z.union([z.array(IdSchema), z.record(z.string(), z.array(IdSchema))]).default([]),
  })
  .strict();

export const QuestSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    type: z.enum(QUEST_TYPES),
    chapter: z.string().optional(),
    description: TextSchema,
    prerequisites: z.object({ quests: z.array(IdSchema).default([]), trailblazeLevel: z.number().int().min(1).optional() }).strict().default({ quests: [] }),
    objectives: z.array(ObjectiveSchema).min(1),
    start: IdSchema,
    rewards: z.array(ItemStackSchema).default([]),
  })
  .strict();
export type Quest = z.infer<typeof QuestSchema>;

export const DialogueLineSchema = z
  .object({
    id: IdSchema,
    speaker: z.string().min(1),
    text: TextSchema,
    expression: z.string().optional(),
    voice: z.string().optional(),
    camera: z.string().optional(),
    choices: z.array(z.object({ text: TextSchema, next: IdSchema.nullable(), setFlag: z.string().optional() }).strict()).optional(),
    next: IdSchema.nullable().optional(),
  })
  .strict();

export const DialogueSchema = z
  .object({
    id: IdSchema,
    start: IdSchema,
    lines: z.array(DialogueLineSchema).min(1),
  })
  .strict()
  .superRefine((d, ctx) => {
    const ids = new Set(d.lines.map((l) => l.id));
    if (!ids.has(d.start)) ctx.addIssue({ code: 'custom', message: `start line "${d.start}" does not exist` });
    for (const l of d.lines) {
      for (const n of [l.next, ...(l.choices ?? []).map((c) => c.next)]) {
        if (n && !ids.has(n)) ctx.addIssue({ code: 'custom', message: `line "${l.id}" points to missing line "${n}"` });
      }
    }
  });
export type Dialogue = z.infer<typeof DialogueSchema>;

/** Runtime quest progress (saved). */
export interface QuestProgress {
  readonly questId: string;
  state: 'locked' | 'available' | 'active' | 'completed' | 'failed';
  activeObjectives: string[];
  counters: Record<string, number>;
  flags: Record<string, boolean>;
}
