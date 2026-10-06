import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { CharacterInstance } from '@models/character';
import type { StatBlock } from '@models/stats';

/**
 * CHARACTERS (Phase 6). Character framework: builds final stats from definition + level/ascension
 * + light cone + relics + traces + eidolons, resolves ability levels (incl. E3/E5 bonuses), and
 * registers a combat UnitFactory. Roster ownership and party composition live here too.
 */
export interface CharacterSystem {
  roster(): readonly CharacterInstance[];
  get(characterId: string): CharacterInstance | undefined;
  /** Final panel stats (what the character screen shows). */
  finalStats(characterId: string): StatBlock;
  abilityLevel(characterId: string, slot: 'basic' | 'skill' | 'ultimate' | 'talent'): number;
  party(): readonly string[];
  setParty(ids: readonly string[]): void;
}

export const CharacterToken = createToken<CharacterSystem>('CharacterSystem');

export const charactersModule = defineStubModule({ id: 'characters', name: 'Character Framework', phase: 6, dependsOn: ['combat', 'skills'] });
