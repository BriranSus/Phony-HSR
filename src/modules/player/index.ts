import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { Gait } from './movement';

/**
 * PLAYER CONTROLLER (Phase 2). Third-person overworld movement driven by input actions:
 * camera-relative walk / run / sprint with acceleration, turn-rate limited facing, capsule
 * collision against static level geometry (walls, slopes, step-up, ground snapping; no jump),
 * party switching (1-4, position kept), proximity interaction prompts (F), and hooks for the
 * Technique (E) and the overworld attack (Q / left click) that later start encounters (Phase 5).
 *
 * The simulation (`OverworldController`) is pure and unit-tested; the app layer feeds it a
 * `ControlInput` from the action map and renders the result. Every tunable lives in
 * `rules/locomotion/default.json`, the party in `parties/`, levels in `levels/`.
 */
export type LocomotionState = 'idle' | 'walk' | 'run' | 'sprint';

export interface PlayerController {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  readonly gait: Gait;
  readonly state: string;
  readonly leaderId: string;
  switchLeader(characterId: string): boolean;
  teleport(x: number, y: number, z: number): void;
  setControlEnabled(enabled: boolean): void;
}

/** Events the controller publishes on the global bus. */
declare module '@core/events' {
  interface GameEvents {
    /** Footstep hook for Phase 22 audio (surface material from the level collider). */
    'player:footstep': { characterId: string; foot: 'left' | 'right'; gait: Gait; material: string; position: readonly [number, number, number] };
    'player:interact': { characterId: string; interactableId: string; kind: string };
    /** Technique hook (Phase 5/6 applies the Technique's battle-start effects). */
    'player:technique': { characterId: string; position: readonly [number, number, number] };
    /** Overworld attack hook: hitting an enemy will start an encounter with first strike (Phase 5). */
    'player:overworldAttack': { characterId: string; position: readonly [number, number, number]; yaw: number };
    'player:leaderChanged': { characterId: string; slot: number; previous: string };
    'player:animationState': { state: string; clip: string };
  }
}

export const PlayerToken = createToken<PlayerController>('PlayerController');

export const playerModule = defineStubModule({ id: 'player', name: 'Player Controller', phase: 2, dependsOn: [] });

export * from './movement';
export * from './collision';
export * from './animation';
export * from './party';
export * from './interaction';
export * from './controller';
