import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * CHARACTER PROGRESSION (Phase 9). Character EXP / levels / ascension (level caps 20..80),
 * Trace tree unlocks (ability levels, Major Traces A2/A4/A6, minor stat nodes) with level,
 * ascension, material and credit requirements, and Eidolons E1..E6.
 */
export type UpgradeCheck = { ok: true } | { ok: false; reason: 'level' | 'ascension' | 'materials' | 'credits' | 'maxed' | 'parentLocked' };

export interface ProgressionSystem {
  addExp(characterId: string, items: Record<string, number>): { levelsGained: number; refund: number };
  canAscend(characterId: string): UpgradeCheck;
  ascend(characterId: string): void;
  canUnlockTrace(characterId: string, nodeId: string): UpgradeCheck;
  unlockTrace(characterId: string, nodeId: string): void;
  unlockEidolon(characterId: string): number;
}

export const ProgressionToken = createToken<ProgressionSystem>('ProgressionSystem');

export const progressionModule = defineStubModule({ id: 'progression', name: 'Character Progression', phase: 9, dependsOn: ['characters', 'economy'] });
