import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * PLAYER CONTROLLER (Phase 2). Third-person character movement driven by input actions
 * (moveForward/moveBack/moveLeft/moveRight/sprint), walk/run states, ground snapping and
 * collision, interaction prompts, overworld attacks that start encounters (with first-strike /
 * weakness advantage) and Technique use. Party leader switching (character switching) lives here.
 */
export type LocomotionState = 'idle' | 'walk' | 'run' | 'sprint' | 'interact' | 'attack' | 'technique';

export interface PlayerController {
  readonly position: { x: number; y: number; z: number };
  readonly state: LocomotionState;
  readonly leaderId: string;
  switchLeader(characterId: string): void;
  teleport(x: number, y: number, z: number): void;
  setControlEnabled(enabled: boolean): void;
}

export const PlayerToken = createToken<PlayerController>('PlayerController');

export const playerModule = defineStubModule({ id: 'player', name: 'Player Controller', phase: 2, dependsOn: [] });
