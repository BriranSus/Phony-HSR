import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * ROGUELIKE (Phase 19). Simulated-Universe-style runs: procedurally chosen node map (combat, elite,
 * event, shop, rest, boss), blessings (temporary run modifiers grouped by Path), curios, run
 * currency, difficulty tiers and weekly reward points. `RunMode` makes additional roguelike modes
 * pluggable.
 */
export interface RunMode {
  readonly id: string;
  generateMap(seed: number, difficulty: number): unknown;
}

export interface RoguelikeSystem {
  registerMode(mode: RunMode): void;
  startRun(modeId: string, party: readonly string[], difficulty: number, seed?: number): void;
  readonly inRun: boolean;
}

export const RoguelikeToken = createToken<RoguelikeSystem>('RoguelikeSystem');

export const roguelikeModule = defineStubModule({ id: 'roguelike', name: 'Roguelike Mode', phase: 19, dependsOn: ['combat', 'characters', 'enemies', 'economy'] });
