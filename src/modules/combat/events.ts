import type { AttackType } from '@models/ability';
import type { Element } from '@models/common';
import type { Advantage } from '@models/world';

/**
 * The typed battle event stream. The engine appends every state change as an event; the combat HUD,
 * VFX, audio and the combat log subscribe to it (nothing in the engine knows about them). Events are
 * plain JSON, so a battle log can be compared across runs (determinism) and replayed.
 */
export type TurnKind = 'regular' | 'ultimate' | 'insert';

export interface HitEvent {
  readonly type: 'hit';
  readonly source: string;
  readonly target: string;
  readonly abilityId: string;
  readonly attackType: AttackType;
  readonly element: Element;
  /** Damage dealt to HP after shields (and before the 0 floor), unrounded. */
  readonly amount: number;
  /** Total damage of the hit (shield + HP). */
  readonly total: number;
  readonly crit: boolean;
  readonly weakness: boolean;
  readonly toughnessDamage: number;
  readonly broke: boolean;
  readonly hpAfter: number;
  readonly shieldAbsorbed: number;
}

export type BattleEvent =
  | { readonly type: 'battleStarted'; readonly seed: number; readonly advantage: Advantage; readonly party: readonly string[] }
  | { readonly type: 'waveStarted'; readonly wave: number; readonly waveCount: number; readonly enemies: readonly string[] }
  | { readonly type: 'cycle'; readonly cycle: number }
  | { readonly type: 'turnStarted'; readonly uid: string; readonly kind: TurnKind; readonly av: number }
  | { readonly type: 'turnEnded'; readonly uid: string }
  | { readonly type: 'turnSkipped'; readonly uid: string; readonly reason: string }
  | { readonly type: 'action'; readonly uid: string; readonly abilityId: string; readonly slot: string; readonly attackType: AttackType; readonly targets: readonly string[] }
  | HitEvent
  | { readonly type: 'dot'; readonly target: string; readonly statusId: string; readonly element: Element; readonly amount: number; readonly hpAfter: number }
  | { readonly type: 'heal'; readonly source: string; readonly target: string; readonly amount: number; readonly hpAfter: number }
  | { readonly type: 'shield'; readonly source: string; readonly target: string; readonly amount: number }
  | { readonly type: 'weaknessBreak'; readonly source: string; readonly target: string; readonly element: Element; readonly damage: number; readonly delay: number }
  | { readonly type: 'toughnessRecovered'; readonly uid: string }
  | { readonly type: 'skillPoints'; readonly current: number; readonly delta: number }
  | { readonly type: 'energy'; readonly uid: string; readonly current: number; readonly max: number; readonly delta: number }
  | { readonly type: 'statusApplied'; readonly source: string; readonly target: string; readonly statusId: string; readonly stacks: number; readonly turns: number }
  | { readonly type: 'statusResisted'; readonly source: string; readonly target: string; readonly statusId: string; readonly chance: number }
  | { readonly type: 'statusExpired'; readonly target: string; readonly statusId: string }
  | { readonly type: 'actionShift'; readonly uid: string; readonly fraction: number; readonly av: number }
  | { readonly type: 'speedChanged'; readonly uid: string; readonly spd: number }
  | { readonly type: 'unitDown'; readonly uid: string; readonly by: string | null }
  | { readonly type: 'phaseChanged'; readonly uid: string; readonly phase: number }
  | { readonly type: 'charging'; readonly uid: string; readonly abilityId: string; readonly turns: number }
  | { readonly type: 'insertQueued'; readonly kind: string; readonly actor: string; readonly abilityId: string | null; readonly target: string | null }
  | { readonly type: 'resource'; readonly uid: string; readonly resource: string; readonly value: number }
  | { readonly type: 'techniqueApplied'; readonly uid: string; readonly abilityId: string }
  | { readonly type: 'stub'; readonly what: string; readonly detail: string }
  | { readonly type: 'ended'; readonly outcome: 'victory' | 'defeat'; readonly cycles: number; readonly turns: number };

export type BattleListener = (event: BattleEvent) => void;

/** Short human-readable line for the combat log; `name` turns unit uids into display names. */
export function describeEvent(e: BattleEvent, name: (uid: string) => string): string | null {
  const n = (v: number): string => Math.round(v).toLocaleString('en-US');
  switch (e.type) {
    case 'battleStarted':
      return e.advantage === 'playerStrike' ? 'Battle start: Player Strike' : e.advantage === 'ambush' ? 'Battle start: Ambush' : 'Battle start';
    case 'waveStarted':
      return `Wave ${e.wave} / ${e.waveCount}`;
    case 'cycle':
      return `Cycle ${e.cycle}`;
    case 'turnSkipped':
      return `${name(e.uid)} cannot act (${e.reason})`;
    case 'action':
      return `${name(e.uid)} uses ${e.abilityId.split('.').pop()?.replace(/-/g, ' ') ?? e.abilityId}`;
    case 'hit':
      return `${name(e.source)} hits ${name(e.target)} for ${n(e.total)}${e.crit ? ' (CRIT)' : ''}${e.broke ? ' (BREAK)' : ''}`;
    case 'dot':
      return `${name(e.target)} takes ${n(e.amount)} ${e.element} damage (${e.statusId.split('.').pop()})`;
    case 'heal':
      return `${name(e.target)} recovers ${n(e.amount)} HP`;
    case 'shield':
      return `${name(e.target)} gains a ${n(e.amount)} shield`;
    case 'weaknessBreak':
      return `${name(e.target)} is Weakness Broken (${e.element}) for ${n(e.damage)}`;
    case 'toughnessRecovered':
      return `${name(e.uid)} recovers its toughness`;
    case 'statusApplied':
      return `${name(e.target)} is afflicted with ${e.statusId.split('.').pop()}`;
    case 'statusResisted':
      return `${name(e.target)} resists ${e.statusId.split('.').pop()}`;
    case 'unitDown':
      return `${name(e.uid)} is defeated`;
    case 'phaseChanged':
      return `${name(e.uid)} enters phase ${e.phase + 1}`;
    case 'charging':
      return `${name(e.uid)} is charging a powerful attack`;
    case 'techniqueApplied':
      return `${name(e.uid)}'s Technique takes effect`;
    case 'stub':
      return `[not yet implemented] ${e.what}: ${e.detail}`;
    case 'ended':
      return e.outcome === 'victory' ? 'Victory!' : 'Defeat';
    default:
      return null;
  }
}
