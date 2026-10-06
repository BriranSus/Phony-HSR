import { createToken } from '@core/di/ServiceRegistry';
import type { GameModule } from '@core/modules/GameModule';
import type { UiRoot } from './UiRoot';
import type { TransitionOverlay } from './TransitionOverlay';

/**
 * UI (framework in Phase 1, full screen set in Phase 16). DOM overlay above the WebGL canvas with
 * layered screens, scene transitions, the theme and an original SVG icon set. Gameplay screens
 * (Character, Party, Inventory, Light Cone, Relics, Traces, Eidolons, Warp, Missions, Map,
 * Achievements, Events, Shop, Mail, Friends, Profile, Settings, Combat HUD, Dialogue, Tutorial)
 * are built on this framework in their phases.
 */
export const UiToken = createToken<UiRoot>('UiRoot');
export const TransitionToken = createToken<TransitionOverlay>('Transition');

export const uiModule: GameModule = {
  id: 'ui',
  name: 'UI Framework',
  phase: 16,
  status: 'partial',
  dependsOn: [],
  init(ctx) {
    ctx.logger.debug(`UI framework ready (${ctx.services.has(UiToken) ? 'mounted' : 'headless'})`);
  },
};
