import type { ItemStack } from '@models/common';
import type { Combatant } from '@models/combat';
import type { CombatData } from './data';
import type { SeededRng } from './rng';

/**
 * Battle rewards: every defeated enemy rolls its own loot table, or the table of its rank from
 * `rules/combat -> rewards.fallbackLoot` (placeholder rates, real item ids). Rolls use the battle's
 * seeded RNG, so a seed fixes the rewards too.
 */
export function rollRewards(data: CombatData, rng: SeededRng, defeated: readonly Combatant[]): ItemStack[] {
  const totals = new Map<string, number>();
  for (const unit of defeated) {
    const enemy = data.enemy(unit.defId);
    const tableId = enemy.lootTable ?? data.rules.rewards.fallbackLoot[enemy.rank];
    const table = tableId ? data.lootTable(tableId) : undefined;
    if (!table) continue;
    for (const entry of table.entries) {
      if (!rng.chance(entry.chance)) continue;
      const count = rng.int(entry.min, entry.max);
      if (count > 0) totals.set(entry.item, (totals.get(entry.item) ?? 0) + count);
    }
  }
  return [...totals.entries()].map(([item, count]) => ({ item, count }));
}
