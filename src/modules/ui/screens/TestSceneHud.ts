import { h } from '../dom';
import { UI_ICONS } from '../icons';

interface KeyBinding {
  readonly label: string;
  readonly action: string;
}

/**
 * HUD for the Phase-1 test scene: area banner, live input monitor (keys light up from the
 * action-mapped InputManager) and control hints.
 */
export class TestSceneHud {
  readonly el: HTMLElement;
  private readonly keycaps = new Map<string, HTMLElement[]>();
  private readonly actions: HTMLElement;

  constructor(onBack: () => void) {
    const key = (b: KeyBinding): HTMLElement => {
      const el = h('span', { class: 'keycap', text: b.label, dataset: { action: b.action } });
      const list = this.keycaps.get(b.action) ?? [];
      list.push(el);
      this.keycaps.set(b.action, list);
      return el;
    };
    this.actions = h('div', { class: 'hud__input-actions', text: 'No input' });
    this.el = h(
      'section',
      { class: 'screen screen--passthrough hud', attrs: { 'data-screen': 'test-scene' } },
      h(
        'div',
        { class: 'hud__area' },
        h('div', { class: 'eyebrow' }, h('span', { class: 'diamond' }), 'Phase 1 · Engine Sandbox'),
        h('div', { class: 'hud__area-name', text: 'Calibration Platform' }),
        h('div', { class: 'hud__area-sub', text: 'Renderer · scene switching · action-mapped input' }),
      ),
      h('div', { class: 'hud__banner' }, h('div', { class: 'hud__banner-title', text: 'TEST SCENE' }), h('div', { class: 'hud__banner-sub', text: 'ARCHITECTURE VERIFIED' })),
      h(
        'div',
        { class: 'hud__input interactive' },
        h('div', { class: 'eyebrow' }, h('span', { class: 'diamond diamond--hollow' }), 'Input Monitor'),
        h(
          'div',
          { class: 'hud__input-grid' },
          key({ label: 'W', action: 'moveForward' }),
          key({ label: 'A', action: 'moveLeft' }),
          key({ label: 'S', action: 'moveBack' }),
          key({ label: 'D', action: 'moveRight' }),
        ),
        h(
          'div',
          { class: 'hud__input-row' },
          key({ label: 'Q', action: 'cameraRotateLeft' }),
          key({ label: 'E', action: 'cameraRotateRight' }),
          key({ label: 'Shift', action: 'sprint' }),
          key({ label: 'F', action: 'interact' }),
          key({ label: 'LMB', action: 'cameraDrag' }),
        ),
        this.actions,
      ),
      h(
        'div',
        { class: 'hud__hints' },
        h('span', {}, h('span', { class: 'keycap', text: 'WASD' }), 'Pan camera'),
        h('span', {}, h('span', { class: 'keycap', text: 'Drag' }), 'Orbit'),
        h('span', {}, h('span', { class: 'keycap', text: 'Wheel' }), 'Zoom'),
        h('span', {}, h('span', { class: 'keycap', text: 'F3' }), 'Debug'),
      ),
      h(
        'div',
        { class: 'hud__back interactive' },
        h('button', { class: 'pill-button', attrs: { type: 'button', 'data-id': 'back' }, on: { click: () => onBack() } }, h('span', { class: 'icon', trustedHtml: UI_ICONS.back }), 'Esc · Departure Board'),
      ),
    );
  }

  /** Called every frame with the currently held actions. */
  setActiveActions(active: readonly string[]): void {
    const set = new Set(active);
    for (const [action, els] of this.keycaps) for (const el of els) el.classList.toggle('is-down', set.has(action));
    const text = active.length ? active.join(' + ') : 'No input';
    if (this.actions.dataset.text !== text) {
      this.actions.dataset.text = text;
      this.actions.replaceChildren(active.length ? h('b', { text }) : 'No input');
    }
  }
}
