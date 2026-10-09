import { ConfigService, parseOverrides, GameConfigSchema } from '@core/config/GameConfig';
import { Logger, MemorySink, consoleSink } from '@core/log/Logger';
import { EventBus } from '@core/bus/EventBus';
import type { GameEvents } from '@core/events';
import { ServiceRegistry } from '@core/di/ServiceRegistry';
import { DataRegistry } from '@core/data/DataRegistry';
import { InputManager } from '@core/input/InputManager';
import { RenderService } from '@core/render/RenderService';
import { StateManager } from '@core/state/StateManager';
import { ModuleManager } from '@core/modules/ModuleManager';
import { GameLoop } from '@core/loop/GameLoop';
import { Tokens } from '@core/tokens';
import { ALL_COLLECTIONS } from '@models/collections';
import { ALL_MODULES } from '@modules/index';
import { DebugOverlay, TransitionOverlay, TransitionToken, UiRoot, UiToken, createFatalScreen, type DebugSection } from '@modules/ui';
import defaultConfig from '@data/config/game.config.json';
import { createBundledDataSource } from './dataSource';
import type { AppContext } from './AppContext';
import { StateIds } from './AppContext';
import { LoadingState } from './states/LoadingState';
import { TitleState } from './states/TitleState';
import { MainMenuState } from './states/MainMenuState';
import { DataArchiveState } from './states/DataArchiveState';
import { TestSceneState } from './states/TestSceneState';

/** Handle exposed on `window.__ASTRAL__` (debug builds) for tooling such as Playwright. */
export interface DebugHandle {
  readonly ctx: AppContext;
  stack(): string[];
  readonly logs: MemorySink;
  /** State-specific probes for tooling (e.g. `exploration` while the test level is active). */
  readonly probes: Record<string, unknown>;
}

declare global {
  interface Window {
    __ASTRAL__?: DebugHandle;
  }
}

/**
 * Composition root: builds every engine service, registers states and modules, and starts the
 * loop. This is the only place that knows concrete implementations.
 */
