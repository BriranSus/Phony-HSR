import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';

/**
 * DIALOGUE (Phase 14). Cinematic conversations from `src/data/dialogues/`: portraits and
 * expressions, typewriter text, choices with flags, voice-over hooks, dialogue camera shots,
 * history log, skip, auto-play and fast-forward.
 */
export interface DialogueSystem {
  play(dialogueId: string): Promise<{ flags: Record<string, boolean> }>;
  readonly playing: boolean;
  setAutoPlay(enabled: boolean): void;
  skip(): void;
  history(): ReadonlyArray<{ speaker: string; text: string }>;
}

export const DialogueToken = createToken<DialogueSystem>('DialogueSystem');

export const dialogueModule = defineStubModule({ id: 'dialogue', name: 'Dialogue', phase: 14, dependsOn: ['quest', 'camera', 'ui'] });
