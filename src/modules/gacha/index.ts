import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { PityState } from '@models/gacha';

/**
 * GACHA / WARP (Phase 17). Banner rolls from data (0.6% base 5-star, soft pity from pull 74,
 * hard pity 90, 50/50 with guarantee for character banners; 75/25 and pity 80 for Light Cone
 * banners), 10-pull 4-star guarantee, shared pity groups, history and results. The RNG is behind
 * `WarpAuthority` so an online build can move rolls server-side.
 */
export interface WarpResult {
  readonly id: string;
  readonly rarity: 3 | 4 | 5;
  readonly featured: boolean;
  readonly isNew: boolean;
}

export interface WarpAuthority {
  roll(bannerId: string, count: 1 | 10, pity: PityState): Promise<{ results: WarpResult[]; pity: PityState }>;
}

export interface GachaSystem {
  warp(bannerId: string, count: 1 | 10): Promise<WarpResult[]>;
  pity(bannerId: string): PityState;
  history(bannerId?: string): ReadonlyArray<{ bannerId: string; result: string; rarity: number; at: string }>;
}

export const GachaToken = createToken<GachaSystem>('GachaSystem');

export const gachaModule = defineStubModule({ id: 'gacha', name: 'Warp (Gacha)', phase: 17, dependsOn: ['economy', 'characters', 'lightcones'] });
