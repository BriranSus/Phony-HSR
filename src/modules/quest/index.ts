import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { QuestProgress } from '@models/quest';

/**
 * QUESTS (Phase 13). Main / Adventure / Companion / Daily / Event / Tutorial missions defined in
 * `src/data/quests/`: prerequisites, branching objective graphs, markers, rewards (through the
 * economy) and quest state persistence. Listens to world/combat/dialogue events to progress.
 */
export interface QuestSystem {
  progress(questId: string): QuestProgress | undefined;
  accept(questId: string): void;
  tracked(): string | null;
  track(questId: string | null): void;
  /** Report a gameplay fact ("defeat enemy.hollow-scout", "reach area.x"). */
  notify(type: string, target: string, amount?: number): void;
}

export const QuestToken = createToken<QuestSystem>('QuestSystem');

export const questModule = defineStubModule({ id: 'quest', name: 'Quest System', phase: 13, dependsOn: ['world', 'economy'] });
