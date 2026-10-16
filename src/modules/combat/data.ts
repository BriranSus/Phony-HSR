import type { Character } from '@models/character';
import type { Enemy, LootTable } from '@models/enemy';
import type { CombatRules, ProgressionRules } from '@models/rules';
import type { ScalingCurves } from '@models/scaling';
import type { StatusEffect } from '@models/status';

/**
 * Everything the combat engine reads from data, behind one interface so the engine stays free of the
 * data registry: the app builds it from the loaded `DataRegistry`, tests build it from the bundled
 * JSON. Nothing about a character, enemy, status or rule is hardcoded in the engine.
 */
export interface CombatData {
  readonly rules: CombatRules;
  readonly progression: ProgressionRules;
  readonly curves: ScalingCurves;
  character(id: string): Character;
  enemy(id: string): Enemy;
  status(id: string): StatusEffect;
  lootTable(id: string): LootTable | undefined;
}

/**
 * One party member of a battle: a character at a level and Eidolon rank. Light Cones and relics are
 * equipped by the Phase 6 unit factory; in 5A a unit is the character plus its unlocked Traces.
 */
export interface PartyMemberSpec {
  readonly characterId: string;
  readonly level: number;
  readonly ascension: number;
  /** Eidolon rank 0..6 (E3 / E5 raise ability levels). */
  readonly eidolon?: number;
}
