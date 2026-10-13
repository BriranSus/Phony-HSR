import type { WorldStateData } from '@models/world';
import { WorldState } from './state';

/**
 * In-memory world session: keeps the player's world progress while the exploration scene is left
 * and re-entered (Esc to the Departure Board and back). It is a stand-in for the Phase 21 save
 * system, which persists the same `WorldStateData` (JSON, versioned) instead.
 */
let current: WorldStateData | null = null;

export function rememberWorld(state: WorldState): void {
  current = state.toJSON();
}

/** The remembered progress for `worldId`, or null (also when it no longer parses). */
export function recallWorld(worldId: string): WorldState | null {
  if (!current || current.worldId !== worldId) return null;
  try {
    return WorldState.fromJSON(current);
  } catch {
    return null;
  }
}

export function forgetWorld(): void {
  current = null;
}
