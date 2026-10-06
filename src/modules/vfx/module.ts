import { createToken } from '@core/di/ServiceRegistry';
import type { GameModule } from '@core/modules/GameModule';
import type * as THREE from 'three';

/**
 * VFX (Phase 23; the procedural space backdrop is already used in Phase 1). Pooled particle effects
 * referenced by id from data (`presentation.vfx`): elemental hits, Weakness Break bursts, buffs,
 * shields, heals, ultimates, environment and UI effects. Everything is procedural (shaders,
 * geometry, generated textures), never imported art.
 */
export interface VfxSystem {
  spawn(effectId: string, at: THREE.Vector3, opts?: { scale?: number; color?: string }): void;
  preload(effectIds: readonly string[]): Promise<void>;
}

export const VfxToken = createToken<VfxSystem>('VfxSystem');

export const vfxModule: GameModule = {
  id: 'vfx',
  name: 'Visual Effects',
  phase: 23,
  status: 'partial',
  dependsOn: [],
  init(ctx) {
    ctx.logger.debug('procedural backdrop (Starfield, Nebula, Planet) available; effect pool arrives in phase 23');
  },
};
