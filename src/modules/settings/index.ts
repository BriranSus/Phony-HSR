import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * SETTINGS (Phase 16 UI, persisted by Phase 21). A UI over the core ConfigService (graphics,
 * resolution, quality, FPS cap, audio/voice volumes, subtitles, language, camera) plus key
 * rebinding, which edits the input-binding data and re-applies it to the InputManager.
 */
export interface SettingsSystem {
  open(): void;
  rebind(action: string, slot: number, code: string): void;
  resetToDefaults(section?: string): void;
}

export const SettingsToken = createToken<SettingsSystem>('SettingsSystem');

export const settingsModule = defineStubModule({ id: 'settings', name: 'Settings', phase: 16, dependsOn: ['ui', 'save'] });
