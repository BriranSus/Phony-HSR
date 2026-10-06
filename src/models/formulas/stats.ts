import type { LevelScaled, ScalingCurves } from '../scaling';
import type { ProgressionRules } from '../rules';
import type { StatBlock, StatId } from '../stats';
import { PERCENT_OF } from '../stats';

/**
 * Stat growth and aggregation.
 */
export function levelCapFor(ascension: number, rules: Pick<ProgressionRules, 'levelCaps'>): number {
  const cap = rules.levelCaps[ascension];
  if (cap === undefined) throw new RangeError(`Invalid ascension phase ${ascension}`);
  return cap;
}

/** A level is legal for an ascension if it is within (previous cap, cap], or exactly the previous cap. */
export function isValidLevelForAscension(level: number, ascension: number, rules: Pick<ProgressionRules, 'levelCaps'>): boolean {
  const cap = levelCapFor(ascension, rules);
  const prev = ascension === 0 ? 1 : levelCapFor(ascension - 1, rules);
  return level >= prev && level <= cap;
}

/** stat = base x (1 + ascensionStep x asc) + base x levelGrowth x (level - 1) */
export function grownStat(base: number, level: number, ascension: number, curve: { levelGrowth: number; ascensionStep: number }): number {
  return base * (1 + curve.ascensionStep * ascension) + base * curve.levelGrowth * (level - 1);
}

/** Resolve a level-scaled ability value at an ability level. */
export function resolveLevelScaled(value: LevelScaled, level: number, curves: ScalingCurves): number {
  if (typeof value === 'number') return value;
  if ('table' in value) {
    const v = value.table[Math.min(level, value.table.length) - 1];
    if (v === undefined) throw new RangeError(`level ${level} out of table range`);
    return v;
  }
  const curve = curves.curves[value.curve];
  if (!curve) throw new Error(`Unknown scaling curve "${value.curve}"`);
  const ratio = curve.ratios[Math.min(level, curve.ratios.length) - 1];
  if (ratio === undefined) throw new RangeError(`level ${level} out of curve range`);
  return value.ref * ratio;
}

export function sumStats(...blocks: readonly StatBlock[]): StatBlock {
  const out: StatBlock = {};
  for (const b of blocks) {
    for (const [k, v] of Object.entries(b) as Array<[StatId, number | undefined]>) {
      if (v !== undefined) out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/**
 * Final value of HP/ATK/DEF/SPD: base x (1 + sum %) + sum flat, where `base` is the character's base
 * plus the Light Cone's base and `bonuses` holds every flat/percent bonus (relics, traces, buffs).
 */
export function aggregateStat(stat: 'hp' | 'atk' | 'def' | 'spd', base: number, bonuses: StatBlock): number {
  const pctKey = (Object.entries(PERCENT_OF) as Array<[StatId, StatId]>).find(([, of]) => of === stat)?.[0];
  const pct = pctKey ? (bonuses[pctKey] ?? 0) : 0;
  return base * (1 + pct) + (bonuses[stat] ?? 0);
}
