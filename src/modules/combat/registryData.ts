import type { DataRegistry } from '@core/data/DataRegistry';
import { Collections } from '@models/collections';
import type { CombatData } from './data';

/** Builds the engine's data view from a loaded `DataRegistry` (the app and the tests both use it). */
export function combatDataFrom(registry: DataRegistry): CombatData {
  return {
    rules: registry.get(Collections.combatRules, 'default'),
    progression: registry.get(Collections.progressionRules, 'default'),
    curves: registry.get(Collections.scalingCurves, 'default'),
    character: (id) => registry.get(Collections.characters, id),
    enemy: (id) => registry.get(Collections.enemies, id),
    status: (id) => registry.get(Collections.statusEffects, id),
    lootTable: (id) => registry.find(Collections.lootTables, id),
  };
}
