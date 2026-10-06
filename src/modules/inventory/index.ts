import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { ItemCategory } from '@models/item';

/**
 * INVENTORY (Phase 12). Player-facing view over the economy ledger plus Light Cone and Relic
 * instances: tabs per category, search, filter, sort, lock, item details, usage and enhancement
 * entry points.
 */
export interface InventoryEntry {
  readonly id: string;
  readonly kind: 'stack' | 'lightCone' | 'relic';
  readonly category: ItemCategory | 'lightCone' | 'relic';
  readonly count: number;
  readonly rarity: number;
  readonly locked: boolean;
}

export interface InventoryQuery {
  readonly tab: ItemCategory | 'lightCone' | 'relic' | 'all';
  readonly search?: string;
  readonly sort?: 'rarity' | 'count' | 'name' | 'obtained';
  readonly descending?: boolean;
}

export interface InventorySystem {
  query(q: InventoryQuery): readonly InventoryEntry[];
  use(itemId: string, count: number, targetCharacter?: string): boolean;
  setLocked(entryId: string, locked: boolean): void;
}

export const InventoryToken = createToken<InventorySystem>('InventorySystem');

export const inventoryModule = defineStubModule({ id: 'inventory', name: 'Inventory', phase: 12, dependsOn: ['economy', 'lightcones', 'relics'] });