export function bootstrap(host: HTMLElement): AppContext | null {
  // 1. Config: data defaults + URL overrides (?cfg.graphics.quality=low).
  const base = GameConfigSchema.parse(defaultConfig);
  const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const { patch, unknown } = parseOverrides(base, [...query.entries()].filter(([k]) => k.startsWith('cfg.')));
  const config = new ConfigService(base, patch);

  // 2. Logging and events.
  const memory = new MemorySink(400);
  const logger = Logger.create({ level: config.get().debug.logLevel, sinks: [consoleSink, memory.sink], namespace: 'astral' });
  if (unknown.length) logger.warn('ignored unknown config overrides', unknown);
  const bus = new EventBus<GameEvents>({ onListenerError: (event, error) => logger.error(`listener for "${event}" failed`, error) });
  config.subscribe((c) => bus.emit('config:changed', { config: c }));

  // 3. Presentation roots.
  const ui = new UiRoot(host);
  ui.setUiScale(config.get().ui.uiScale);
  if (!RenderService.isWebGLAvailable()) {
    ui.mount(createFatalScreen('WebGL is not available.', 'This game needs a browser with WebGL 2 or WebGL 1 enabled.'));
    logger.error('WebGL unavailable');
    return null;
  }
  const render = new RenderService(host, config.get().graphics);
  config.subscribe((c) => render.applyGraphics(c.graphics));
  const transition = new TransitionOverlay(ui.layer('transition'), config.get().ui.transitionMs);
  const debug = new DebugOverlay(false);
  ui.mount(debug.el, 'debug');

  // 4. Core services.
  const input = new InputManager();
  input.attach(window);
  input.onAction((e) => bus.emit('input:action', e));
  const data = new DataRegistry().registerAll(ALL_COLLECTIONS);
  const modules = new ModuleManager().registerAll(ALL_MODULES);
  const states = new StateManager({
    onChange: (change) => {
      logger.debug(`state ${change.action}: ${change.from ?? '-'} -> ${change.to ?? '-'} [${change.stack.join(' > ')}]`);
      bus.emit('state:changed', change);
    },
    onError: (error, action) => logger.error(`state ${action} failed`, error),
  });
  states.setTransitioner(transition);

  const cfgLoop = config.get().loop;
  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => states.fixedUpdate(dt),
      update: (dt) => {
        input.pollGamepads(typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : undefined);
        if (input.wasPressed('toggleDebug')) debug.toggle();
        modules.update(dt);
        states.update(dt);
      },
      render: (alpha) => {
        render.beginFrame();
        states.render(alpha);
      },
      endFrame: () => input.endFrame(),
    },
    { fixedHz: cfgLoop.fixedHz, maxStepsPerFrame: cfgLoop.maxStepsPerFrame, maxFrameTime: cfgLoop.maxFrameTime },
  );

  const services = new ServiceRegistry();
  services
    .registerValue(Tokens.Config, config)
    .registerValue(Tokens.Logger, logger)
    .registerValue(Tokens.Events, bus)
    .registerValue(Tokens.Data, data)
    .registerValue(Tokens.Input, input)
    .registerValue(Tokens.Render, render)
    .registerValue(Tokens.States, states)
    .registerValue(Tokens.Loop, loop)
    .registerValue(Tokens.Modules, modules)
    .registerValue(UiToken, ui)
    .registerValue(TransitionToken, transition);

  const ctx: AppContext = { services, config, logger, bus, data, dataSource: createBundledDataSource(), input, render, states, modules, loop, ui, transition, debug };

  // 5. States.
  states
    .register(StateIds.loading, () => new LoadingState(ctx))
    .register(StateIds.title, () => new TitleState(ctx))
    .register(StateIds.mainMenu, () => new MainMenuState(ctx))
    .register(StateIds.archive, () => new DataArchiveState(ctx))
    .register(StateIds.testScene, () => new TestSceneState(ctx));

  // 6. Debug overlay content (throttled).
  const refreshDebug = (): void => {
    if (!debug.isVisible) return;
    const s = loop.stats;
    const lastFrameStats = render.stats();
    const counts = data.counts();
    const mods = modules.list();
    const sections: DebugSection[] = [
      {
        title: 'PERFORMANCE',
        rows: [
          ['FPS', s.fps.toFixed(0)],
          ['Frame', `${s.frameMs.toFixed(1)} ms`],
          ['Draw calls', String(lastFrameStats.drawCalls)],
          ['Triangles', lastFrameStats.triangles.toLocaleString('en-US')],
          ['Resolution', `${lastFrameStats.width}x${lastFrameStats.height} @${lastFrameStats.pixelRatio.toFixed(2)}`],
        ],
      },
      { title: 'STATE STACK', rows: [['Stack', states.stackIds.join(' > ') || '-'], ['Fixed steps', String(s.fixedSteps)]] },
      {
        title: 'DATA REGISTRY',
        rows: [
          ['Records', String(Object.values(counts).reduce((a, b) => a + b, 0))],
          ['Characters / Enemies', `${counts.characters ?? 0} / ${counts.enemies ?? 0}`],
          ['Status effects', String(counts.statusEffects ?? 0)],
        ],
      },
      {
        title: 'MODULES',
        rows: [
          ['Registered', String(mods.length)],
          ['Partial / Stub', `${mods.filter((m) => m.status === 'partial').length} / ${mods.filter((m) => m.status === 'stub').length}`],
          ['Init order', modules.order.slice(0, 4).join(', ') + (modules.order.length > 4 ? ', ...' : '')],
        ],
      },
      { title: 'INPUT', rows: [['Actions held', input.activeActions().join(', ') || '-']] },
    ];
    debug.render(sections);
  };
  const debugLoop = window.setInterval(refreshDebug, 250);

  if (config.get().debug.exposeGlobal) {
    window.__ASTRAL__ = { ctx, stack: () => states.stackIds, logs: memory, probes: {} };
  }
  window.addEventListener('beforeunload', () => {
    window.clearInterval(debugLoop);
    loop.stop();
  });

  logger.info(`${config.get().app.title} v${config.get().app.version} booting`);
  void states.reset(StateIds.loading);
  loop.start();
  return ctx;
}
