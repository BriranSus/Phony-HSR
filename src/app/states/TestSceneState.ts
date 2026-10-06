import type { GameState } from '@core/state/StateManager';
import type { RenderView } from '@core/render/RenderService';
import { Collections } from '@models/collections';
import { TestSceneHud } from '@modules/ui';
import { TestSandbox } from '../scenes/TestSandbox';
import { DebugOrbitCamera } from '../scenes/DebugOrbitCamera';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

/**
 * Phase-1 placeholder 3D scene. Proves: WebGL rendering + post-processing, a state reached through
 * a transitioned `reset`, and action-mapped input (orbit / pan / zoom + live input monitor).
 */
export class TestSceneState implements GameState {
  readonly id = StateIds.testScene;
  private sandbox: TestSandbox | null = null;
  private view: RenderView | null = null;
  private rig: DebugOrbitCamera | null = null;
  private hud: TestSceneHud | null = null;
  private unmount: (() => void) | null = null;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    const { data, config, render, input, ui, debug } = this.ctx;
    const elements = data.all(Collections.elements).map((e) => ({ name: e.element, color: e.color }));
    this.sandbox = new TestSandbox(elements, Math.round(config.get().graphics.starCount * 0.6));
    this.sandbox.camera.fov = config.get().camera.fov;
    this.view = render.createView(this.sandbox.scene, this.sandbox.camera, { bloom: true, bloomRadius: 0.5, bloomThreshold: 0.55, bloomStrength: 0.7 });
    this.rig = new DebugOrbitCamera(this.sandbox.camera, input, () => config.get().camera);
    this.hud = new TestSceneHud(() => this.back());
    this.unmount = ui.mount(this.hud.el);
    if (config.get().debug.overlay) debug.toggle(true);
  }

  exit(): void {
    this.unmount?.();
    this.view?.dispose();
    this.sandbox?.dispose();
    this.ctx.debug.toggle(false);
    this.sandbox = null;
    this.view = null;
    this.rig = null;
    this.hud = null;
  }

  update(dt: number): void {
    this.sandbox?.update(dt);
    this.rig?.update(dt);
    this.hud?.setActiveActions(this.ctx.input.activeActions());
    if (this.ctx.input.wasPressed('back')) this.back();
  }

  render(): void {
    this.view?.render();
  }

  private back(): void {
    if (this.ctx.states.busy) return;
    void this.ctx.states.reset(StateIds.title, { openMenu: true }, { transition: true });
  }
}
