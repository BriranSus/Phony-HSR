import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { BattleState, Combatant, DamageEvent, PlayerAction, TurnOrderEntry } from '@models/combat';
import type { Element } from '@models/common';

/**
 * COMBAT (Phase 5 engine, Phase 8 weakness/break).
 *
 * Turn-based battle simulation: Action Value timeline, party-shared Skill Points, Energy and
 * Ultimate insertion, toughness / Weakness Break, damage pipeline (models/formulas/damage.ts),
 * follow-ups, counters and wave handling. The engine is presentation-free: it emits events that
 * the UI, camera, VFX and audio modules react to, so it can run headless in tests and simulations.
 *
 * Units come from `UnitFactory` implementations registered by the characters and enemies modules,
 * so new characters never require engine changes.
 */
export interface EncounterSpec {
  readonly id: string;
  /** Enemy ids per wave. */
  readonly waves: readonly (readonly string[])[];
  readonly enemyLevel: number;
  /** Party character ids in slot order. */
  readonly party: readonly string[];
  /** Techniques used before the battle (character ids). */
  readonly techniques?: readonly string[];
}

export interface UnitFactory {
  readonly kind: 'character' | 'enemy' | 'memosprite';
  canCreate(defId: string): boolean;
  create(defId: string, level: number): Combatant;
}

export interface CombatSystem {
  registerUnitFactory(factory: UnitFactory): void;
  startBattle(spec: EncounterSpec): BattleState;
  /** Player input for the active ally's turn. */
  submitAction(action: PlayerAction): void;
  /** Queue an Ultimate; it is inserted before the next turn (can interrupt enemy turns). */
  queueUltimate(unitUid: string, targetUid: string): void;
  turnOrder(count: number): TurnOrderEntry[];
  readonly state: BattleState | null;
}

/** Events added to the global bus by this module. */
declare module '@core/events' {
  interface GameEvents {
    'combat:started': { battleId: string };
    'combat:turnStarted': { uid: string; avElapsed: number };
    'combat:damage': DamageEvent;
    'combat:weaknessBreak': { targetUid: string; element: Element; sourceUid: string };
    'combat:ended': { battleId: string; outcome: BattleState['outcome'] };
  }
}

export const CombatToken = createToken<CombatSystem>('CombatSystem');

export const combatModule = defineStubModule({
  id: 'combat',
  name: 'Combat Engine',
  phase: 5,
  dependsOn: ['status', 'skills'],
});
