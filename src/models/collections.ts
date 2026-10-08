import { defineCollection, type CollectionDef, type DataRef } from '@core/data/DataRegistry';
import type { Ability, Effect, Trigger } from './ability';
import type { Cost } from './common';
import { CharacterSchema, validateCharacter } from './character';
import { EnemySchema, LootTableSchema, validateEnemy } from './enemy';
import { LightConeSchema, validateLightCone } from './lightcone';
import { RelicSetSchema, RelicStatTablesSchema, validateRelicSet } from './relic';
import { CostTableSchema, ItemSchema, ScriptHandlerSchema } from './item';
import { StatusEffectSchema } from './status';
import { ScalingCurvesSchema } from './scaling';
import { BannerSchema } from './gacha';
import { DialogueSchema, QuestSchema } from './quest';
import {
  CombatRulesSchema,
  ElementDefSchema,
  InputBindingsSchema,
  LoadingTipSchema,
  PathDefSchema,
  ProgressionRulesSchema,
} from './rules';

/**
 * Catalog of every data collection. Adding content = dropping a JSON file into the collection's
 * directory under `src/data/`. Adding a new kind of content = one entry here + a schema.
 */

function effectRefs(effects: readonly Effect[], at: string): DataRef[] {
  const refs: DataRef[] = [];
  effects.forEach((e, i) => {
    if (e.kind === 'applyStatus' || e.kind === 'removeStatus') refs.push({ collection: 'statusEffects', id: e.status, at: `${at}[${i}].status` });
    if (e.kind === 'applyRandomStatus') for (const st of e.pool) refs.push({ collection: 'statusEffects', id: st, at: `${at}[${i}].pool` });
    if (e.kind === 'detonateDot') for (const st of e.statuses ?? []) refs.push({ collection: 'statusEffects', id: st, at: `${at}[${i}].statuses` });
    if (e.kind === 'summon' && e.unitType === 'enemy') refs.push({ collection: 'enemies', id: e.unit, at: `${at}[${i}].unit` });
  });
  return refs;
}

/** Script handler ids used anywhere in a record: `script` effects and `script` fields (statuses, Eidolons, Traces). */
function scriptRefs(value: unknown, at: string): DataRef[] {
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.kind === 'script' && typeof o.handler === 'string') ids.add(o.handler);
      if (typeof o.script === 'string') ids.add(o.script);
      Object.values(o).forEach(walk);
    }
  };
  walk(value);
  return [...ids].map((id) => ({ collection: 'scriptHandlers', id, at }));
}

function triggerRefs(triggers: readonly Trigger[], at: string): DataRef[] {
  return triggers.flatMap((t, i) => effectRefs(t.effects, `${at}[${i}].effects`));
}

function abilityRefs(a: Ability, at: string): DataRef[] {
  return [...effectRefs(a.effects, `${at}.effects`), ...triggerRefs(a.triggers, `${at}.triggers`)];
}

function costRefs(costs: readonly Cost[], at: string): DataRef[] {
  return costs.flatMap((c, i) => c.map((s, j) => ({ collection: 'items', id: s.item, at: `${at}[${i}][${j}].item` })));
}

