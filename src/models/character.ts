import { z } from 'zod';
import {
  AscensionSchema,
  CharacterRaritySchema,
  CostSchema,
  ElementSchema,
  IdSchema,
  LevelSchema,
  PathSchema,
  PresentationHooksSchema,
  TextSchema,
} from './common';
import { AbilitySchema, StatModifierSchema, TriggerSchema } from './ability';
import { StatIdSchema } from './stats';

/**
 * Character definition (static data). Player-owned progress lives in `CharacterInstance`.
 *
 * Base stats follow the in-game promotion structure:
 *   stat(level, ascension) = base * (1 + ascensionStep * ascension) + base * levelGrowth * (level - 1)
 * with `levelGrowth` / `ascensionStep` from `rules/progression.json` (0.05 / 0.4 for characters).
 */
export const BaseStatsSchema = z
  .object({
    hp: z.number().positive(),
    atk: z.number().positive(),
    def: z.number().positive(),
    spd: z.number().positive(),
    critRate: z.number().min(0).default(0.05),
    critDmg: z.number().min(0).default(0.5),
    /** Overrides the Path's base aggro (taunt weight) if set. */
    aggro: z.number().positive().optional(),
  })
  .strict();

export const AbilitySlotSchema = z.enum(['basic', 'skill', 'ultimate', 'talent', 'technique']);
export type AbilitySlot = z.infer<typeof AbilitySlotSchema>;

/** Trace tree node: ability level-ups, Major Traces (A2/A4/A6 passives) and minor stat bonuses. */
export const TraceNodeSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(['ability', 'major', 'stat']),
    name: TextSchema,
    /** Parent node that must be unlocked first (tree edge). */
    parent: IdSchema.optional(),
    /** For "ability" nodes: which ability this node levels. */
    ability: z.enum(['basic', 'skill', 'ultimate', 'talent', 'memospriteSkill', 'memospriteTalent']).optional(),
    /** For "stat" nodes: the bonus granted. */
    stat: z.object({ stat: StatIdSchema, value: z.number() }).strict().optional(),
    /** For "major" nodes: the passive granted. */
    passive: z
      .object({
        description: TextSchema,
        modifiers: z.array(StatModifierSchema).default([]),
        triggers: z.array(TriggerSchema).default([]),
      })
      .strict()
      .optional(),
    requirements: z
      .object({
        ascension: AscensionSchema.optional(),
        level: LevelSchema.optional(),
      })
      .strict()
      .default({}),
    /** Shared cost table (collection "costTables"); ability nodes use one step per level-up. */
    costTable: IdSchema,
  })
  .strict()
  .superRefine((n, ctx) => {
    if (n.kind === 'ability' && !n.ability) ctx.addIssue({ code: 'custom', message: 'ability nodes need "ability"' });
    if (n.kind === 'stat' && !n.stat) ctx.addIssue({ code: 'custom', message: 'stat nodes need "stat"' });
    if (n.kind === 'major' && !n.passive) ctx.addIssue({ code: 'custom', message: 'major nodes need "passive"' });
  });
export type TraceNode = z.infer<typeof TraceNodeSchema>;

export const EidolonSchema = z
  .object({
    rank: z.number().int().min(1).max(6),
    name: TextSchema,
    description: TextSchema,
    /** E3/E5 style ability level bonuses, e.g. { "skill": 2, "basic": 1 }. */
    abilityLevelBonus: z.partialRecord(AbilitySlotSchema, z.number().int().positive()).optional(),
    modifiers: z.array(StatModifierSchema).default([]),
    triggers: z.array(TriggerSchema).default([]),
    /** Character-specific behaviour change handled by a script handler. */
    script: z.string().optional(),
  })
  .strict();
export type Eidolon = z.infer<typeof EidolonSchema>;

/** Remembrance memosprites: summoned units with their own HP, SPD and abilities. */
export const MemospriteSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    /** Memosprite Max HP = fraction of owner Max HP + flat. */
    hpFromOwner: z.object({ ratio: z.number().positive(), flat: z.number().min(0) }).strict(),
    /** Fixed SPD or fraction of the owner's SPD. */
    spd: z.union([z.object({ fixed: z.number().positive() }).strict(), z.object({ ownerRatio: z.number().positive() }).strict()]),
    abilities: z.array(AbilitySchema).min(1),
  })
  .strict();

