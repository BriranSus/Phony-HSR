import { h, clear } from './dom';

/**
 * Owns the DOM overlay above the WebGL canvas, split into z-ordered layers:
 *   screens   - one container per game state (title, menu, HUD...)
 *   debug     - developer overlay (F3)
 *   transition- full-screen scene transition
 * Each state mounts its screen into its own layer element and removes it on exit.
 */
export type UiLayer = 'screens' | 'debug' | 'transition';

export class UiRoot {
  readonly root: HTMLElement;
  private readonly layers: Record<UiLayer, HTMLElement>;

  constructor(host: HTMLElement) {
    this.layers = {
      screens: h('div', { class: 'ui-layer ui-layer--screens' }),
      debug: h('div', { class: 'ui-layer ui-layer--debug' }),
      transition: h('div', { class: 'ui-layer ui-layer--transition' }),
    };
    this.root = h('div', { class: 'ui-root' }, this.layers.screens, this.layers.debug, this.layers.transition);
    host.append(this.root);
  }

  layer(name: UiLayer): HTMLElement {
    return this.layers[name];
  }

  /** Mount a screen element (one per state) into the screens layer. */
  mount(el: HTMLElement, layer: UiLayer = 'screens'): () => void {
    this.layers[layer].append(el);
    return () => el.remove();
  }

  setUiScale(scale: number): void {
    this.root.style.setProperty('--ui-scale', String(scale));
  }

  dispose(): void {
    for (const l of Object.values(this.layers)) clear(l);
    this.root.remove();
  }
}
