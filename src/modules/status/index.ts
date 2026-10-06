import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { ActiveStatus, Combatant } from '@models/combat';

/**
 * STATUS EFFECTS (Phase 5). Applies, stacks, ticks and removes buffs, debuffs, DoTs, crowd control
 * and shields defined in `src/data/status-effects/`. Weakness Break effects are ordinary statuses.
 * Durations tick on the owner's (or caster's) turn start/end exactly as configured in data.
 */
export interface ApplyResult {
  readonly applied: boolean;
  /** Effect-hit roll result (debuffs only). */
  readonly resisted: boolean;
  readonly status: ActiveStatus | null;
}

export interface StatusSystem {
  apply(target: Combatant, statusId: string, sourceUid: string, opts?: { duration?: number; stacks?: number; chance?: number; params?: Record<string, number> }): ApplyResult;
  remove(target: Combatant, statusId: string): void;
  dispel(target: Combatant, kind: 'buff' | 'debuff', count: number): string[];
  /** Called by the combat engine at turn boundaries. */
  tick(owner: Combatant, when: 'turnStart' | 'turnEnd'): void;
}

export const StatusToken = createToken<StatusSystem>('StatusSystem');

export const statusModule = defineStubModule({ id: 'status', name: 'Status Effects', phase: 5, dependsOn: [] });
