import type { CharacterInstance } from './character';
import type { LightConeInstance } from './lightcone';
import type { RelicInstance } from './relic';
import type { QuestProgress } from './quest';
import type { PityState } from './gacha';

/**
 * Save-game format (versioned; migrations land in the save module, Phase 21).
 * Only player progress is saved. Definitions always come from data.
 */
export const SAVE_VERSION = 1 as const;

export interface SaveGame {
  readonly version: typeof SAVE_VERSION;
  readonly createdAt: string;
  updatedAt: string;
  account: {
    uid: string;
    nickname: string;
    /** Account level ("Trailblaze Level" equivalent). */
    level: number;
    exp: number;
    /** World difficulty tier ("Equilibrium Level" equivalent). */
    equilibrium: number;
  };
  characters: CharacterInstance[];
  /** Up to 4 character ids. */
  party: string[];
  lightCones: LightConeInstance[];
  relics: RelicInstance[];
  /** Item id -> count (currencies are items). */
  inventory: Record<string, number>;
  quests: QuestProgress[];
  exploration: {
    currentMap: string;
    position: [number, number, number];
    unlockedTeleports: string[];
    openedChests: string[];
    /** Map id -> explored fraction 0..1. */
    progress: Record<string, number>;
  };
  achievements: Record<string, { progress: number; completedAt: string | null; claimed: boolean }>;
  gacha: {
    pity: Record<string, PityState>;
    history: Array<{ bannerId: string; result: string; rarity: number; at: string }>;
  };
  dailies: { lastReset: string; lastWeeklyReset: string; activity: number; claimed: string[] };
  /** User settings layered over `game.config.json` defaults. */
  settings: Record<string, unknown>;
}
