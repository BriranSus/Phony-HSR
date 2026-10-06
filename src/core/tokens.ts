import { createToken } from './di/ServiceRegistry';
import type { Logger } from './log/Logger';
import type { ConfigService } from './config/GameConfig';
import type { GameEventBus } from './events';
import type { DataRegistry } from './data/DataRegistry';
import type { InputManager } from './input/InputManager';
import type { RenderService } from './render/RenderService';
import type { StateManager } from './state/StateManager';
import type { GameLoop } from './loop/GameLoop';
import type { ModuleManager } from './modules/ModuleManager';

/** Service tokens for the engine core. Gameplay modules declare their own tokens next to their code. */
export const Tokens = {
  Logger: createToken<Logger>('Logger'),
  Config: createToken<ConfigService>('Config'),
  Events: createToken<GameEventBus>('EventBus'),
  Data: createToken<DataRegistry>('DataRegistry'),
  Input: createToken<InputManager>('Input'),
  Render: createToken<RenderService>('Render'),
  States: createToken<StateManager>('States'),
  Loop: createToken<GameLoop>('Loop'),
  Modules: createToken<ModuleManager>('Modules'),
} as const;
