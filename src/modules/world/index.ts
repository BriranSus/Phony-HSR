import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * WORLD (Phase 4 exploration, Phase 15 world/map). Data-defined worlds -> regions -> areas with
 * NPCs, interactables (containers, puzzles, teleport anchors), enemy spawns, area transitions and
 * hidden areas. New worlds are added as data + procedural/authored scene descriptions.
 */
export interface Interactable {
  readonly id: string;
  readonly kind: 'npc' | 'chest' | 'puzzle' | 'teleport' | 'transition' | 'collectible' | 'object';
  readonly prompt: string;
}

export interface WorldSystem {
  readonly currentArea: string | null;
  loadArea(areaId: string, spawnPoint?: string): Promise<void>;
  nearbyInteractables(radius: number): readonly Interactable[];
  interact(id: string): void;
  teleport(anchorId: string): Promise<void>;
}

export const WorldToken = createToken<WorldSystem>('WorldSystem');

export const worldModule = defineStubModule({ id: 'world', name: 'World & Exploration', phase: 4, dependsOn: ['player', 'camera'] });
