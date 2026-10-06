import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * SOCIAL / ACCOUNT (Phase 26, optional). Offline profile (UID, nickname, signature, showcase,
 * support character) is local; friends and support-character borrowing require an online backend
 * behind `SocialBackend`, which is a no-op in the offline build.
 */
export interface SocialBackend {
  readonly online: boolean;
  friends(): Promise<ReadonlyArray<{ uid: string; nickname: string }>>;
}

export interface SocialSystem {
  readonly uid: string;
  profile(): { nickname: string; signature: string; showcase: readonly string[]; support: string | null };
  setBackend(backend: SocialBackend): void;
}

export const SocialToken = createToken<SocialSystem>('SocialSystem');

export const socialModule = defineStubModule({ id: 'social', name: 'Social & Account', phase: 26, dependsOn: ['save'] });
