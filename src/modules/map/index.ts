import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * MAP (Phase 15). World / region / area maps with teleport, quest, treasure, NPC, shop and enemy
 * markers, filters and exploration percentage.
 */
export type MarkerKind = 'teleport' | 'quest' | 'treasure' | 'npc' | 'shop' | 'enemy' | 'puzzle';

export interface MapSystem {
  markers(areaId: string, filter?: readonly MarkerKind[]): ReadonlyArray<{ id: string; kind: MarkerKind; x: number; z: number }>;
  explorationPercent(areaId: string): number;
}

export const MapToken = createToken<MapSystem>('MapSystem');

export const mapModule = defineStubModule({ id: 'map', name: 'Map', phase: 15, dependsOn: ['world', 'quest'] });
