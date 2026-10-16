import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { Element } from '@models/common';
import type { BattleState } from '@models/combat';
import type { Advantage } from '@models/world';
import type { Battle, BattleResult } from './battle';

/**
 * COMBAT (Phase 5). A deterministic, data-driven turn-based battle engine, pure TypeScript with no
 * THREE or DOM, built on the Phase 1 models and formulas:
 *
 * - `Battle`: the runtime. Action Value timeline (first cycle 150 AV, then 100), party-shared Skill
 *   Points, Energy with ERR, Ultimate queue and inserted-action queue, targeting, the damage
 *   pipeline (`computeDamage` zones), Toughness and Weakness Break with the element break statuses,
 *   a status runtime (stat modifiers, DoT, crowd control), triggers, enemy AI, waves and rewards.
 * - A typed event stream (`BattleEvent`) the HUD, VFX and audio subscribe to.
 * - One seeded RNG per battle: the same seed gives an identical battle log.
 *
 * Stage 5A runs every generic effect and the 4 starter kits; script handlers, summons, memosprites,
 * revives and the remaining trigger events are declared stubs that log a "not yet implemented" line
 * (see `stubs.ts`). They land in Stage 5B.
 */
export interface CombatSystem {
  /** The battle currently running (null outside combat). */
  readonly battle: Battle | null;
  start(battle: Battle): void;
  end(): BattleResult | null;
}

/** Events added to the global bus by this module (the battle scene forwards the stream's key moments). */
declare module '@core/events' {
  interface GameEvents {
    'combat:started': { battleId: string; advantage: Advantage; enemies: readonly string[] };
    'combat:weaknessBreak': { targetUid: string; element: Element; sourceUid: string };
    'combat:ended': { battleId: string; outcome: BattleState['outcome']; cycles: number; turns: number };
  }
}

export const CombatToken = createToken<CombatSystem>('CombatSystem');

export const combatModule = defineStubModule({
  id: 'combat',
  name: 'Combat Engine',
  phase: 5,
  dependsOn: ['status', 'skills'],
});

export * from './battle';
export * from './data';
export * from './events';
export * from './loot';
export * from './registryData';
export * from './rng';
export * from './stats';
export * from './stubs';
export * from './targeting';
export * from './units';
export * from './session';
