import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { BattleState, Combatant, CombatantKind, DamageEvent, InsertedAction, PlayerAction, TurnOrderEntry } from '@models/combat';
import type { CharacterInstance } from '@models/character';
import type { LightConeInstance } from '@models/lightcone';
import type { RelicInstance } from '@models/relic';
import type { Element } from '@models/common';

/**
 * COMBAT (Phase 5 engine, Phase 8 weakness/break).
 *
 * Turn-based battle simulation: Action Value timeline, party-shared Skill Points, Ultimate
 * resources (Energy or points) and Ultimate insertion, inserted actions (follow-ups, counters, extra
 * turns, immediate memosprite actions), memosprites, toughness / Weakness Break, damage pipeline
 * (models/formulas/damage.ts) and wave handling. The engine is presentation-free: it emits events
 * that the UI, camera, VFX and audio modules react to, so it can run headless in tests and simulations.
 *
 * Units come from `UnitFactory` implementations registered by the characters and enemies modules,
 * so new characters never require engine changes.
 */

/**
 * Everything needed to build a playable character unit: the owned instance (level, ascension,
 * Eidolon, Trace levels) plus the equipped Light Cone and relic instances it references.
 */
export interface CharacterBuildSpec {
  readonly kind: 'character';
  readonly instance: CharacterInstance;
  readonly lightCone: LightConeInstance | null;
  readonly relics: readonly RelicInstance[];
}

export interface EnemyBuildSpec {
  readonly kind: 'enemy';
  readonly enemyId: string;
  readonly level: number;
}

/** Memosprites and summons derive stats from their owner (e.g. Max HP = ratio x owner Max HP + flat). */
export interface OwnedUnitBuildSpec {
  readonly kind: 'memosprite' | 'summon';
  readonly defId: string;
  readonly owner: Combatant;
}

export type UnitBuildSpec = CharacterBuildSpec | EnemyBuildSpec | OwnedUnitBuildSpec;

export interface UnitFactory {
  readonly kind: CombatantKind;
  canCreate(spec: UnitBuildSpec): boolean;
  /** Builds a fresh combatant (stats from level/ascension, Light Cone, relics, Traces and Eidolons). */
  create(spec: UnitBuildSpec, uid: string): Combatant;
}

export interface EncounterSpec {
  readonly id: string;
  /** Enemy ids per wave. */
  readonly waves: readonly (readonly string[])[];
  readonly enemyLevel: number;
  /** Party members in slot order, fully built from the player's instances. */
  readonly party: readonly CharacterBuildSpec[];
  /** Techniques used before the battle (character ids). */
  readonly techniques?: readonly string[];
}

export interface CombatSystem {
  registerUnitFactory(factory: UnitFactory): void;
  startBattle(spec: EncounterSpec): BattleState;
  /** Player input for the active ally's (or memosprite's) turn. */
  submitAction(action: PlayerAction): void;
  /** Queue an Ultimate; it is inserted before the next action (can interrupt enemy turns). */
  queueUltimate(unitUid: string, targetUid: string): void;
  /** Queue a follow-up, counter, extra turn or immediate memosprite action (used by triggers). */
  insertAction(action: Omit<InsertedAction, 'seq'>): void;
  turnOrder(count: number): TurnOrderEntry[];
  readonly state: BattleState | null;
}

/** Events added to the global bus by this module. */
declare module '@core/events' {
  interface GameEvents {
    'combat:started': { battleId: string };
    'combat:turnStarted': { uid: string; avElapsed: number; inserted: InsertedAction['kind'] | null };
    'combat:damage': DamageEvent;
    'combat:weaknessBreak': { targetUid: string; element: Element; sourceUid: string };
    'combat:unitEntered': { uid: string; kind: CombatantKind; ownerUid: string | null };
    'combat:unitLeft': { uid: string; reason: 'downed' | 'leftField' };
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
