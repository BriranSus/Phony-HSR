import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { SaveGame } from '@models/save';

/**
 * SAVE (Phase 21). Versioned save games (models/save.ts) with migrations, autosave, multiple
 * slots and storage backends (localStorage / IndexedDB / file export). Other modules contribute
 * their slice through `SaveProvider`s, so the save module never knows gameplay internals.
 */
export interface SaveProvider<K extends keyof SaveGame = keyof SaveGame> {
  readonly key: K;
  serialize(): SaveGame[K];
  deserialize(data: SaveGame[K]): void;
}

export interface SaveStorage {
  read(slot: string): Promise<string | null>;
  write(slot: string, data: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface SaveSystem {
  registerProvider(provider: SaveProvider): void;
  save(slot: string): Promise<void>;
  load(slot: string): Promise<boolean>;
  hasSave(slot: string): Promise<boolean>;
}

export const SaveToken = createToken<SaveSystem>('SaveSystem');

export const saveModule = defineStubModule({ id: 'save', name: 'Save System', phase: 21, dependsOn: [] });
