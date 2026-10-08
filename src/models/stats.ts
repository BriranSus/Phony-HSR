import { z } from 'zod';
import type { Element } from './common';

/**
 * Stat identifiers. Percent-type stats are stored as fractions (0.05 = 5%).
 *
 * Final panel stats follow the in-game aggregation:
 *   ATK = (character base ATK + light cone base ATK) * (1 + sum ATK%) + sum flat ATK
 *   SPD = character base SPD * (1 + sum SPD%) + sum flat SPD
 * (same for HP / DEF). See `aggregateStat` in models/formulas/stats.ts.
 */
export const PANEL_STATS = [
  'hp',
  'atk',
  'def',
  'spd',
  'hpPct',
  'atkPct',
  'defPct',
  'spdPct',
  'critRate',
  'critDmg',
  'breakEffect',
  'outgoingHealing',
  'maxEnergy',
  'energyRegen',
  'effectHitRate',
  'effectRes',
  'physicalDmg',
  'fireDmg',
  'iceDmg',
  'lightningDmg',
  'windDmg',
  'quantumDmg',
  'imaginaryDmg',
  'physicalRes',
  'fireRes',
  'iceRes',
  'lightningRes',
  'windRes',
  'quantumRes',
  'imaginaryRes',
] as const;

/** Hidden combat modifiers that live in the damage formula's multiplier zones. */
export const COMBAT_STATS = [
  'allDmg',
  'basicDmg',
  'skillDmg',
  'ultimateDmg',
  'followUpDmg',
  'dotDmg',
  'breakDmg',
  'superBreakDmg',
  'defIgnore',
  'defReduction',
  'resPen',
  'vulnerability',
  'dmgMitigation',
  'weaken',
  'critRateTaken',
  /** All-Type RES (reduces DMG taken of every Type). */
  'allRes',
  'shieldBonus',
  'incomingHealing',
  'breakEfficiency',
  'debuffRes',
  'aggro',
] as const;

export const STAT_IDS = [...PANEL_STATS, ...COMBAT_STATS] as const;
export const StatIdSchema = z.enum(STAT_IDS);
export type StatId = z.infer<typeof StatIdSchema>;

export type StatBlock = Partial<Record<StatId, number>>;
export const StatBlockSchema = z.partialRecord(StatIdSchema, z.number());

/** Stats whose values are flat numbers rather than fractions. */
export const FLAT_STATS: ReadonlySet<StatId> = new Set<StatId>(['hp', 'atk', 'def', 'spd', 'maxEnergy', 'aggro']);

export const ELEMENT_DMG_STAT: Readonly<Record<Element, StatId>> = {
  Physical: 'physicalDmg',
  Fire: 'fireDmg',
  Ice: 'iceDmg',
  Lightning: 'lightningDmg',
  Wind: 'windDmg',
  Quantum: 'quantumDmg',
  Imaginary: 'imaginaryDmg',
};

export const ELEMENT_RES_STAT: Readonly<Record<Element, StatId>> = {
  Physical: 'physicalRes',
  Fire: 'fireRes',
  Ice: 'iceRes',
  Lightning: 'lightningRes',
  Wind: 'windRes',
  Quantum: 'quantumRes',
  Imaginary: 'imaginaryRes',
};

/** Which base stat a percentage stat multiplies. */
export const PERCENT_OF: Readonly<Partial<Record<StatId, StatId>>> = {
  hpPct: 'hp',
  atkPct: 'atk',
  defPct: 'def',
  spdPct: 'spd',
};
