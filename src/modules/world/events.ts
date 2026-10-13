import type { Advantage, Reward } from '@models/world';

/**
 * Typed world events (spec §14). The quest module (Phase 13) subscribes to these without any
 * change to world code: talked-to-NPC, chest-opened, area-entered, puzzle-solved, enemy-defeated,
 * item-collected and the rest. They are published on the global bus under the `world:` prefix.
 */
export interface WorldEvents {
  'world:areaEntered': { areaId: string; areaName: string; regionId: string; regionName: string; firstVisit: boolean };
  'world:npcTalked': { npcId: string; areaId: string };
  'world:chestOpened': { chestId: string; areaId: string; rewards: readonly Reward[] };
  'world:itemCollected': { itemId: string; count: number; source: string; areaId: string };
  'world:objectChanged': { objectId: string; areaId: string; kind: string; state: string };
  'world:puzzleSolved': { puzzleId: string; areaId: string };
  'world:puzzleFailed': { puzzleId: string; areaId: string };
  'world:hiddenAreaDiscovered': { hiddenId: string; areaId: string; name: string };
  'world:anchorActivated': { anchorId: string; areaId: string };
  'world:teleported': { anchorId: string; fromArea: string; toArea: string };
  'world:enemyDetected': { spawnId: string; enemies: readonly string[]; areaId: string };
  'world:encounterStarted': { spawnId: string; enemies: readonly string[]; advantage: Advantage; trigger: 'attack' | 'contact'; areaId: string };
  'world:encounterEnded': { spawnId: string; areaId: string; result: 'placeholder-victory' };
  'world:enemyDefeated': { spawnId: string; enemyId: string; areaId: string };
  'world:techniqueUsed': { affected: number; areaId: string };
  'world:progressChanged': { areaId: string; percent: number; found: number; total: number };
  'world:locked': { objectId: string; areaId: string; reason: string };
}

export type WorldEmit = <K extends keyof WorldEvents>(name: K, payload: WorldEvents[K]) => void;

declare module '@core/events' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GameEvents extends WorldEvents {}
}
