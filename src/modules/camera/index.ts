import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * CAMERA (Phase 3). One rig with named modes and smooth blends between them: exploration
 * (third-person orbit with collision), combat (wide arena view), skill / ultimate (data-driven
 * shots referenced by ability `presentation.camera`), boss, dialogue and cinematic cameras.
 */
export type CameraMode = 'exploration' | 'combat' | 'skill' | 'ultimate' | 'boss' | 'dialogue' | 'cinematic';

export interface CameraShot {
  readonly id: string;
  readonly mode: CameraMode;
  readonly durationMs: number;
}

export interface CameraSystem {
  readonly mode: CameraMode;
  setMode(mode: CameraMode, blendMs?: number): void;
  playShot(shotId: string): Promise<void>;
  shake(intensity: number, durationMs: number): void;
}

export const CameraToken = createToken<CameraSystem>('CameraSystem');

export const cameraModule = defineStubModule({ id: 'camera', name: 'Camera System', phase: 3, dependsOn: ['player'] });
