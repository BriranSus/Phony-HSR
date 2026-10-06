import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { Cost } from '@models/common';

/**
 * ECONOMY (core ledger in Phase 9, shops/exchanges in Phase 12/20). The single, centralised place
 * where currencies and stackable items are added and spent (spec section 20). Every grant/spend is
 * a transaction with a reason, so achievements, analytics and save integrity all observe one API.
 */
export interface Transaction {
  readonly reason: string;
  readonly delta: Readonly<Record<string, number>>;
}

export interface EconomySystem {
  balance(itemId: string): number;
  canAfford(cost: Cost): boolean;
  /** Atomically spends the whole cost or nothing. */
  spend(cost: Cost, reason: string): boolean;
  grant(items: Cost, reason: string): void;
  history(): readonly Transaction[];
}

export const EconomyToken = createToken<EconomySystem>('EconomySystem');

export const economyModule = defineStubModule({ id: 'economy', name: 'Economy Ledger', phase: 9, dependsOn: [] });
