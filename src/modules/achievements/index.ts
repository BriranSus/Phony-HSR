import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * ACHIEVEMENTS (Phase 20). Data-defined achievements in categories (combat, exploration, character,
 * story, collection, event, hidden) with progress counters driven by bus events, completion state
 * and claimable rewards.
 */
export interface AchievementSystem {
  progress(id: string): { value: number; target: number; completed: boolean; claimed: boolean };
  claim(id: string): boolean;
}

export const AchievementToken = createToken<AchievementSystem>('AchievementSystem');

export const achievementsModule = defineStubModule({ id: 'achievements', name: 'Achievements', phase: 20, dependsOn: ['economy'] });
