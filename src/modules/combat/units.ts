import type { Ability, StatModifier, Trigger } from '@models/ability';
import type { Character } from '@models/character';
import type { Combatant } from '@models/combat';
import type { Enemy, EnemyAbility } from '@models/enemy';
import { enemyDef, enemyStatAtLevel, grownStat, initialEnergy } from '@models/formulas';
import type { StatBlock, StatId } from '@models/stats';
import type { CombatData, PartyMemberSpec } from './data';

/**
 * Builds combatants from data (the combat side of the Phase 1 `UnitFactory` contract).
 *
 * Characters: base stats grown by level and ascension (`rules/progression`), plus every unlocked
 * Trace stat node as a permanent bonus. Unconditional and conditional Major Trace modifiers become
 * passive modifiers; Light Cones and relics arrive with the Phase 6 unit factory.
 * Enemies: template stats scaled by the real per-level table (`enemyStatAtLevel`); DEF comes from the
 * combat rules (200 + 10 x level).
 */

/** Engine-side bookkeeping for a unit (kept out of the serialisable `Combatant` shape). */
export interface UnitInfo {
  readonly uid: string;
  readonly character: Character | null;
  readonly enemy: Enemy | null;
  readonly passiveModifiers: readonly StatModifier[];
  readonly passiveTriggers: readonly Trigger[];
  /** Ability id -> turns until usable again (enemy `cooldown`). */
  cooldowns: Record<string, number>;
  /** A charged attack waiting to be released next turn (enemy `chargeTurns`). */
  charging: { abilityId: string; turnsLeft: number } | null;
  /** Index into `ai.sequence`. */
  sequenceIndex: number;
  turnsTaken: number;
  /** Trigger key -> activations this owner turn / this battle / turns until usable. */
  perTurn: Record<string, number>;
  perBattle: Record<string, number>;
  triggerCooldown: Record<string, number>;
  /** Wave the unit belongs to (enemies). */
  wave: number;
}

export const ABILITY_SLOTS = ['basic', 'skill', 'ultimate', 'talent', 'technique'] as const;
export type SlotName = (typeof ABILITY_SLOTS)[number];

/** Every ability of a unit by id (characters: the five slots plus extras; enemies: their own list). */
export function abilitiesOf(info: UnitInfo): readonly (Ability | EnemyAbility)[] {
  if (info.character) return [...ABILITY_SLOTS.map((s) => info.character!.abilities[s]), ...info.character.abilities.extra];
  return info.enemy?.abilities ?? [];
}

export function findAbility(info: UnitInfo, id: string): Ability | EnemyAbility | undefined {
  return abilitiesOf(info).find((a) => a.id === id);
}

/** The ability slot an ability occupies ("extra" for follow-ups and counters, "enemy" for enemies). */
export function slotOfAbility(info: UnitInfo, id: string): SlotName | 'extra' | 'enemy' {
  if (info.enemy) return 'enemy';
  for (const s of ABILITY_SLOTS) if (info.character?.abilities[s].id === id) return s;
  return 'extra';
}

export function newUnitInfo(uid: string, character: Character | null, enemy: Enemy | null, passive: { modifiers: StatModifier[]; triggers: Trigger[] }, wave: number): UnitInfo {
  return { uid, character, enemy, passiveModifiers: passive.modifiers, passiveTriggers: passive.triggers, cooldowns: {}, charging: null, sequenceIndex: 0, turnsTaken: 0, perTurn: {}, perBattle: {}, triggerCooldown: {}, wave };
}

