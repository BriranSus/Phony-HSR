import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { LightConeInstance } from '@models/lightcone';

/**
 * LIGHT CONES (Phase 10). Instances, level/ascension, enhancement with EXP materials or fodder,
 * Superimposition S1..S5, equip/unequip and the Path rule (any Path can equip; the passive only
 * activates for the matching Path, configurable in rules/combat.json -> lightCone).
 */
export interface LightConeSystem {
  list(): readonly LightConeInstance[];
  equip(uid: string, characterId: string): { swappedFrom: string | null };
  unequip(uid: string): void;
  isPassiveActive(uid: string, characterId: string): boolean;
  superimpose(uid: string, fodderUid: string): number;
  enhance(uid: string, materials: Record<string, number>, fodder: readonly string[]): void;
}

export const LightConeToken = createToken<LightConeSystem>('LightConeSystem');

export const lightconesModule = defineStubModule({ id: 'lightcones', name: 'Light Cones', phase: 10, dependsOn: ['characters', 'economy'] });
