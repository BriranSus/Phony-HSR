import type { Advantage, WorldRules } from '@models/world';
import { wrapAngle } from '@modules/player';
import type { EnemyState } from './enemies';

/**
 * Encounter advantage rules (data: `rules/world/default.json -> encounter`). Combat itself is
 * Phase 5; the world only decides who gets the first move.
 *
 * - The overworld attack lands on an unaware enemy: player strike. On one that already noticed
 *   the player: neutral. On a stunned one (Technique): player strike.
 * - An enemy that reaches the player from behind their facing: ambush, otherwise neutral.
 */
export type Awareness = 'unaware' | 'aware' | 'stunned';

export function awareness(state: EnemyState): Awareness {
  if (state === 'stunned') return 'stunned';
  return state === 'alert' || state === 'chase' ? 'aware' : 'unaware';
}

export function attackAdvantage(rules: WorldRules['encounter'], state: EnemyState): Advantage {
  return rules.playerAttack[awareness(state)];
}

/** Angle (deg, 0..180) between the player's facing and the direction to the enemy. */
export function angleToEnemy(playerYaw: number, px: number, pz: number, ex: number, ez: number): number {
  return (Math.abs(wrapAngle(Math.atan2(ex - px, ez - pz) - playerYaw)) * 180) / Math.PI;
}

export function contactAdvantage(rules: WorldRules['encounter'], playerYaw: number, px: number, pz: number, ex: number, ez: number): Advantage {
  return angleToEnemy(playerYaw, px, pz, ex, ez) > rules.ambushAngleDeg ? rules.enemyContact.behind : rules.enemyContact.front;
}

/** Is the target inside the player's attack cone and range? */
export function inAttackCone(playerYaw: number, px: number, pz: number, tx: number, tz: number, range: number, arcDeg: number): boolean {
  const d = Math.hypot(tx - px, tz - pz);
  if (d > range) return false;
  if (d < 0.3) return true;
  return angleToEnemy(playerYaw, px, pz, tx, tz) <= arcDeg / 2;
}
