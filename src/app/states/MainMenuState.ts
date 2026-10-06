import type { GameState } from '@core/state/StateManager';
import { MainMenuScreen, type MenuItemView } from '@modules/ui';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

/**
 * Main menu overlay pushed above the title backdrop. Entries for systems that arrive in later
 * phases are shown disabled with their phase badge, so the roadmap is visible in-game.
 */
const ITEMS: readonly MenuItemView[] = [
  { id: 'test-scene', title: 'Enter Test Scene', description: 'Phase 1 sandbox: renderer, scene switching and input' },
  { id: 'archive', title: 'Data Archive', description: 'Browse validated characters, light cones, enemies and rules' },
  { id: 'continue', title: 'Continue Voyage', description: 'Resume from your latest save', disabled: true, badge: 'Phase 21' },
  { id: 'warp', title: 'Warp', description: 'Character and Light Cone banners', disabled: true, badge: 'Phase 17' },
  { id: 'settings', title: 'Settings', description: 'Graphics, audio, controls and accessibility', disabled: true, badge: 'Phase 16' },
  { id: 'title', title: 'Return to Title', description: 'Close the departure board' },
];

export class MainMenuState implements GameState {
  readonly id = StateIds.mainMenu;
  readonly isOverlay = true;
  private screen: MainMenuScreen | null = null;
  private unmount: (() => void) | null = null;
  private focused = true;

  constructor(private readonly ctx: AppContext) {}

  enter(): void {
    this.screen = new MainMenuScreen(ITEMS, (id) => this.select(id), () => this.back());
    this.unmount = this.ctx.ui.mount(this.screen.el);
  }

  exit(): void {
    this.unmount?.();
    this.screen = null;
  }

  pause(): void {
    this.focused = false;
    this.screen?.setCovered(true);
  }

  resume(): void {
    this.focused = true;
    this.screen?.setCovered(false);
  }

  update(): void {
    const input = this.ctx.input;
    if (!this.focused || this.ctx.states.busy || !this.screen) return;
    if (input.wasPressed('moveForward')) this.screen.moveFocus(-1);
    if (input.wasPressed('moveBack')) this.screen.moveFocus(1);
    if (input.wasPressed('confirm')) this.screen.activateFocused();
    else if (input.wasPressed('back')) this.back();
  }

  private back(): void {
    if (!this.focused || this.ctx.states.busy) return;
    void this.ctx.states.pop();
  }

  private select(id: string): void {
    if (!this.focused || this.ctx.states.busy) return;
    this.ctx.bus.emit('ui:click', { id: `main-menu:${id}` });
    switch (id) {
      case 'test-scene':
        void this.ctx.states.reset(StateIds.testScene, undefined, { transition: true });
        break;
      case 'archive':
        void this.ctx.states.push(StateIds.archive);
        break;
      case 'title':
        this.back();
        break;
    }
  }
}
