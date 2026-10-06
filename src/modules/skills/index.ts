import { createToken } from '@core/di/ServiceRegistry';
import { defineStubModule } from '@core/modules/GameModule';
import type { Ability, Condition, Effect } from '@models/ability';
import type { BattleState } from '@models/combat';

/**
 * SKILLS (Phase 5/6). Interprets data-defined abilities: executes `effects` in order against the
 * resolved targets, evaluates `triggers`/`conditions`, and dispatches `script` effects to handlers
 * registered by id for character-specific mechanics. Adding a character adds data (and at most a
 * handler), never engine code.
 */
export interface EffectContext {
  readonly battle: BattleState;
  readonly sourceUid: string;
  readonly primaryTargetUid: string | null;
  readonly abilityLevel: number;
}

export type EffectHandler<E extends Effect = Effect> = (effect: E, ctx: EffectContext) => void;
export type ScriptHandler = (params: Readonly<Record<string, unknown>>, ctx: EffectContext) => void;
export type ConditionEvaluator = (condition: Condition, ctx: EffectContext) => boolean;

export interface SkillSystem {
  registerEffect<K extends Effect['kind']>(kind: K, handler: EffectHandler<Extract<Effect, { kind: K }>>): void;
  registerScript(id: string, handler: ScriptHandler): void;
  registerCondition(type: string, evaluator: ConditionEvaluator): void;
  execute(ability: Ability, ctx: EffectContext): void;
}

export const SkillToken = createToken<SkillSystem>('SkillSystem');

export const skillsModule = defineStubModule({ id: 'skills', name: 'Skills & Effects', phase: 5, dependsOn: ['status'] });
