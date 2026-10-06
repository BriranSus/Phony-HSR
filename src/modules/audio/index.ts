import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * AUDIO (Phase 22). Web Audio mixer with buses (music, sfx, voice, ambience) bound to config
 * volumes, crossfading BGM per context (exploration / combat / boss), positional ambience and
 * footsteps, and cue ids referenced by data (`presentation.sfx`, `presentation.voice`). All audio
 * is procedurally generated or original.
 */
export type AudioBus = 'music' | 'sfx' | 'voice' | 'ambience' | 'ui';

export interface AudioSystem {
  play(cueId: string, opts?: { bus?: AudioBus; volume?: number }): void;
  playMusic(trackId: string, crossfadeMs?: number): void;
  setBusVolume(bus: AudioBus, volume: number): void;
}

export const AudioToken = createToken<AudioSystem>('AudioSystem');

export const audioModule = defineStubModule({ id: 'audio', name: 'Audio', phase: 22, dependsOn: [] });
