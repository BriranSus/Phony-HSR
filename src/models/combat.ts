import type { Element } from './common';
import type { StatBlock } from './stats';
import type { AttackType } from './ability';
import type { EnemyRank } from './enemy';

/**
 * Runtime combat state shapes. These are not loaded from data; they are what the combat engine
 * (Phase 5) builds from definitions + player instances, and what the combat HUD (Phase 16) renders.
 */
export type Side = 'ally' | 'enemy';

export interface ActiveStatus {
  readonly statusId: string;
  /** Unit that applied the status (DoT damage and caster-bound durations use the source's stats). */
  readonly sourceId: string;
  stacks: number;
  /** Remaining turns; 0 = permanent until removed. */
  turnsLeft: number;
  /** Resolved numeric parameters (e.g. ATK% of the buff at the caster's ability level). */
  readonly params: Readonly<Record<string, number>>;
}

export interface Combatant {
  readonly uid: string;
  readonly side: Side;
  /** Character, memosprite or enemy definition id. */
  readonly defId: string;
  readonly level: number;
  readonly element: Element | null;
  readonly rank: EnemyRank | null;
  /** Stats before temporary buffs (base + light cone + relics + traces + eidolons). */
  readonly baseStats: Readonly<StatBlock>;
  hp: number;
  energy: number;
  maxEnergy: number;
  toughness: number;
  maxToughness: number;
  broken: boolean;
  weaknesses: Element[];
  statuses: ActiveStatus[];
  shield: number;
  /** Remaining action value until this unit's next turn. */
  actionValue: number;
  alive: boolean;
}

export interface SkillPointPool {
  current: number;
  max: number;
}

export interface TurnOrderEntry {
  readonly uid: string;
  readonly actionValue: number;
  readonly spd: number;
  /** Extra turns / inserted ultimates are shown with AV 0 before regular turns. */
  readonly inserted?: boolean;
}

export type PlayerAction =
  | { readonly type: 'basic'; readonly actor: string; readonly target: string }
  | { readonly type: 'skill'; readonly actor: string; readonly target: string }
  | { readonly type: 'ultimate'; readonly actor: string; readonly target: string };

export interface DamageEvent {
  readonly sourceUid: string;
  readonly targetUid: string;
  readonly amount: number;
  readonly element: Element;
  readonly attackType: AttackType;
  readonly crit: boolean;
  readonly toughnessDamage: number;
  readonly broke: boolean;
}

export interface BattleState {
  readonly id: string;
  wave: number;
  readonly waveCount: number;
  /** Cycle counter (first cycle 150 AV, then 100 AV each). */
  cycle: number;
  /** Total action value elapsed since battle start. */
  avElapsed: number;
  units: Combatant[];
  skillPoints: SkillPointPool;
  /** Ultimates queued by the player to be inserted before the next turn. */
  ultimateQueue: string[];
  /** Unit currently taking its turn. */
  activeUid: string | null;
  outcome: 'ongoing' | 'victory' | 'defeat' | 'fled';
}