export function buildCharacterUnit(data: CombatData, spec: PartyMemberSpec, uid: string): { unit: Combatant; info: UnitInfo } {
  const c = data.character(spec.characterId);
  const prog = data.progression;
  const eidolon = spec.eidolon ?? 0;
  const baseStats: StatBlock = {
    hp: grownStat(c.baseStats.hp, spec.level, spec.ascension, prog.character),
    atk: grownStat(c.baseStats.atk, spec.level, spec.ascension, prog.character),
    def: grownStat(c.baseStats.def, spec.level, spec.ascension, prog.character),
    spd: c.baseStats.spd,
    critRate: c.baseStats.critRate,
    critDmg: c.baseStats.critDmg,
    aggro: c.baseStats.aggro ?? 100,
  };
  const bonuses: StatBlock = {};
  const modifiers: StatModifier[] = [];
  const triggers: Trigger[] = [];
  for (const node of c.traces) {
    const req = node.requirements;
    if ((req.ascension ?? 0) > spec.ascension || (req.level ?? 1) > spec.level) continue;
    if (node.kind === 'stat' && node.stat) bonuses[node.stat.stat as StatId] = (bonuses[node.stat.stat as StatId] ?? 0) + node.stat.value;
    if (node.kind === 'major' && node.passive) {
      modifiers.push(...node.passive.modifiers);
      triggers.push(...node.passive.triggers);
    }
  }
  // Eidolons: ability level bonuses (E3 / E5 style) and their modifiers / triggers when reached.
  const levels: Record<string, number> = {
    basic: prog.abilityMaxLevel.basic,
    skill: prog.abilityMaxLevel.skill,
    ultimate: prog.abilityMaxLevel.ultimate,
    talent: prog.abilityMaxLevel.talent,
    technique: 1,
  };
  for (const e of c.eidolons) {
    if (e.rank > eidolon) continue;
    for (const [slot, bonus] of Object.entries(e.abilityLevelBonus ?? {})) levels[slot] = (levels[slot] ?? 0) + bonus;
    modifiers.push(...e.modifiers);
    triggers.push(...e.triggers);
  }
  const ult = c.ultimateResource;
  const unit: Combatant = {
    uid,
    kind: 'character',
    side: 'ally',
    defId: c.id,
    ownerUid: null,
    level: spec.level,
    element: c.element,
    rank: null,
    baseStats,
    bonuses,
    resources: Object.fromEntries(c.resources.map((r) => [r.id, r.initial])),
    phase: 0,
    abilityLevels: levels,
    hp: baseStats.hp! * (1 + (bonuses.hpPct ?? 0)) + (bonuses.hp ?? 0),
    ultimate:
      ult.kind === 'energy'
        ? { kind: 'energy', current: initialEnergy(ult.max, data.rules), max: ult.max, cost: ult.max }
        : { kind: 'points', current: ult.initial, max: ult.max, cost: ult.cost },
    toughness: 0,
    maxToughness: 0,
    broken: false,
    weaknesses: [],
    statuses: [],
    shield: 0,
    actionValue: 0,
    presence: 'active',
    onZeroHp: 'downed',
  };
  return { unit, info: newUnitInfo(uid, c, null, { modifiers, triggers }, 0) };
}

export function buildEnemyUnit(data: CombatData, enemyId: string, level: number, uid: string, wave: number): { unit: Combatant; info: UnitInfo } {
  const e = data.enemy(enemyId);
  const first = e.phases[0];
  const baseStats: StatBlock = {
    hp: enemyStatAtLevel(e.baseStats.hp, 'hp', level, data.progression),
    atk: enemyStatAtLevel(e.baseStats.atk, 'atk', level, data.progression),
    def: enemyDef(level, data.rules),
    spd: enemyStatAtLevel(e.baseStats.spd, 'spd', level, data.progression),
    critRate: 0,
    critDmg: 0,
    effectHitRate: e.baseStats.effectHitRate,
    effectRes: e.baseStats.effectRes,
  };
  const toughness = first?.toughness ?? e.toughness;
  const unit: Combatant = {
    uid,
    kind: 'enemy',
    side: 'enemy',
    defId: e.id,
    ownerUid: null,
    level,
    element: null,
    rank: e.rank,
    baseStats,
    bonuses: {},
    resources: {},
    phase: 0,
    abilityLevels: {},
    hp: baseStats.hp!,
    ultimate: null,
    toughness,
    maxToughness: toughness,
    broken: false,
    weaknesses: [...(first?.weaknesses ?? e.weaknesses)],
    statuses: [],
    shield: 0,
    actionValue: 0,
    presence: 'active',
    onZeroHp: 'downed',
  };
  return { unit, info: newUnitInfo(uid, null, e, { modifiers: [], triggers: [] }, wave) };
}
