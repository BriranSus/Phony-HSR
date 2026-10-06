import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { RelicInstance, RelicSlot } from '@models/relic';
import type { StatId } from '@models/stats';

/**
 * RELICS (Phase 11). Generation (weighted main stat per slot, 3-4 initial substats), enhancement
 * (+3/+6/+9/+12/+15 substat rolls), 2/4-piece Cavern and 2-piece Planar set bonuses, lock,
 * discard/salvage, comparison, filtering and sorting.
 */
export interface RelicFilter {
  readonly sets?: readonly string[];
  readonly slots?: readonly RelicSlot[];
  readonly mainStats?: readonly StatId[];
  readonly subStats?: readonly StatId[];
  readonly minRarity?: number;
  readonly equipped?: boolean;
}

export type RelicSort = 'rarity' | 'level' | 'obtained' | 'substatScore';

export interface RelicSystem {
  generate(setId: string, slot: RelicSlot, rarity: 2 | 3 | 4 | 5, rng: () => number): RelicInstance;
  enhance(uid: string, expMaterials: Record<string, number>, fodder: readonly string[], rng: () => number): RelicInstance;
  query(filter: RelicFilter, sort: RelicSort): readonly RelicInstance[];
  setLocked(uid: string, locked: boolean): void;
  salvage(uids: readonly string[]): Record<string, number>;
  activeSetBonuses(characterId: string): Array<{ setId: string; pieces: 2 | 4 }>;
}

export const RelicToken = createToken<RelicSystem>('RelicSystem');

export const relicsModule = defineStubModule({ id: 'relics', name: 'Relics', phase: 11, dependsOn: ['characters', 'economy'] });
