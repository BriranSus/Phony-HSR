import type { Effect } from '@models/ability';

/**
 * What Stage 5A executes and what it declares as a stub. Stubbed effects never throw: the engine
 * logs a `stub` event ("not yet implemented") the first time one runs in a battle, so the combat log
 * shows exactly what a kit is missing until Stage 5B.
 */
export const IMPLEMENTED_EFFECT_KINDS: ReadonlySet<Effect['kind']> = new Set<Effect['kind']>([
  'damage',
  'heal',
  'shield',
  'applyStatus',
  'removeStatus',
  'dispel',
  'energy',
  'skillPoints',
  'actionAdvance',
  'hpChange',
  'gainResource',
  'insertAction',
]);

export const STUBBED_EFFECT_KINDS: readonly Effect['kind'][] = [
  'applyRandomStatus',
  'ultimatePoints',
  'summon',
  'detonateDot',
  'implantWeakness',
  'breakDamage',
  'revive',
  'script',
];

/** Trigger events the 5A engine dispatches; triggers on other events stay inert until 5B. */
export const DISPATCHED_TRIGGER_EVENTS = [
  'battleStart',
  'waveStart',
  'turnStart',
  'turnEnd',
  'afterAttack',
  'afterUseBasic',
  'afterUseSkill',
  'afterUseUltimate',
  'afterBeingHit',
  'afterAllyHit',
  'afterAllyAttack',
  'afterAllyUsesUltimate',
  'onTargetedByAlly',
  'onKill',
  'onEnemyDefeated',
  'onWeaknessBreak',
  'afterAllyWeaknessBreak',
  'onFollowUp',
] as const;
