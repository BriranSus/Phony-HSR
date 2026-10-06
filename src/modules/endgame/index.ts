import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * ENDGAME (Phase 20). Memory-style multi-wave stages scored by cycles, score-based and boss
 * challenge modes, weekly rotations, star ratings and reward tiers.
 */
export interface StageResult {
  readonly stageId: string;
  readonly stars: 0 | 1 | 2 | 3;
  readonly cyclesUsed: number;
  readonly score?: number;
}

export interface EndgameSystem {
  currentRotation(now: Date): string;
  startStage(stageId: string, teams: readonly (readonly string[])[]): void;
  record(result: StageResult): void;
}

export const EndgameToken = createToken<EndgameSystem>('EndgameSystem');

export const endgameModule = defineStubModule({ id: 'endgame', name: 'Endgame Modes', phase: 20, dependsOn: ['combat', 'enemies', 'economy'] });
