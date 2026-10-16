import type { AttackType, Condition, StatModifier } from '@models/ability';
import type { Element } from '@models/common';
import type { Combatant } from '@models/combat';
import { aggregateStat } from '@models/formulas';
import type { StatBlock, StatId } from '@models/stats';
import type { StatusEffect } from '@models/status';
import type { CombatData } from './data';
import type { SeededRng } from './rng';
import type { UnitInfo } from './units';

/**
 * What the stat and condition code needs to know about a battle. `Battle` implements it; unit tests
 * can pass a small stub.
 */
export interface BattleView {
  readonly data: CombatData;
  readonly units: readonly Combatant[];
  readonly rng: SeededRng;
  info(uid: string): UnitInfo;
  unit(uid: string): Combatant;
}

/** Context of a stat query: who is being hit, with what, so conditional modifiers can resolve. */
export interface StatQuery {
  readonly target?: Combatant | null;
  readonly attackType?: AttackType | null;
  readonly element?: Element | null;
  readonly crit?: boolean;
  /** Allow `fixedChance` conditions to roll (only trigger conditions do; stat reads never consume RNG). */
  readonly allowRandom?: boolean;
}

const NO_QUERY: StatQuery = {};
const BASE_STATS = new Set<StatId>(['hp', 'atk', 'def', 'spd']);
const PCT_OF: Partial<Record<StatId, StatId>> = { hp: 'hpPct', atk: 'atkPct', def: 'defPct', spd: 'spdPct' };

export const isActive = (u: Combatant): boolean => u.presence === 'active';

export function opposing(b: BattleView, unit: Combatant): Combatant[] {
  return b.units.filter((u) => u.side !== unit.side && isActive(u));
}

export function allies(b: BattleView, unit: Combatant): Combatant[] {
  return b.units.filter((u) => u.side === unit.side && isActive(u));
}

/** Is a status a Slow (reduces SPD)? */
export function isSlow(b: BattleView, s: { statusId: string; params: Readonly<Record<string, number>>; stacks: number }): boolean {
  const def = statusDef(b, s.statusId);
  return (def?.modifiers ?? []).some((m) => (m.stat === 'spdPct' || m.stat === 'spd') && modifierValue(m, s.params, s.stacks) < 0);
}

export function statusDef(b: BattleView, id: string): StatusEffect | undefined {
  try {
    return b.data.status(id);
  } catch {
    return undefined;
  }
}

/** A modifier's numeric value for a status instance (or a passive): params, negate and stack scaling. */
export function modifierValue(m: StatModifier, params: Readonly<Record<string, number>>, stacks: number): number {
  const raw = m.value;
  let v: number;
  if (typeof raw === 'number') v = raw;
  else if ('param' in raw) v = params[raw.param] ?? 0;
  else v = 0; // curve / table values only occur in abilities, never in modifiers of statuses and traces
  if (m.negate) v = -v;
  if (m.scaling?.per === 'statusStacks') v *= Math.max(1, stacks);
  return v;
}

interface Source {
  readonly owner: Combatant;
  readonly modifier: StatModifier;
  readonly params: Readonly<Record<string, number>>;
  readonly stacks: number;
}

function modifierSources(b: BattleView, subject: Combatant): Source[] {
  const out: Source[] = [];
  for (const owner of b.units) {
    if (!isActive(owner) && owner !== subject) continue;
    const info = b.info(owner.uid);
    const take = (m: StatModifier, params: Readonly<Record<string, number>>, stacks: number): void => {
      const scope = m.scope;
      const applies =
        scope === 'self'
          ? owner === subject
          : scope === 'team'
            ? owner.side === subject.side
            : scope === 'teamExceptSelf'
              ? owner.side === subject.side && owner !== subject
              : scope === 'allEnemies'
                ? owner.side !== subject.side
                : false;
      if (applies) out.push({ owner, modifier: m, params, stacks });
    };
    for (const m of info.passiveModifiers) take(m, {}, 1);
    for (const s of owner.statuses) {
      const def = statusDef(b, s.statusId);
      for (const m of def?.modifiers ?? []) take(m, s.params, s.stacks);
    }
  }
  return out;
}

