import type { EventBus } from './bus/EventBus';
import type { StateChange } from './state/StateManager';
import type { LoadProgress, LoadReport } from './data/DataRegistry';
import type { ActionEvent } from './input/InputManager';
import type { ModuleStatus } from './modules/GameModule';
import type { GameConfig } from './config/GameConfig';

/**
 * Global event map. Gameplay modules extend it with TypeScript declaration merging, e.g. in
 * `src/modules/combat/events.ts`:
 *
 *   declare module '@core/events' {
 *     interface GameEvents { 'combat:turnStart': { unitId: string; av: number } }
 *   }
 *
 * so every event stays type-checked without a central file that knows every system.
 */
export interface GameEvents {
  'boot:phase': { phase: string; detail?: string };
  'state:changed': StateChange;
  'data:progress': LoadProgress;
  'data:loaded': LoadReport;
  'input:action': ActionEvent;
  'module:initialized': { id: string; status: ModuleStatus; phase: number };
  'config:changed': { config: GameConfig };
  'ui:click': { id: string };
}

export type GameEventBus = EventBus<GameEvents>;
