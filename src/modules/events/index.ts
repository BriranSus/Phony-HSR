import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * LIVE EVENTS (Phase 18). Modular limited-time events: each event is a plugin (`EventPlugin`) with
 * its own schedule, story, map, currency, shop, minigame or challenge stages and reward tracks.
 * (Not to be confused with the engine's EventBus in src/core/bus.)
 */
export interface EventPlugin {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  init(): Promise<void>;
  dispose(): void;
}

export interface LiveEventSystem {
  register(plugin: EventPlugin): void;
  active(now: Date): readonly EventPlugin[];
}

export const LiveEventToken = createToken<LiveEventSystem>('LiveEventSystem');

export const eventsModule = defineStubModule({ id: 'events', name: 'Live Events', phase: 18, dependsOn: ['quest', 'economy'] });
