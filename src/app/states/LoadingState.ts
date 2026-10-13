import type { GameState } from '@core/state/StateManager';
import { DataValidationError } from '@core/data/DataRegistry';
import { Collections } from '@models/collections';
import { LoadingScreen, createFatalScreen } from '@modules/ui';
import { WorldGraphError, validateWorldGraph } from '@modules/world';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

/**
 * Boot loading: loads and validates all data (with per-file progress), initialises every module in
 * dependency order, applies data-driven input bindings, then hands over to the title screen.
 * The bar never runs ahead of real work; `ui.minLoadingMs` only paces it so it stays readable.
 */
export class LoadingState implements GameState {
  readonly id = StateIds.loading;
  private screen: LoadingScreen | null = null;
  private unmount: (() => void) | null = null;
  private elapsed = 0;
  private realProgress = 0;
  private label = 'Initialising engine';
  private done = false;
  private handedOff = false;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    const cfg = this.ctx.config.get();
    this.screen = new LoadingScreen(cfg.app.title);
    this.unmount = this.ctx.ui.mount(this.screen.el);
    void this.run();
  }

  exit(): void {
    this.unmount?.();
    this.screen = null;
  }

  update(dt: number): void {
    this.elapsed += dt * 1000;
    const min = this.ctx.config.get().ui.minLoadingMs;
    const paced = min > 0 ? Math.min(1, this.elapsed / min) : 1;
    const shown = Math.min(this.realProgress, paced);
    this.screen?.setProgress(shown, this.done && shown < 1 ? 'Preparing departure' : this.label);
    if (this.done && shown >= 1 && !this.handedOff) {
      this.handedOff = true;
      const requested = this.ctx.config.get().debug.startState;
      const next = this.ctx.states.isRegistered(requested) && requested !== StateIds.loading ? requested : StateIds.title;
      void this.ctx.states.replace(next, undefined, { transition: true });
    }
  }

  render(): void {
    this.ctx.render.clear();
  }

  private async run(): Promise<void> {
    const { data, dataSource, modules, services, logger, bus, input, config } = this.ctx;
    const log = logger.child('boot');
    try {
      this.label = 'Loading game data';
      bus.emit('boot:phase', { phase: 'data' });
      const report = await data.load(dataSource, {
        strict: config.get().debug.strictData,
        onProgress: (p) => {
          this.realProgress = (p.loaded / p.total) * 0.7;
          this.label = `Validating ${p.collection}`;
          bus.emit('data:progress', p);
          if (p.collection === 'loadingTips' && data.counts().loadingTips) this.pickTip();
        },
      });
      for (const issue of report.issues) log.warn(`[data:${issue.kind}] ${issue.file}: ${issue.message}`);
      bus.emit('data:loaded', report);
      log.info(`data loaded: ${report.files} files`, report.counts);

      // Cross-file world checks (portal targets, arrival spawns) fail here, not mid-game.
      const levels = new Map(data.all(Collections.levels).map((l) => [l.id, l]));
      for (const world of data.all(Collections.worlds)) {
        const problems = validateWorldGraph(world, levels);
        if (problems.length) throw new WorldGraphError(problems);
      }

      this.label = 'Initialising systems';
      bus.emit('boot:phase', { phase: 'modules' });
      const total = modules.list().length;
      let n = 0;
      await modules.initAll({ services, logger }, (m) => {
        n++;
        this.realProgress = 0.7 + (n / total) * 0.25;
        this.label = `Initialising ${m.name}`;
        bus.emit('module:initialized', { id: m.id, status: m.status, phase: m.phase });
      });

      const bindings = data.get(Collections.inputBindings, 'default');
      input.setBindings(Object.fromEntries(Object.entries(bindings.actions).map(([k, v]) => [k, { codes: v.codes }])));

      this.label = 'Ready';
      this.realProgress = 1;
      this.done = true;
      bus.emit('boot:phase', { phase: 'ready' });
    } catch (error) {
      log.error('boot failed', error);
      const detail = error instanceof DataValidationError ? error.message : String(error instanceof Error ? (error.stack ?? error.message) : error);
      this.ctx.ui.mount(createFatalScreen('The game data could not be loaded.', detail));
    }
  }

  private pickTip(): void {
    const tips = this.ctx.data.all(Collections.loadingTips);
    const tip = tips[Math.floor(Math.random() * tips.length)];
    this.screen?.setTip(tip ? { title: tip.title, text: tip.text } : null);
  }
}
