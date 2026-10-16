import type { Element } from './common';
import type { StatBlock } from './stats';
import type { AttackType } from './ability';
import type { EnemyRank } from './enemy';

/**
 * Runtime combat state shapes. These are not loaded from data; they are what the combat engine
 * (Phase 5) builds from definitions + player instances, and what the combat HUD (Phase 16) renders.
 */
export type Side = 'ally' | 'enemy';

/**
 * What a combatant is. `memosprite` units belong to a character (`ownerUid`) and leave the field at
 * 0 HP; `summon` covers other owned units (enemy adds, character summons without memosprite rules).
 */
export type CombatantKind = 'character' | 'memosprite' | 'enemy' | 'summon';

/**
 * Where a unit is in its lifecycle:
 * - `active`: on the field and on the AV timeline.
 * - `downed`: a character or enemy at 0 HP (characters can be revived).
 * - `leftField`: a memosprite at 0 HP (or dismissed). It is off the timeline but not "downed": its
 *   owner is unaffected, ally-death triggers do not fire, and it can be summoned again.
 */
export type CombatantPresence = 'active' | 'downed' | 'leftField';

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

/** Runtime state of whatever charges a unit's Ultimate (see `UltimateResourceSchema`). */
export interface UltimateGauge {
  readonly kind: 'energy' | 'points';
  current: number;
  readonly max: number;
  /** Amount spent per Ultimate (energy: max). */
  readonly cost: number;
}

export interface Combatant {
  readonly uid: string;
  readonly kind: CombatantKind;
  readonly side: Side;
  /** Character, memosprite, enemy or summon definition id. */
  readonly defId: string;
  /** Owning unit for memosprites and summons (null for characters and wave enemies). */
  readonly ownerUid: string | null;
  readonly level: number;
  readonly element: Element | null;
  readonly rank: EnemyRank | null;
  /**
   * Base stats before any bonus: HP / ATK / DEF / SPD are the character + Light Cone base values (the
   * `base` of `aggregateStat`); CRIT, aggro and the like are absolute values.
   */
  readonly baseStats: Readonly<StatBlock>;
  /** Permanent bonuses on top of `baseStats` (Trace stat nodes, equipment): percent and flat stats. */
  readonly bonuses: Readonly<StatBlock>;
  /** Custom resource counters (Himeko / Blade Charge ...), by resource id. */
  resources: Record<string, number>;
  /** Enemy phase index (0-based; bosses change abilities and toughness between phases). */
  phase: number;
  /** Effective ability levels after traces and Eidolon bonuses, by slot. */
  readonly abilityLevels: Readonly<Record<string, number>>;
  hp: number;
  /** Ultimate resource; null for units without an Ultimate (enemies, memosprites). */
  ultimate: UltimateGauge | null;
  toughness: number;
  maxToughness: number;
  broken: boolean;
  weaknesses: Element[];
  statuses: ActiveStatus[];
  shield: number;
  /** Remaining action value until this unit's next turn. */
  actionValue: number;
  presence: CombatantPresence;
  /** Behaviour at 0 HP: characters/enemies are downed, memosprites leave the field. */
  readonly onZeroHp: 'downed' | 'leaveField';
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

/**
 * The player's choice for the active ally's turn. Memosprite turns use the memosprite actions;
 * characters whose kit replaces Basic ATK / Skill (enhanced states) use the `enhanced*` variants,
 * which reference the replacing ability by id.
 */
export type PlayerAction =
  | { readonly type: 'basic'; readonly actor: string; readonly target: string }
  | { readonly type: 'skill'; readonly actor: string; readonly target: string }
  | { readonly type: 'enhancedBasic'; readonly actor: string; readonly target: string; readonly abilityId: string }
  | { readonly type: 'enhancedSkill'; readonly actor: string; readonly target: string; readonly abilityId: string }
  | { readonly type: 'ultimate'; readonly actor: string; readonly target: string }
  | { readonly type: 'memospriteSkill'; readonly actor: string; readonly target: string; readonly abilityId: string };

/**
 * Actions inserted outside the regular AV order, resolved before the next regular turn:
 * - `followUp`: follow-up attacks triggered by talents/traces.
 * - `counter`: retaliation when an ally is hit.
 * - `extraTurn`: the unit immediately takes another full turn (does not consume AV).
 * - `memospriteAction`: a memosprite acting immediately (e.g. Mem acting at 100% Charge).
 * Ultimates are queued separately in `BattleState.ultimateQueue` because the player can insert them
 * at almost any time, and they resolve before inserted actions queued later.
 */
export interface InsertedAction {
  readonly kind: 'followUp' | 'counter' | 'extraTurn' | 'memospriteAction';
  readonly actorUid: string;
  /** Ability to execute (not used for `extraTurn`, which gives a normal turn). */
  readonly abilityId: string | null;
  /** Fixed target (e.g. the attacker for a counter); null lets the ability choose. */
  readonly targetUid: string | null;
  /** Unit and event that caused the insertion (for trigger limits and logging). */
  readonly sourceUid: string;
  /** Monotonic order key; lower resolves first. */
  readonly seq: number;
}

export interface QueuedUltimate {
  readonly actorUid: string;
  readonly targetUid: string;
}

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
  /** Ultimates queued by the player, inserted before the next action in queue order. */
  ultimateQueue: QueuedUltimate[];
  /** Follow-ups, counters, extra turns and immediate memosprite actions waiting to resolve. */
  insertedActions: InsertedAction[];
  /** Unit currently acting (regular turn or inserted action). */
  activeUid: string | null;
  outcome: 'ongoing' | 'victory' | 'defeat' | 'fled';
}
