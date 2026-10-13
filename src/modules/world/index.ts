import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { WorldRuntime } from './runtime';

/**
 * WORLD (Phase 4 exploration; the world map UI is Phase 15). A data-driven world layer:
 * WorldDefinition -> Region -> Area, with typed interactables (NPCs, chests, collectibles,
 * breakables, switches, plates, crates, gates, Space Anchors, portals), puzzles, hidden areas,
 * overworld enemies with patrol / alert / chase AI, encounter advantage rules, exploration
 * progress, a serialisable WorldState and typed `world:*` events for the quest layer (Phase 13).
 *
 * Everything here is pure TypeScript. `WorldRuntime` is the one object the app drives; levels,
 * worlds and rules are JSON (`levels/`, `worlds/`, `rules/world/`).
 */
export const WorldToken = createToken<WorldRuntime>('WorldRuntime');

export const worldModule = defineStubModule({ id: 'world', name: 'World & Exploration', phase: 4, dependsOn: ['player', 'camera'] });

export * from './events';
export * from './objects';
export * from './puzzles';
export * from './enemies';
export * from './encounter';
export * from './state';
export * from './graph';
export * from './progress';
export * from './runtime';
export * from './session';
