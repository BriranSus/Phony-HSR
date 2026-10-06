import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * DAILY SYSTEM (Phase 20). Daily training missions and activity points, login rewards, stamina
 * regeneration for resource farming, daily (04:00 server time) and weekly resets and weekly
 * objectives.
 */
export interface DailySystem {
  readonly activity: number;
  checkResets(now: Date): { daily: boolean; weekly: boolean };
  claimActivityReward(tier: number): boolean;
}

export const DailyToken = createToken<DailySystem>('DailySystem');

export const dailyModule = defineStubModule({ id: 'daily', name: 'Daily & Weekly', phase: 20, dependsOn: ['quest', 'economy'] });