/** Final value of a stat for a unit: base, permanent bonuses and every active modifier. */
export function statValue(b: BattleView, unit: Combatant, stat: StatId, q: StatQuery = NO_QUERY): number {
  const sum: StatBlock = { ...unit.bonuses };
  // Only modifiers of this stat (and its percent twin) matter; skipping the rest also keeps
  // conditional modifiers from re-entering the stat they are conditioned on (HP-based conditions).
  const pct = PCT_OF[stat];
  for (const src of modifierSources(b, unit)) {
    if (src.modifier.stat !== stat && src.modifier.stat !== pct) continue;
    if (src.modifier.conditions?.some((c) => !evalCondition(b, c, src.owner, q))) continue;
    sum[src.modifier.stat] = (sum[src.modifier.stat] ?? 0) + modifierValue(src.modifier, src.params, src.stacks);
  }
  return finish(unit, stat, sum);
}

function finish(unit: Combatant, stat: StatId, sum: StatBlock): number {
  if (BASE_STATS.has(stat)) return aggregateStat(stat as 'hp' | 'atk' | 'def' | 'spd', unit.baseStats[stat] ?? 0, sum);
  if (stat === 'aggro') return (unit.baseStats.aggro ?? 0) * Math.max(0, 1 + (sum.aggro ?? 0));
  return (unit.baseStats[stat] ?? 0) + (sum[stat] ?? 0);
}

export const maxHp = (b: BattleView, unit: Combatant): number => statValue(b, unit, 'hp');

function hasParams(c: Condition): Record<string, unknown> {
  return c.params ?? {};
}

/** Condition registry: a closed list of types (see `CONDITION_TYPES`); unknown ones never match. */
export function evalCondition(b: BattleView, c: Condition, owner: Combatant, q: StatQuery = NO_QUERY): boolean {
  const p = hasParams(c);
  const target = q.target ?? null;
  const num = (k: string): number => Number(p[k] ?? 0);
  const str = (k: string): string => String(p[k] ?? '');
  const hpRatio = (u: Combatant): number => u.hp / Math.max(1, maxHp(b, u));
  switch (c.type) {
    case 'attackType': {
      const is = p.is;
      return q.attackType != null && (Array.isArray(is) ? is.includes(q.attackType) : is === q.attackType);
    }
    case 'damageElement':
      return q.element != null && p.is === q.element;
    case 'isCrit':
      return q.crit === true;
    case 'hasStatus':
      return owner.statuses.some((s) => s.statusId === str('status'));
    case 'targetHasStatus':
      return target?.statuses.some((s) => s.statusId === str('status')) ?? false;
    case 'attackerHasStatus':
      return owner.statuses.some((s) => s.statusId === str('status'));
    case 'hpBelow':
      return hpRatio(owner) < num('ratio');
    case 'hpAtLeast':
      return hpRatio(owner) >= num('ratio');
    case 'targetHpBelow':
      return target !== null && hpRatio(target) < num('ratio');
    case 'targetHpAtLeast':
      return target !== null && hpRatio(target) >= num('ratio');
    case 'statAtLeast':
      return statValue(b, owner, str('stat') as StatId) >= num('value');
    case 'targetIsWeaknessBroken':
      return target?.broken ?? false;
    case 'targetIsDebuffed':
      return target?.statuses.some((s) => statusDef(b, s.statusId)?.kind === 'debuff') ?? false;
    case 'targetIsSlowed':
      return target?.statuses.some((s) => isSlow(b, s)) ?? false;
    case 'targetHasDot':
      return target?.statuses.some((s) => statusDef(b, s.statusId)?.category === 'dot') ?? false;
    case 'targetHasWeakness':
      return target?.weaknesses.includes(str('element') as Element) ?? false;
    case 'targetHasShield':
      return (target?.shield ?? 0) > 0;
    case 'debuffCountAtLeast':
      return (target?.statuses.filter((s) => statusDef(b, s.statusId)?.kind === 'debuff').length ?? 0) >= num('count');
    case 'enemyCountAtMost':
      return opposing(b, owner).length <= num('count');
    case 'energyFull':
      return owner.ultimate !== null && owner.ultimate.current >= owner.ultimate.max - 1e-9;
    case 'resourceAtLeast':
      return (owner.resources[str('resource')] ?? 0) >= num('value');
    case 'fixedChance':
      return q.allowRandom === true ? b.rng.chance(num('chance')) : false;
    default:
      return false;
  }
}
