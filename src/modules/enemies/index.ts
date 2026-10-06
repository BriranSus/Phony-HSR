import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { BattleState, Combatant } from '@models/combat';
import type { EnemyAbility } from '@models/enemy';

/**
 * ENEMIES (Phase 7; bosses in Phase 7/20). Enemy unit factory with level scaling, AI
 * (sequence / weighted / scripted), multi-phase bosses (HP thresholds, phase-specific
 * weaknesses/toughness, summons, charge-up attacks, enrage) and loot tables.
 */
export interface EnemyAI {
  chooseAbility(self: Combatant, battle: BattleState): EnemyAbility;
  chooseTarget(self: Combatant, ability: EnemyAbility, battle: BattleState): string;
}

export interface EnemySystem {
  registerAIScript(id: string, ai: EnemyAI): void;
  rollLoot(lootTableId: string, rng: () => number): Array<{ item: string; count: number }>;
}

export const EnemyToken = createToken<EnemySystem>('EnemySystem');

export const enemiesModule = defineStubModule({ id: 'enemies', name: 'Enemy Framework', phase: 7, dependsOn: ['combat', 'skills'] });
