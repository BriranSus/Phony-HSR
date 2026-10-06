import type { GameState } from '@core/state/StateManager';
import type { RenderView } from '@core/render/RenderService';
import { TitleScreen } from '@modules/ui';
import { TitleBackdrop } from '../scenes/TitleBackdrop';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

export interface TitleParams {
  /** Open the main menu immediately (used when returning from a scene). */
  readonly openMenu?: boolean;
}

/** Title screen: the 3D express backdrop plus the wordmark overlay. Click / Enter opens the menu. */
export class TitleState implements GameState<TitleParams | undefined> {
  readonly id = StateIds.title;
  private backdrop: TitleBackdrop | null = null;
  private view: RenderView | null = null;
  private screen: TitleScreen | null = null;
  private unmount: (() => void) | null = null;
  private focused = true;

  constructor(private readonly ctx: AppContext) {}

  enter(params?: TitleParams): void {
    const cfg = this.ctx.config.get();
    this.backdrop = new TitleBackdrop({ starCount: cfg.graphics.starCount });
    this.view = this.ctx.render.createView(this.backdrop.scene, this.backdrop.camera, { bloom: true, bloomRadius: 0.5, bloomThreshold: 0.6 });
    this.screen = new TitleScreen({
      title: cfg.app.title,
      subtitle: cfg.app.subtitle,
      version: cfg.app.version,
      buildLabel: cfg.app.buildLabel,
      onStart: () => this.openMenu(),
      onSideButton: (_id, label) => this.screen?.showToast(`${label} — arrives with the UI phase (16)`),
    });
    this.unmount = this.ctx.ui.mount(this.screen.el);
    // Warm up one frame of animation so the first rendered frame is already composed.
    this.backdrop.update(0.016);
    // Queued behind the current state operation (we are inside it, so `busy` is true here).
    if (params?.openMenu) void this.ctx.states.push(StateIds.mainMenu);
  }

  exit(): void {
    this.unmount?.();
    this.screen?.dispose();
    this.view?.dispose();
    this.backdrop?.dispose();
    this.screen = null;
    this.view = null;
    this.backdrop = null;
  }

  pause(): void {
    this.focused = false;
    this.screen?.setCovered(true);
  }

  resume(): void {
    this.focused = true;
    this.screen?.setCovered(false);
  }

  update(dt: number): void {
    this.backdrop?.update(dt);
    if (this.focused && !this.ctx.states.busy && this.ctx.input.wasPressed('confirm')) this.openMenu();
  }

  render(): void {
    this.view?.render();
  }

  private openMenu(): void {
    if (!this.focused || this.ctx.states.busy) return;
    void this.ctx.states.push(StateIds.mainMenu);
  }
}