export const Collections = {
  // Boot-time collections first: the loading screen shows a tip as soon as tips are loaded.
  loadingTips: defineCollection({ name: 'loadingTips', dir: 'ui/tips', format: 'list', schema: LoadingTipSchema }),
  inputBindings: defineCollection({ name: 'inputBindings', dir: 'input', format: 'item', schema: InputBindingsSchema }),
  combatRules: defineCollection({ name: 'combatRules', dir: 'rules/combat', format: 'item', schema: CombatRulesSchema,
    references: (r) =>
      Object.entries(r.weaknessBreak.elements).map(([el, b]) => ({
        collection: 'statusEffects',
        id: b.status,
        at: `weaknessBreak.elements.${el}.status`,
      })),
  }),
  progressionRules: defineCollection({ name: 'progressionRules', dir: 'rules/progression', format: 'item', schema: ProgressionRulesSchema }),
  scalingCurves: defineCollection({ name: 'scalingCurves', dir: 'rules/scaling', format: 'item', schema: ScalingCurvesSchema }),
  elements: defineCollection({ name: 'elements', dir: 'elements', format: 'list', schema: ElementDefSchema }),
  paths: defineCollection({ name: 'paths', dir: 'paths', format: 'list', schema: PathDefSchema }),
  statusEffects: defineCollection({
    name: 'statusEffects',
    dir: 'status-effects',
    format: 'list',
    schema: StatusEffectSchema,
    references: (s) => [...triggerRefs(s.triggers, 'triggers'), ...scriptRefs(s, 'script')],
  }),
  scriptHandlers: defineCollection({ name: 'scriptHandlers', dir: 'script-handlers', format: 'list', schema: ScriptHandlerSchema }),
  items: defineCollection({ name: 'items', dir: 'items', format: 'list', schema: ItemSchema }),
  costTables: defineCollection({
    name: 'costTables',
    dir: 'cost-tables',
    format: 'list',
    schema: CostTableSchema,
    references: (t) => costRefs(t.steps, 'steps'),
  }),
  characters: defineCollection({
    name: 'characters',
    dir: 'characters',
    format: 'item',
    schema: CharacterSchema,
    validate: validateCharacter,
    references: (c) => [
      ...(['basic', 'skill', 'ultimate', 'talent', 'technique'] as const).flatMap((s) => abilityRefs(c.abilities[s], `abilities.${s}`)),
      ...c.abilities.extra.flatMap((a, i) => abilityRefs(a, `abilities.extra[${i}]`)),
      ...(c.memosprite?.abilities ?? []).flatMap((a, i) => abilityRefs(a, `memosprite.abilities[${i}]`)),
      ...c.traces.flatMap((t) => [
        { collection: 'costTables', id: t.costTable, at: `traces.${t.id}.costTable` },
        ...triggerRefs(t.passive?.triggers ?? [], `traces.${t.id}.passive.triggers`),
      ]),
      ...c.eidolons.flatMap((e) => triggerRefs(e.triggers, `eidolons[${e.rank}].triggers`)),
      ...costRefs(c.ascensionCosts, 'ascensionCosts'),
      { collection: 'items', id: c.eidolonItem, at: 'eidolonItem' },
      ...c.summons.flatMap((s) => s.abilities.flatMap((a, i) => abilityRefs(a, `summons.${s.id}.abilities[${i}]`))),
      ...scriptRefs(c, 'script handlers'),
    ],
  }),
  enemies: defineCollection({
    name: 'enemies',
    dir: 'enemies',
    format: 'item',
    schema: EnemySchema,
    validate: validateEnemy,
    references: (e) => [
      ...e.abilities.flatMap((a, i) => abilityRefs(a, `abilities[${i}]`)),
      ...e.phases.flatMap((p) => [
        ...p.summons.map((s) => ({ collection: 'enemies', id: s, at: `phases.${p.id}.summons` })),
        ...effectRefs(p.onEnter, `phases.${p.id}.onEnter`),
      ]),
      ...(e.lootTable ? [{ collection: 'lootTables', id: e.lootTable, at: 'lootTable' }] : []),
      ...scriptRefs(e, 'script handlers'),
    ],
  }),
  lootTables: defineCollection({
    name: 'lootTables',
    dir: 'loot-tables',
    format: 'list',
    schema: LootTableSchema,
    references: (l) => l.entries.map((e, i) => ({ collection: 'items', id: e.item, at: `entries[${i}].item` })),
  }),
  lightCones: defineCollection({
    name: 'lightCones',
    dir: 'light-cones',
    format: 'item',
    schema: LightConeSchema,
    validate: validateLightCone,
    references: (lc) => [...costRefs(lc.ascensionCosts, 'ascensionCosts'), ...triggerRefs(lc.passive.triggers, 'passive.triggers'), ...scriptRefs(lc.passive, 'passive')],
  }),
  relicSets: defineCollection({
    name: 'relicSets',
    dir: 'relics/sets',
    format: 'list',
    schema: RelicSetSchema,
    validate: validateRelicSet,
    references: (s) => [...s.bonuses.flatMap((b) => triggerRefs(b.triggers, `bonuses[${b.pieces}].triggers`)), ...scriptRefs(s, 'bonuses')],
  }),
  relicStatTables: defineCollection({ name: 'relicStatTables', dir: 'relics/stat-tables', format: 'item', schema: RelicStatTablesSchema }),
  banners: defineCollection({
    name: 'banners',
    dir: 'banners',
    format: 'item',
    schema: BannerSchema,
    references: (b) => [
      { collection: 'items', id: b.cost.item, at: 'cost.item' },
      ...[...b.pools.fiveStar, ...b.pools.fourStar, ...b.pools.threeStar, ...b.featured.fiveStar, ...b.featured.fourStar].map((id) => ({
        collection: ['characters', 'lightCones'],
        id,
        at: 'pools/featured',
      })),
    ],
  }),
  quests: defineCollection({
    name: 'quests',
    dir: 'quests',
    format: 'item',
    schema: QuestSchema,
    references: (q) => [
      ...q.objectives.flatMap((o) => (o.dialogue ? [{ collection: 'dialogues', id: o.dialogue, at: `objectives.${o.id}.dialogue` }] : [])),
      ...q.rewards.map((r, i) => ({ collection: 'items', id: r.item, at: `rewards[${i}]` })),
      ...q.prerequisites.quests.map((id) => ({ collection: 'quests', id, at: 'prerequisites.quests' })),
    ],
    validate: (q) => {
      const ids = new Set(q.objectives.map((o) => o.id));
      const problems: string[] = [];
      if (!ids.has(q.start)) problems.push(`start objective "${q.start}" does not exist`);
      for (const o of q.objectives) {
        const next = Array.isArray(o.next) ? o.next : Object.values(o.next).flat();
        for (const n of next) if (!ids.has(n)) problems.push(`objective "${o.id}" points to missing objective "${n}"`);
      }
      return problems;
    },
  }),
  dialogues: defineCollection({ name: 'dialogues', dir: 'dialogues', format: 'item', schema: DialogueSchema }),
} as const;

export const ALL_COLLECTIONS: readonly CollectionDef[] = Object.values(Collections);
