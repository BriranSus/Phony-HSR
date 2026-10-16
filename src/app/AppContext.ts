import type { ServiceRegistry } from '@core/di/ServiceRegistry';
import type { ConfigService } from '@core/config/GameConfig';
import type { Logger } from '@core/log/Logger';
import type { GameEventBus } from '@core/events';
import type { DataRegistry, DataSource } from '@core/data/DataRegistry';
import type { InputManager } from '@core/input/InputManager';
import type { RenderService } from '@core/render/RenderService';
import type { StateManager } from '@core/state/StateManager';
import type { ModuleManager } from '@core/modules/ModuleManager';
import type { GameLoop } from '@core/loop/GameLoop';
import type { UiRoot } from '@modules/ui/UiRoot';
import type { TransitionOverlay } from '@modules/ui/TransitionOverlay';
import type { DebugOverlay } from '@modules/ui/screens/DebugOverlay';

/**
 * Everything a game state needs, resolved once at boot. States receive this instead of reaching
 * into globals; the same objects are also registered in the ServiceRegistry for modules.
 */
export interface AppContext {
  readonly services: ServiceRegistry;
  readonly config: ConfigService;
  readonly logger: Logger;
  readonly bus: GameEventBus;
  readonly data: DataRegistry;
  readonly dataSource: DataSource;
  readonly input: InputManager;
  readonly render: RenderService;
  readonly states: StateManager;
  readonly modules: ModuleManager;
  readonly loop: GameLoop;
  readonly ui: UiRoot;
  readonly transition: TransitionOverlay;
  readonly debug: DebugOverlay;
}

export const StateIds = {
  loading: 'loading',
  title: 'title',
  mainMenu: 'main-menu',
  archive: 'data-archive',
  testScene: 'test-scene',
  battle: 'battle',
  battleSandbox: 'battle-sandbox',
} as const;