export const CharacterSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    rarity: CharacterRaritySchema,
    element: ElementSchema,
    path: PathSchema,
    /** Energy needed for the Ultimate (typically 100-160). */
    maxEnergy: z.number().int().positive(),
    baseStats: BaseStatsSchema,
    abilities: z
      .object({
        basic: AbilitySchema,
        skill: AbilitySchema,
        ultimate: AbilitySchema,
        talent: AbilitySchema,
        technique: AbilitySchema,
        /** Enhanced Basic ATKs, follow-ups and other extra abilities. */
        extra: z.array(AbilitySchema).default([]),
      })
      .strict(),
    memosprite: MemospriteSchema.optional(),
    traces: z.array(TraceNodeSchema).min(1),
    eidolons: z.array(EidolonSchema).length(6),
    /** Ascension costs for phases 1..6 (index 0 = ascending from phase 0 to 1). */
    ascensionCosts: z.array(CostSchema).length(6),
    /** Item id of this character's Eidolon duplicate ("Eidolon item"). */
    eidolonItem: IdSchema,
    presentation: z
      .object({
        model: z.string(),
        portraitColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        voice: z.record(z.string(), z.string()).default({}),
        hooks: PresentationHooksSchema.optional(),
      })
      .strict(),
    lore: z.object({ title: TextSchema, faction: TextSchema, bio: TextSchema }).strict(),
  })
  .strict();
export type Character = z.infer<typeof CharacterSchema>;

/** Semantic checks that a schema cannot express. Returns readable problems. */
export function validateCharacter(c: Character): string[] {
  const problems: string[] = [];
  const ranks = c.eidolons.map((e) => e.rank).join(',');
  if (ranks !== '1,2,3,4,5,6') problems.push(`eidolons must be ranks 1..6 in order (got ${ranks})`);
  const ids = new Set<string>();
  for (const n of c.traces) {
    if (ids.has(n.id)) problems.push(`duplicate trace id "${n.id}"`);
    ids.add(n.id);
  }
  for (const n of c.traces) if (n.parent && !ids.has(n.parent)) problems.push(`trace "${n.id}" has unknown parent "${n.parent}"`);
  const expectKinds: Array<[keyof Character['abilities'], string]> = [
    ['basic', 'basic'],
    ['skill', 'skill'],
    ['ultimate', 'ultimate'],
    ['talent', 'talent'],
    ['technique', 'technique'],
  ];
  for (const [slot, kind] of expectKinds) {
    const a = c.abilities[slot];
    if (!Array.isArray(a) && a.kind !== kind) problems.push(`abilities.${slot} must have kind "${kind}" (got "${a.kind}")`);
  }
  if (c.path === 'Remembrance' && !c.memosprite) problems.push('Remembrance characters must define a memosprite');
  const allAbilities = [c.abilities.basic, c.abilities.skill, c.abilities.ultimate, c.abilities.talent, c.abilities.technique, ...c.abilities.extra];
  for (const a of allAbilities) {
    for (const e of [...a.effects, ...a.triggers.flatMap((t) => t.effects)]) {
      if (e.kind === 'summon' && e.unitType === 'memosprite' && e.unit !== c.memosprite?.id) {
        problems.push(`${a.id} summons unknown memosprite "${e.unit}"`);
      }
    }
  }
  return problems;
}

/** Player-owned character progress (saved). */
export interface CharacterInstance {
  readonly characterId: string;
  level: number;
  ascension: number;
  exp: number;
  /** 0..6 */
  eidolon: number;
  /** Trace node id -> level (ability nodes) or 1 (unlocked major/stat nodes). */
  traces: Record<string, number>;
  /** Light Cone instance uid. */
  lightCone: string | null;
  /** Relic slot -> relic instance uid. */
  relics: Partial<Record<'head' | 'hands' | 'body' | 'feet' | 'planarSphere' | 'linkRope', string>>;
}
