import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { CameraModeId } from '@models/camera';

/**
 * CAMERA (Phase 3). A data-driven camera director that owns the single scene camera and switches
 * between modes on a priority stack with blends (curve + duration) or cuts:
 * - exploration: third-person orbit (mouse / Z-C / right stick, pitch clamps, smooth zoom,
 *   look-ahead, damping, auto-recenter) with sphere-cast collision against the level colliders;
 * - combat, skill, ultimate, boss, dialogue, cinematic: data-defined shots (`camera/shots`) with
 *   anchors, keyframes / splines, easing, FOV punch, trauma shake profiles and letterbox.
 * Scripted shots gate the player's input. Tuning is data (`camera/rules`); player preferences
 * (sensitivity, invert Y, auto-recenter, shake intensity, FOV) are config.
 *
 * The module is pure TypeScript (no THREE): the app applies `CameraPose`s to the scene camera.
 */
export type CameraMode = CameraModeId;

export interface CameraSystem {
  readonly mode: CameraMode | null;
  /** True while a scripted shot is active (player movement input must be ignored). */
  readonly inputGated: boolean;
  /** Play a shot by id from `camera/shots`; resolves when the shot ends. */
  playShot(shotId: string): Promise<void>;
  stopShots(): void;
  shake(profileId: string): void;
}

/**
 * The exploration camera contract the player controller relies on. Movement is camera-relative,
 * so the controller only reads `yaw`.
 */
export interface ExplorationCamera {
  /** Horizontal look direction (same yaw convention as the player: 0 faces +Z). */
  readonly yaw: number;
}

export const CameraToken = createToken<CameraSystem>('CameraSystem');

export const cameraModule = defineStubModule({ id: 'camera', name: 'Camera System', phase: 3, dependsOn: ['player'] });

export * from './math';
export * from './occlusion';
export * from './shake';
export * from './shots';
export * from './exploration';
export * from './director';
