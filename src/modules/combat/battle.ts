import type { Ability, Condition, Effect, EffectTarget, Targeting, Trigger, TriggerEvent, Value } from '@models/ability';
import type { AttackType } from '@models/ability';
import type { Element, ItemStack } from '@models/common';
import type { BattleState, Combatant, InsertedAction, PlayerAction, TurnOrderEntry } from '@models/combat';
import { ELITE_OR_HIGHER, type EnemyAbility } from '@models/enemy';
import {
  applyToughnessHit,
  baseActionValue,
  breakActionDelay,
  breakDamageBase,
  breakDotDamageBase,
  characterDefMultiplier,
  computeDamage,
  createSkillPointPool,
  cycleAt,
  debuffApplyChance,
  enemyResistance,
  predictTurnOrder,
  regenerateEnergy,
  rescaleForSpeedChange,
  resolveValue,
  resolveZeroHp,
  shiftAction,
  toughnessReduction,
  type DamageInput,
} from '@models/formulas';
import { ELEMENT_DMG_STAT, ELEMENT_RES_STAT, type StatId } from '@models/stats';
import type { StatusEffect } from '@models/status';
import type { Advantage } from '@models/world';
import type { CombatData, PartyMemberSpec } from './data';
import type { BattleEvent, BattleListener, TurnKind } from './events';
import { rollRewards } from './loot';
import { SeededRng } from './rng';
import { DISPATCHED_TRIGGER_EVENTS, IMPLEMENTED_EFFECT_KINDS } from './stubs';
import { evalCondition, isActive, maxHp, opposing, allies as alliesOf, statValue, statusDef, type BattleView, type StatQuery } from './stats';
import { adjacentTo, pickEnemyTarget } from './targeting';
import { buildCharacterUnit, buildEnemyUnit, findAbility, slotOfAbility, type UnitInfo } from './units';

export class BattleError extends Error {
  override readonly name = 'BattleError';
}

export interface BattleConfig {
  readonly data: CombatData;
  readonly party: readonly PartyMemberSpec[];
  /** Enemy ids per wave. */
  readonly waves: readonly (readonly string[])[];
  readonly enemyLevel: number;
  readonly seed: number;
  readonly advantage?: Advantage;
  /** Character ids whose Technique is active (cast on the overworld) when the battle starts. */
  readonly techniques?: readonly string[];
  readonly id?: string;
}

export type StepResult =
  | { readonly kind: 'ultimate' | 'insert' | 'turn'; readonly uid: string }
  | { readonly kind: 'awaiting'; readonly uid: string }
  | { readonly kind: 'ended' };

export interface BattleResult {
  readonly outcome: 'victory' | 'defeat';
  readonly cycles: number;
  readonly turns: number;
  readonly seed: number;
  readonly advantage: Advantage;
  readonly defeated: ReadonlyArray<{ readonly uid: string; readonly defId: string }>;
  readonly rewards: readonly ItemStack[];
}

type AnyAbility = Ability | EnemyAbility;
type DamageEffect = Extract<Effect, { kind: 'damage' }>;

/** State threaded through one ability execution (an action, a trigger, an inserted action). */
interface ExecCtx {
  readonly actor: Combatant;
  readonly ability: AnyAbility;
  readonly params: Readonly<Record<string, readonly number[]>>;
  readonly level: number;
  readonly attackType: AttackType;
  readonly selected: Combatant | null;
  /** The unit that attacked (trigger contexts: `attacker` targets). */
  readonly attacker: Combatant | null;
  readonly hits: Array<{ target: Combatant; crit: boolean }>;
  lastCrit: boolean;
  readonly broke: Combatant[];
  readonly kills: Combatant[];
}

interface TriggerCtx {
  readonly actor?: Combatant;
  readonly subject?: Combatant;
  readonly attackType?: AttackType;
  readonly element?: Element;
}

const ATTACK_TYPE_STAT: Partial<Record<AttackType, StatId>> = {
  basic: 'basicDmg',
  skill: 'skillDmg',
  ultimate: 'ultimateDmg',
  followUp: 'followUpDmg',
  dot: 'dotDmg',
  break: 'breakDmg',
  superBreak: 'superBreakDmg',
};

const SHIELD_ID = 'builtin.shield';
const MAX_INSERTS_PER_TURN = 40;
const DOT_RES_KEY: Record<string, 'burn' | 'shock' | 'bleed' | 'windShear'> = { Fire: 'burn', Lightning: 'shock', Physical: 'bleed', Wind: 'windShear' };

/**
 * The battle engine. Deterministic (one seeded RNG stream) and presentation-free: it exposes the
 * state, a typed event stream and a small control API:
 *
 *   `step()`            runs the next thing: a queued Ultimate, an inserted action, or the next unit's
 *                       turn (enemies act at once; for an ally it stops at `awaiting`);
 *   `submit(action)`    performs the awaited ally's Basic ATK / Skill / Ultimate;
 *   `queueUltimate()`   inserts an Ultimate before the next action (can interrupt enemy turns).
 *
 * Order of resolution inside `step()`: queued Ultimates, then inserted actions (follow-ups,
 * counters), then the next regular turn. Ultimates and inserted actions never consume Action Value.
 */
export class Battle implements BattleView {
  readonly state: BattleState;
  readonly data: CombatData;
  readonly rng: SeededRng;
  readonly log: BattleEvent[] = [];
  readonly advantage: Advantage;
  readonly seed: number;
  readonly defeated: Combatant[] = [];
  turns = 0;
  private readonly infos = new Map<string, UnitInfo>();
  private readonly listeners = new Set<BattleListener>();
  private readonly spdCache = new Map<string, number>();
  private readonly stubsSeen = new Set<string>();
  private readonly waves: readonly (readonly string[])[];
  private readonly enemyLevel: number;
  private readonly techniques: readonly string[];
  private awaitingUid: string | null = null;
  private insertSeq = 0;
  private insertsThisTurn = 0;
  private nextEnemy = 1;
  private started = false;
  private rewards: ItemStack[] = [];
  private names = new Map<string, string>();
  private readonly initialised = new Set<string>();

  constructor(cfg: BattleConfig) {
    this.data = cfg.data;
    this.seed = cfg.seed;
    this.rng = new SeededRng(cfg.seed);
    this.advantage = cfg.advantage ?? 'neutral';
    this.waves = cfg.waves;
    this.enemyLevel = cfg.enemyLevel;
    this.techniques = cfg.techniques ?? [];
    if (cfg.party.length === 0) throw new BattleError('a battle needs at least one party member');
    if (cfg.waves.length === 0 || cfg.waves.some((w) => w.length === 0)) throw new BattleError('every wave needs at least one enemy');
    this.state = {
      id: cfg.id ?? `battle-${cfg.seed}`,
      wave: 1,
      waveCount: cfg.waves.length,
      cycle: 1,
      avElapsed: 0,
      units: [],
      skillPoints: createSkillPointPool(cfg.data.rules),
      ultimateQueue: [],
      insertedActions: [],
      activeUid: null,
      outcome: 'ongoing',
    };
    cfg.party.forEach((spec, i) => {
      const { unit, info } = buildCharacterUnit(cfg.data, spec, `ally-${i + 1}`);
      this.addUnit(unit, info);
    });
    this.spawnWave(1);
  }

  // ---- Setup and queries ------------------------------------------------------------------------

  private addUnit(unit: Combatant, info: UnitInfo): void {
    this.state.units.push(unit);
    this.infos.set(unit.uid, info);
    unit.actionValue = baseActionValue(statValue(this, unit, 'spd'), this.data.rules);
    this.spdCache.set(unit.uid, statValue(this, unit, 'spd'));
    const name = info.character?.name ?? info.enemy?.name ?? unit.defId;
    const same = [...this.names.values()].filter((n) => n === name || n.startsWith(`${name} `)).length;
    this.names.set(unit.uid, same === 0 ? name : `${name} ${String.fromCharCode(65 + same)}`);
    if (same === 1) {
      // The first of a repeated name gains the letter A once a second one appears.
      for (const [uid, n] of this.names) if (n === name && uid !== unit.uid) this.names.set(uid, `${name} A`);
    }
  }

  private spawnWave(wave: number): void {
    const ids = this.waves[wave - 1] ?? [];
    for (const id of ids) {
      const { unit, info } = buildEnemyUnit(this.data, id, this.enemyLevel, `enemy-${this.nextEnemy++}`, wave);
      this.addUnit(unit, info);
    }
  }

  get units(): readonly Combatant[] {
    return this.state.units;
  }

  get outcome(): BattleState['outcome'] {
    return this.state.outcome;
  }

  get awaiting(): string | null {
    return this.awaitingUid;
  }

  info(uid: string): UnitInfo {
    const i = this.infos.get(uid);
    if (!i) throw new BattleError(`unknown unit ${uid}`);
    return i;
  }

  unit(uid: string): Combatant {
    const u = this.state.units.find((x) => x.uid === uid);
    if (!u) throw new BattleError(`unknown unit ${uid}`);
    return u;
  }

  /** Display name of a unit ("Silvermane Soldier B" when several share a name). */
  nameOf(uid: string): string {
    return this.names.get(uid) ?? uid;
  }

  subscribe(listener: BattleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: BattleEvent): void {
    this.log.push(e);
    for (const l of this.listeners) l(e);
  }

  private stub(what: string, detail: string): void {
    const key = `${what}|${detail}`;
    if (this.stubsSeen.has(key)) return;
    this.stubsSeen.add(key);
    this.emit({ type: 'stub', what, detail });
  }

  stat(unit: Combatant, stat: StatId, q?: StatQuery): number {
    return statValue(this, unit, stat, q);
  }

  /** Current SPD of a unit (with every modifier). */
  spd(unit: Combatant): number {
    return statValue(this, unit, 'spd');
  }

  maxHp(unit: Combatant): number {
    return maxHp(this, unit);
  }

  /** Predicted turn order for the turn-order bar. */
  turnOrder(count: number): TurnOrderEntry[] {
    const live = this.state.units.filter(isActive);
    return predictTurnOrder(
      live.map((u) => ({ uid: u.uid, spd: this.spd(u), actionValue: u.actionValue })),
      count,
      this.data.rules,
    );
  }

  // ---- Battle start -----------------------------------------------------------------------------

  /** Applies the opening advantage, battle-start effects (Techniques, talents) and wave triggers. */
  start(): void {
    if (this.started) throw new BattleError('the battle already started');
    this.started = true;
    const rules = this.data.rules;
    this.emit({ type: 'battleStarted', seed: this.seed, advantage: this.advantage, party: this.state.units.filter((u) => u.side === 'ally').map((u) => u.uid) });
    if (this.advantage === 'playerStrike') {
      for (const u of this.state.units) if (u.side === 'ally') u.actionValue = shiftAction(u.actionValue, this.spd(u), rules.advantage.playerStrikeAdvance, rules);
    } else if (this.advantage === 'ambush') {
      for (const u of this.state.units) if (u.side === 'enemy') u.actionValue = shiftAction(u.actionValue, this.spd(u), rules.advantage.ambushEnemyAdvance, rules);
    }
    this.emit({ type: 'waveStarted', wave: 1, waveCount: this.state.waveCount, enemies: this.state.units.filter((u) => u.side === 'enemy').map((u) => u.uid) });
    this.enterInitialPhases();
    // Techniques cast on the overworld take effect first, then passive battle-start triggers.
    for (const charId of this.techniques) {
      const caster = this.state.units.find((u) => u.side === 'ally' && u.defId === charId);
      const tech = caster ? this.info(caster.uid).character?.abilities.technique : undefined;
      if (!caster || !tech) continue;
      this.emit({ type: 'techniqueApplied', uid: caster.uid, abilityId: tech.id });
      for (const t of tech.triggers.filter((x) => x.on === 'battleStart')) this.runTrigger(caster, t, tech, { actor: caster }, `technique:${tech.id}`);
    }
    this.fire('battleStart', {});
    this.fire('waveStart', {});
    this.reportInertTriggers();
  }

  private reportInertTriggers(): void {
    const inert = new Set<string>();
    for (const u of this.state.units) {
      for (const t of this.triggerSources(u)) if (!(DISPATCHED as ReadonlySet<string>).has(t.trigger.on)) inert.add(t.trigger.on);
    }
    if (inert.size > 0) this.stub('triggers', `events not dispatched yet (5B): ${[...inert].sort().join(', ')}`);
  }

  // ---- Stepping ---------------------------------------------------------------------------------

  /** Runs the next unit of work. Stops at `awaiting` when an ally must choose an action. */
  step(): StepResult {
    if (!this.started) this.start();
    if (this.state.outcome !== 'ongoing') return { kind: 'ended' };
    const ult = this.state.ultimateQueue.shift();
    if (ult) {
      const actor = this.unit(ult.actorUid);
      const ability = this.info(actor.uid).character?.abilities.ultimate;
      if (isActive(actor) && ability && this.canUltimate(actor)) {
        this.emit({ type: 'turnStarted', uid: actor.uid, kind: 'ultimate', av: this.state.avElapsed });
        this.castUltimate(actor, ability, this.resolveSelected(actor, ability.targeting, ult.targetUid));
        this.emit({ type: 'turnEnded', uid: actor.uid });
        this.afterAction();
        return { kind: 'ultimate', uid: actor.uid };
      }
      return this.step();
    }
    if (this.state.insertedActions.length > 0) {
      this.state.insertedActions.sort((a, b) => a.seq - b.seq);
      const ins = this.state.insertedActions.shift()!;
      const actor = this.unit(ins.actorUid);
      if (isActive(actor)) this.runInserted(actor, ins);
      this.afterAction();
      return { kind: 'insert', uid: ins.actorUid };
    }
    if (this.awaitingUid) return { kind: 'awaiting', uid: this.awaitingUid };
    return this.beginTurn();
  }

  /** Steps until an ally must act or the battle ends. Returns false if `maxSteps` ran out (a bug guard). */
  runUntilInput(maxSteps = 5000): boolean {
    for (let i = 0; i < maxSteps; i++) {
      const r = this.step();
      if (r.kind === 'awaiting' || r.kind === 'ended') return true;
    }
    return false;
  }

  private beginTurn(): StepResult {
    const live = this.state.units.filter(isActive);
    if (live.length === 0) return { kind: 'ended' };
    let next = live[0]!;
    for (const u of live) if (u.actionValue < next.actionValue - 1e-9) next = u;
    const elapsed = Math.max(0, next.actionValue);
    for (const u of live) u.actionValue = Math.max(0, u.actionValue - elapsed);
    this.state.avElapsed += elapsed;
    const cycle = cycleAt(this.state.avElapsed, this.data.rules) + 1;
    if (cycle > this.state.cycle) {
      this.state.cycle = cycle;
      this.emit({ type: 'cycle', cycle });
    }
    // The acting unit's AV resets to a full base AV as its turn starts (advances apply to the new value).
    next.actionValue = baseActionValue(this.spd(next), this.data.rules);
    this.state.activeUid = next.uid;
    this.insertsThisTurn = 0;
    this.emit({ type: 'turnStarted', uid: next.uid, kind: 'regular', av: this.state.avElapsed });
    const phase = this.turnStartPhase(next);
    if (phase === 'died') {
      this.finishTurn(next);
      return { kind: 'turn', uid: next.uid };
    }
    if (phase === 'skipped') {
      this.finishTurn(next);
      return { kind: 'turn', uid: next.uid };
    }
    if (next.side === 'ally') {
      this.awaitingUid = next.uid;
      return { kind: 'awaiting', uid: next.uid };
    }
    this.runEnemyTurn(next);
    this.finishTurn(next);
    return { kind: 'turn', uid: next.uid };
  }

  /** Start-of-turn processing: DoT ticks, Crowd Control, duration countdown, toughness recovery. */
  private turnStartPhase(u: Combatant): 'act' | 'skipped' | 'died' {
    const info = this.info(u.uid);
    info.turnsTaken++;
    info.perTurn = {};
    for (const k of Object.keys(info.triggerCooldown)) info.triggerCooldown[k] = Math.max(0, (info.triggerCooldown[k] ?? 0) - 1);
    for (const k of Object.keys(info.cooldowns)) info.cooldowns[k] = Math.max(0, (info.cooldowns[k] ?? 0) - 1);
    this.fire('turnStart', { actor: u });
    for (const s of [...u.statuses]) {
      const def = statusDef(this, s.statusId);
      if (def?.dot && def.dot.tickOn === 'ownerTurnStart') {
        this.dotTick(u, s, def);
        if (!isActive(u)) return 'died';
      }
    }
    const skip = u.statuses.find((s) => statusDef(this, s.statusId)?.cc?.skipsTurn);
    this.tickDurations(u, 'ownerTurnStart');
    this.tickCasterDurations(u, 'casterTurnStart');
    if (!isActive(u)) return 'died';
    if (u.broken && u.side === 'enemy' && this.data.rules.weaknessBreak.recoverOnNextTurn) {
      u.broken = false;
      u.toughness = u.maxToughness;
      this.emit({ type: 'toughnessRecovered', uid: u.uid });
    }
    if (skip) {
      const def = statusDef(this, skip.statusId);
      this.emit({ type: 'turnSkipped', uid: u.uid, reason: def?.cc?.type ?? 'crowd control' });
      return 'skipped';
    }
    return 'act';
  }

  private finishTurn(u: Combatant): void {
    if (isActive(u)) {
      this.fire('turnEnd', { actor: u });
      this.tickDurations(u, 'ownerTurnEnd');
      this.tickCasterDurations(u, 'casterTurnEnd');
    }
    this.state.activeUid = null;
    this.awaitingUid = null;
    this.turns++;
    this.emit({ type: 'turnEnded', uid: u.uid });
    this.afterAction();
  }

  // ---- Player input -----------------------------------------------------------------------------

  /** The ability a player action refers to. */
  private abilityFor(actor: Combatant, action: PlayerAction): Ability {
    const ch = this.info(actor.uid).character;
    if (!ch) throw new BattleError(`${actor.uid} is not a character`);
    switch (action.type) {
      case 'basic':
        return ch.abilities.basic;
      case 'skill':
        return ch.abilities.skill;
      case 'ultimate':
        return ch.abilities.ultimate;
      case 'enhancedBasic':
      case 'enhancedSkill':
      case 'memospriteSkill': {
        const a = ch.abilities.extra.find((x) => x.id === action.abilityId);
        if (!a) throw new BattleError(`unknown ability ${action.abilityId}`);
        return a;
      }
    }
  }

  canUltimate(u: Combatant): boolean {
    const g = u.ultimate;
    return isActive(u) && g !== null && g.current >= g.cost - 1e-9;
  }

  /** What the player may do on the awaited unit's turn (for the action buttons). */
  canUse(uid: string, slot: 'basic' | 'skill' | 'ultimate'): { ok: boolean; reason?: string } {
    const u = this.unit(uid);
    const ch = this.info(uid).character;
    if (!ch || !isActive(u)) return { ok: false, reason: 'unavailable' };
    if (slot === 'skill' && this.state.skillPoints.current < ch.abilities.skill.spCost) return { ok: false, reason: 'Not enough Skill Points' };
    if (slot === 'ultimate' && !this.canUltimate(u)) return { ok: false, reason: 'Energy is not full' };
    return { ok: true };
  }

  /** Units the player may pick for an ability (empty when the ability needs no selection). */
  selectableTargets(uid: string, slot: 'basic' | 'skill' | 'ultimate'): Combatant[] {
    const u = this.unit(uid);
    const a = this.info(uid).character?.abilities[slot];
    if (!a) return [];
    switch (a.targeting) {
      case 'enemySingle':
      case 'enemyBlast':
      case 'enemyBounce':
        return opposing(this, u);
      case 'allySingle':
        return alliesOf(this, u);
      default:
        return [];
    }
  }

  /** Performs the awaited ally's action; Basic ATK and Skill end its turn. */
  submit(action: PlayerAction): StepResult {
    if (this.state.outcome !== 'ongoing') throw new BattleError('the battle is over');
    if (action.type === 'ultimate') {
      this.queueUltimate(action.actor, action.target);
      return this.step();
    }
    if (this.awaitingUid !== action.actor) throw new BattleError(`it is not ${action.actor}'s turn`);
    const actor = this.unit(action.actor);
    const ability = this.abilityFor(actor, action);
    const isSkill = action.type === 'skill' || action.type === 'enhancedSkill' || action.type === 'memospriteSkill';
    if (ability.spCost > 0 && this.state.skillPoints.current < ability.spCost) throw new BattleError('not enough Skill Points');
    const selected = this.resolveSelected(actor, ability.targeting, action.target);
    if (ability.spCost > 0) this.changeSp(-ability.spCost);
    if (ability.spGain > 0) this.changeSp(ability.spGain);
    this.executeAbility(actor, ability, selected, isSkill ? 'skill' : 'basic');
    if (!ability.keepsTurn && isActive(actor)) {
      this.finishTurn(actor);
    } else if (!isActive(actor)) {
      this.finishTurn(actor);
    }
    return { kind: 'turn', uid: actor.uid };
  }

  /** Queues an Ultimate; it resolves at the start of the next `step()`, before inserted actions and turns. */
  queueUltimate(actorUid: string, targetUid: string): void {
    const u = this.unit(actorUid);
    if (!this.canUltimate(u)) throw new BattleError(`${actorUid} cannot cast its Ultimate (energy ${u.ultimate?.current ?? 0}/${u.ultimate?.cost ?? 0})`);
    if (this.state.ultimateQueue.some((q) => q.actorUid === actorUid)) return;
    this.state.ultimateQueue.push({ actorUid, targetUid });
  }

  /** The player's pick, validated against the ability's targeting. */
  private resolveSelected(actor: Combatant, targeting: Targeting, uid: string | null): Combatant | null {
    switch (targeting) {
      case 'enemySingle':
      case 'enemyBlast':
      case 'enemyBounce': {
        const pool = opposing(this, actor);
        return pool.find((u) => u.uid === uid) ?? pool[0] ?? null;
      }
      case 'allySingle': {
        const pool = alliesOf(this, actor);
        return pool.find((u) => u.uid === uid) ?? actor;
      }
      case 'self':
        return actor;
      default:
        return null;
    }
  }

  private changeSp(delta: number): void {
    const pool = this.state.skillPoints;
    const before = pool.current;
    pool.current = Math.max(0, Math.min(pool.max, pool.current + delta));
    if (pool.current !== before) this.emit({ type: 'skillPoints', current: pool.current, delta: pool.current - before });
  }

  // ---- Executing abilities ----------------------------------------------------------------------

  private levelOf(info: UnitInfo, actor: Combatant, ability: AnyAbility): number {
    if (info.enemy) return 1;
    const slot = slotOfAbility(info, ability.id);
    return actor.abilityLevels[slot === 'extra' ? 'talent' : slot] ?? 1;
  }

  private attackTypeOf(info: UnitInfo, ability: AnyAbility): AttackType {
    const slot = slotOfAbility(info, ability.id);
    if (slot === 'basic') return 'basic';
    if (slot === 'skill') return 'skill';
    if (slot === 'ultimate') return 'ultimate';
    if (slot === 'enemy') return 'basic';
    const first = ability.effects.find((e): e is DamageEffect => e.kind === 'damage');
    return first?.attackType ?? 'followUp';
  }

  private newCtx(actor: Combatant, ability: AnyAbility, selected: Combatant | null, attacker: Combatant | null = null, attackType?: AttackType): ExecCtx {
    const info = this.info(actor.uid);
    return {
      actor,
      ability,
      params: ability.params,
      level: this.levelOf(info, actor, ability),
      attackType: attackType ?? this.attackTypeOf(info, ability),
      selected,
      attacker,
      hits: [],
      lastCrit: false,
      broke: [],
      kills: [],
    };
  }

  /** Runs an ability's effects, spends / grants Energy and fires the "after use" triggers. */
  private executeAbility(actor: Combatant, ability: AnyAbility, selected: Combatant | null, kind: 'basic' | 'skill' | 'ultimate' | 'insert' | 'enemy'): ExecCtx {
    const info = this.info(actor.uid);
    const ctx = this.newCtx(actor, ability, selected);
    const preview = this.previewTargets(ctx, ability.targeting);
    this.emit({ type: 'action', uid: actor.uid, abilityId: ability.id, slot: slotOfAbility(info, ability.id), attackType: ctx.attackType, targets: preview.map((u) => u.uid) });
    if (kind === 'ultimate' && actor.ultimate) {
      const g = actor.ultimate;
      g.current = Math.max(0, g.current - g.cost);
      this.emit({ type: 'energy', uid: actor.uid, current: g.current, max: g.max, delta: -g.cost });
    }
    for (const e of ability.effects) this.runEffect(ctx, e);
    if (actor.ultimate?.kind === 'energy' && ability.kind !== 'enemy') {
      const gain = (ability as Ability).energyGain;
      if (gain > 0) this.addEnergy(actor, gain, false);
    }
    this.afterAbility(ctx, kind);
    return ctx;
  }

  private castUltimate(actor: Combatant, ability: Ability, selected: Combatant | null): void {
    this.executeAbility(actor, ability, selected, 'ultimate');
  }

  private previewTargets(ctx: ExecCtx, targeting: Targeting): Combatant[] {
    const { actor, selected } = ctx;
    switch (targeting) {
      case 'enemySingle':
      case 'enemyBounce':
      case 'allySingle':
        return selected ? [selected] : [];
      case 'enemyBlast':
        return selected ? [selected, ...adjacentTo(this, selected)] : [];
      case 'enemyAll':
        return opposing(this, actor);
      case 'allyAll':
        return alliesOf(this, actor);
      case 'self':
        return [actor];
      default:
        return [];
    }
  }

  /** After an ability: strip "until next attack" buffs and fire the trigger events. */
  private afterAbility(ctx: ExecCtx, kind: 'basic' | 'skill' | 'ultimate' | 'insert' | 'enemy'): void {
    const { actor } = ctx;
    const attacked = ctx.hits.length > 0;
    if (attacked) {
      for (const s of [...actor.statuses]) if (statusDef(this, s.statusId)?.expiresAfterAttack) this.removeStatus(actor, s.statusId);
    }
    if (isActive(actor) || kind === 'enemy') {
      const primary = ctx.hits[0]?.target ?? ctx.selected ?? undefined;
      const t: TriggerCtx = { actor, subject: primary, attackType: ctx.attackType };
      if (kind === 'basic') this.fire('afterUseBasic', t);
      if (kind === 'skill') this.fire('afterUseSkill', t);
      if (kind === 'ultimate') this.fire('afterUseUltimate', t);
      if (attacked) {
        this.fire('afterAttack', t);
        this.fire('afterAllyAttack', t);
      }
      if (kind === 'ultimate') this.fire('afterAllyUsesUltimate', t);
      if (kind === 'insert') this.fire('onFollowUp', t);
      if (ctx.ability.targeting === 'allySingle' && ctx.selected && ctx.selected !== actor && ctx.selected.side === actor.side) this.fire('onTargetedByAlly', { actor, subject: ctx.selected });
    }
    // Hit reactions fire once per distinct target after the whole attack has resolved.
    const seen = new Set<string>();
    for (const h of ctx.hits) {
      if (seen.has(h.target.uid) || !isActive(h.target)) continue;
      seen.add(h.target.uid);
      this.fire('afterBeingHit', { actor, subject: h.target, attackType: ctx.attackType });
      this.fire('afterAllyHit', { actor, subject: h.target, attackType: ctx.attackType });
    }
    for (const k of ctx.kills) {
      this.fire('onKill', { actor, subject: k });
      this.fire('onEnemyDefeated', { actor, subject: k });
    }
    for (const t of ctx.broke) {
      this.fire('onWeaknessBreak', { actor, subject: t });
      this.fire('afterAllyWeaknessBreak', { actor, subject: t });
    }
  }

  // ---- Effects ----------------------------------------------------------------------------------

  private val(ctx: ExecCtx, v: Value): number {
    if (typeof v === 'object' && 'param' in v && v.from) {
      const ch = this.info(ctx.actor.uid).character;
      const src = ch?.abilities[v.from];
      if (!src) return 0;
      return resolveValue({ param: v.param }, ctx.actor.abilityLevels[v.from] ?? 1, src.params, this.data.curves);
    }
    return resolveValue(v, ctx.level, ctx.params, this.data.curves);
  }

  private resolveParams(ctx: ExecCtx, params: Record<string, Value> | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(params ?? {})) out[k] = this.val(ctx, v);
    return out;
  }

  private effectTargets(ctx: ExecCtx, t: EffectTarget): Combatant[] {
    const { actor, selected } = ctx;
    switch (t) {
      case 'primary':
        return selected && isActive(selected) ? [selected] : [];
      case 'adjacent':
        return selected ? adjacentTo(this, selected) : [];
      case 'allEnemies':
        return opposing(this, actor);
      case 'randomEnemy': {
        const pool = opposing(this, actor);
        return pool.length ? [this.rng.pick(pool)] : [];
      }
      case 'self':
        return isActive(actor) || actor.presence === 'downed' ? [actor] : [];
      case 'selectedAlly':
        return selected && selected.side === actor.side && isActive(selected) ? [selected] : isActive(actor) ? [actor] : [];
      case 'allAllies':
        return alliesOf(this, actor);
      case 'allAlliesExceptSelf':
        return alliesOf(this, actor).filter((u) => u !== actor);
      case 'attacker':
        return ctx.attacker && isActive(ctx.attacker) ? [ctx.attacker] : [];
      case 'lowestHpAlly': {
        const pool = alliesOf(this, actor);
        return pool.length ? [pool.reduce((a, b) => (a.hp / this.maxHp(a) <= b.hp / this.maxHp(b) ? a : b))] : [];
      }
      case 'randomAlly': {
        const pool = alliesOf(this, actor);
        return pool.length ? [this.rng.pick(pool)] : [];
      }
      default:
        this.stub('target', `"${t}" targets (memosprites and summons) arrive in 5B`);
        return [];
    }
  }

  private conditionsHold(ctx: ExecCtx, conds: readonly Condition[] | undefined, target: Combatant | null): boolean {
    if (!conds || conds.length === 0) return true;
    const q: StatQuery = { target, attackType: ctx.attackType, crit: ctx.lastCrit, allowRandom: true };
    return conds.every((c) => evalCondition(this, c, ctx.actor, q));
  }

  private runEffect(ctx: ExecCtx, e: Effect): void {
    if (!IMPLEMENTED_EFFECT_KINDS.has(e.kind)) {
      this.stub(e.kind === 'script' ? `script ${e.handler}` : `effect ${e.kind}`, `${ctx.ability.id} (5B)`);
      return;
    }
    switch (e.kind) {
      case 'damage':
        return this.runDamage(ctx, e);
      case 'heal':
        return this.runHeal(ctx, e);
      case 'shield':
        return this.runShield(ctx, e);
      case 'applyStatus': {
        for (const t of this.effectTargets(ctx, e.target)) {
          if (!this.conditionsHold(ctx, e.targetConditions, t)) continue;
          this.applyStatus(ctx.actor, t, e.status, {
            baseChance: e.baseChance !== undefined ? this.val(ctx, e.baseChance) : undefined,
            fixed: e.fixedChance,
            duration: e.duration !== undefined ? this.val(ctx, e.duration) : undefined,
            stacks: e.stacks,
            params: this.resolveParams(ctx, e.params),
          });
        }
        return;
      }
      case 'removeStatus':
        for (const t of this.effectTargets(ctx, e.target)) this.removeStatus(t, e.status);
        return;
      case 'dispel':
        for (const t of this.effectTargets(ctx, e.target)) this.dispel(t, e.statusKind, Math.round(this.val(ctx, e.count)), e.category === 'cc');
        return;
      case 'energy':
        for (const t of this.effectTargets(ctx, e.target)) if (t.ultimate?.kind === 'energy') this.addEnergy(t, this.val(ctx, e.amount), e.fixed === true);
        return;
      case 'skillPoints':
        this.changeSp(e.amount);
        return;
      case 'actionAdvance': {
        const f = this.val(ctx, e.fraction) * (e.delay ? -1 : 1);
        for (const t of this.effectTargets(ctx, e.target)) this.shiftAction(t, f);
        return;
      }
      case 'hpChange': {
        const ratio = this.val(ctx, e.ratio);
        for (const t of this.effectTargets(ctx, e.target)) {
          const max = this.maxHp(t);
          t.hp = e.mode === 'consume' ? Math.max(1, t.hp - max * ratio) : Math.min(max, max * ratio);
        }
        return;
      }
      case 'gainResource': {
        const amount = this.val(ctx, e.amount);
        for (const t of this.effectTargets(ctx, e.target)) this.changeResource(t, e.resource, amount);
        return;
      }
      case 'insertAction':
        this.queueInsert(ctx, e);
        return;
      default:
        return;
    }
  }

  private changeResource(u: Combatant, id: string, delta: number): void {
    const def = this.info(u.uid).character?.resources.find((r) => r.id === id);
    const max = def?.max ?? Infinity;
    u.resources[id] = Math.max(0, Math.min(max, (u.resources[id] ?? 0) + delta));
    this.emit({ type: 'resource', uid: u.uid, resource: id, value: u.resources[id]! });
  }

  private queueInsert(ctx: ExecCtx, e: Extract<Effect, { kind: 'insertAction' }>): void {
    if (e.actor !== 'self') {
      this.stub('insertAction', `actor "${e.actor}" (memosprites and summons) arrives in 5B`);
      return;
    }
    const actor = ctx.actor;
    if (!isActive(actor)) return;
    const target = e.target ? (this.effectTargets(ctx, e.target)[0] ?? null) : null;
    if (e.action !== 'extraTurn' && this.state.insertedActions.some((a) => a.actorUid === actor.uid && a.abilityId === (e.ability ?? null) && a.kind === e.action)) return;
    const ia: InsertedAction = { kind: e.action, actorUid: actor.uid, abilityId: e.ability ?? null, targetUid: target?.uid ?? null, sourceUid: ctx.attacker?.uid ?? actor.uid, seq: this.insertSeq++ };
    this.state.insertedActions.push(ia);
    this.emit({ type: 'insertQueued', kind: e.action, actor: actor.uid, abilityId: ia.abilityId, target: ia.targetUid });
  }

  private runInserted(actor: Combatant, ins: InsertedAction): void {
    this.insertsThisTurn++;
    if (this.insertsThisTurn > MAX_INSERTS_PER_TURN) return;
    if (ins.kind === 'extraTurn') {
      this.stub('insertAction', 'extra turns arrive in 5B');
      return;
    }
    const ability = ins.abilityId ? findAbility(this.info(actor.uid), ins.abilityId) : undefined;
    if (!ability) return;
    let selected: Combatant | null = ins.targetUid ? this.unit(ins.targetUid) : null;
    if (selected && !isActive(selected)) selected = null;
    if (!selected && (ability.targeting === 'enemySingle' || ability.targeting === 'enemyBlast' || ability.targeting === 'enemyBounce')) {
      const pool = opposing(this, actor);
      selected = pool.length ? this.rng.pick(pool) : null;
    }
    if (!selected && ability.targeting !== 'enemyAll' && ability.targeting !== 'none' && ability.targeting !== 'self' && ability.targeting !== 'allyAll') return;
    this.emit({ type: 'turnStarted', uid: actor.uid, kind: 'insert', av: this.state.avElapsed });
    this.executeAbility(actor, ability, selected, 'insert');
    this.emit({ type: 'turnEnded', uid: actor.uid });
  }

  // ---- Damage -----------------------------------------------------------------------------------

  private runDamage(ctx: ExecCtx, e: DamageEffect): void {
    const mult = this.val(ctx, e.multiplier);
    const split = e.hitSplit ? this.normaliseSplit(e.hitSplit) : [1];
    const element = e.element ?? ctx.actor.element ?? 'Physical';
    const attackType = e.attackType ?? ctx.attackType;
    const extra = (e.extraScaling ?? []).map((x) => ({ stat: x.stat, mult: this.val(ctx, x.multiplier) }));
    const hitOn = (target: Combatant): void => {
      if (!isActive(target)) return;
      if (!this.conditionsHold(ctx, e.targetConditions, target)) return;
      split.forEach((fraction) => {
        if (!isActive(target)) return;
        this.dealHit(ctx, e, target, mult, fraction, extra, element, attackType);
      });
    };
    if (e.target === 'randomEnemy') {
      const count = 1 + (e.bounces !== undefined ? Math.round(this.val(ctx, e.bounces)) : 0);
      for (let i = 0; i < count; i++) {
        const pool = opposing(this, ctx.actor);
        if (pool.length === 0) break;
        hitOn(this.rng.pick(pool));
      }
      return;
    }
    for (const t of this.effectTargets(ctx, e.target)) hitOn(t);
  }

  private normaliseSplit(s: readonly number[]): number[] {
    const total = s.reduce((a, b) => a + b, 0);
    return s.map((x) => x / total);
  }

  /** DEF / RES / vulnerability / mitigation / broken zones for a hit on `target`. */
  private defenceZones(target: Combatant, element: Element, attackerLevel: number, attacker: Combatant | null, q: StatQuery): Pick<DamageInput, 'targetRes' | 'resPen' | 'vulnerability' | 'mitigations' | 'targetBroken' | 'defReduction' | 'defIgnore' | 'defMultiplier' | 'attackerLevel' | 'targetLevel'> {
    const rules = this.data.rules;
    const isEnemy = target.side === 'enemy';
    const isWeak = isEnemy && target.weaknesses.includes(element);
    const enemy = this.info(target.uid).enemy;
    const baseRes = isEnemy ? enemyResistance(isWeak, enemy?.resistances[element], rules) : 0;
    const targetRes = baseRes + this.stat(target, ELEMENT_RES_STAT[element], q) + this.stat(target, 'allRes', q);
    const mitigation = this.stat(target, 'dmgMitigation', q);
    const defReduction = this.stat(target, 'defReduction', q);
    const defIgnore = attacker ? this.stat(attacker, 'defIgnore', q) : 0;
    return {
      attackerLevel,
      targetLevel: target.level,
      targetRes,
      resPen: attacker ? this.stat(attacker, 'resPen', q) : 0,
      vulnerability: this.stat(target, 'vulnerability', q),
      mitigations: mitigation > 0 ? [mitigation] : [],
      targetBroken: isEnemy ? target.broken : true,
      defReduction,
      defIgnore,
      defMultiplier: isEnemy ? undefined : characterDefMultiplier(this.stat(target, 'def', q) * (1 - Math.min(1, defReduction + defIgnore)), attackerLevel, rules),
    };
  }

  private dealHit(ctx: ExecCtx, e: DamageEffect, target: Combatant, mult: number, fraction: number, extra: Array<{ stat: 'atk' | 'hp' | 'def'; mult: number }>, element: Element, attackType: AttackType): void {
    const rules = this.data.rules;
    const actor = ctx.actor;
    const q: StatQuery = { target, attackType, element };
    const scalingActor = actor;
    const crit = actor.side === 'ally' ? this.rng.chance(Math.min(1, Math.max(0, this.stat(actor, 'critRate', q)))) : false;
    ctx.lastCrit = crit;
    const critQ: StatQuery = { ...q, crit };
    const zones = this.defenceZones(target, element, actor.level, actor, critQ);
    const boost = this.stat(actor, ELEMENT_DMG_STAT[element], critQ) + this.stat(actor, 'allDmg', critQ) + (ATTACK_TYPE_STAT[attackType] ? this.stat(actor, ATTACK_TYPE_STAT[attackType]!, critQ) : 0);
    const extraFlat = extra.reduce((s, x) => s + x.mult * fraction * this.stat(scalingActor, x.stat, critQ), 0);
    const result = computeDamage(
      {
        multiplier: mult * fraction,
        scalingStat: this.stat(scalingActor, e.stat, critQ),
        extraFlat,
        isCrit: crit,
        critRate: 0,
        critDmg: this.stat(actor, 'critDmg', critQ),
        dmgBoost: boost,
        weaken: this.stat(actor, 'weaken', critQ),
        ...zones,
      },
      rules,
    );
    const isWeak = target.side === 'enemy' && target.weaknesses.includes(element);
    const dealt = this.inflict(target, result.total);
    // Toughness: only against enemies, only for a matching Weakness (or abilities that ignore it).
    let toughnessDamage = 0;
    let broke = false;
    if (target.side === 'enemy' && actor.side === 'ally' && e.toughness > 0 && !target.broken && target.hp > 0) {
      let reduction = toughnessReduction(e.toughness * fraction, isWeak, this.stat(actor, 'breakEfficiency', critQ), e.ignoresWeakness === true);
      if (this.toughnessProtected(target)) reduction = 0;
      if (reduction > 0) {
        const r = applyToughnessHit(target.toughness, reduction);
        target.toughness = r.remaining;
        toughnessDamage = r.reduced;
        broke = r.broke;
      }
    }
    // Being hit charges an ally's Energy (the attacking enemy ability says how much).
    if (target.side === 'ally' && actor.side === 'enemy' && target.ultimate?.kind === 'energy') {
      const gain = ctx.ability.kind === 'enemy' ? (ctx.ability as EnemyAbility).energyToTarget : 0;
      if (gain > 0 && target.hp > 0) this.addEnergy(target, gain, false);
    }
    this.emit({
      type: 'hit',
      source: actor.uid,
      target: target.uid,
      abilityId: ctx.ability.id,
      attackType,
      element,
      amount: dealt.hp,
      total: result.total,
      crit,
      weakness: isWeak,
      toughnessDamage,
      broke,
      hpAfter: target.hp,
      shieldAbsorbed: dealt.absorbed,
    });
    ctx.hits.push({ target, crit });
    // Entanglement: every hit received adds a stack.
    for (const s of target.statuses) {
      const def = statusDef(this, s.statusId);
      if (def?.cc?.type === 'entanglement') s.stacks = Math.min(def.maxStacks, s.stacks + 1);
    }
    if (target.hp <= 0) {
      this.zeroHp(target, actor, ctx);
    } else if (broke) {
      this.weaknessBreak(actor, target, element, ctx);
    }
    this.checkPhase(target);
  }

  /** Applies damage to shield then HP. Returns the split. */
  private inflict(target: Combatant, total: number): { hp: number; absorbed: number } {
    const absorbed = Math.min(target.shield, total);
    target.shield -= absorbed;
    if (target.shield <= 0) this.endShield(target);
    const hp = Math.min(target.hp, total - absorbed);
    target.hp = Math.max(0, target.hp - (total - absorbed));
    return { hp, absorbed };
  }

  private endShield(target: Combatant): void {
    target.shield = 0;
    const i = target.statuses.findIndex((s) => s.statusId === SHIELD_ID);
    if (i >= 0) target.statuses.splice(i, 1);
  }

  private toughnessProtected(target: Combatant): boolean {
    return target.statuses.some((s) => {
      const p = statusDef(this, s.statusId)?.toughnessProtection;
      if (p === 'always') return true;
      if (p === 'whileSummonsOnField') return this.state.units.some((u) => u.ownerUid === target.uid && isActive(u));
      return false;
    });
  }

  private weaknessBreak(source: Combatant, target: Combatant, element: Element, ctx: ExecCtx | null): void {
    const rules = this.data.rules;
    const be = this.stat(source, 'breakEffect');
    target.broken = true;
    target.toughness = 0;
    const q: StatQuery = { target, attackType: 'break', element };
    const zones = this.defenceZones(target, element, source.level, source, q);
    const base = breakDamageBase(element, source.level, target.maxToughness, be, rules);
    const dmg = computeDamage({ multiplier: base, scalingStat: 1, isCrit: false, critRate: 0, critDmg: 0, dmgBoost: 0, ...zones }, rules).total;
    this.inflict(target, dmg);
    const delay = breakActionDelay(element, be, rules);
    this.shiftAction(target, -delay);
    this.emit({ type: 'weaknessBreak', source: source.uid, target: target.uid, element, damage: dmg, delay });
    const wb = rules.weaknessBreak.elements[element];
    this.applyStatus(source, target, wb.status, { baseChance: rules.weaknessBreak.statusBaseChance, params: { lv: source.level, be } });
    ctx?.broke.push(target);
    if (target.hp <= 0) this.zeroHp(target, source, ctx);
  }

  private dotTick(u: Combatant, s: Combatant['statuses'][number], def: StatusEffect): void {
    const dot = def.dot!;
    const rules = this.data.rules;
    const enemyDef = this.info(u.uid).enemy;
    const elite = u.rank !== null && ELITE_OR_HIGHER.has(u.rank);
    let base: number;
    let boost = 0;
    const lv = s.params.lv ?? s.params._lv ?? u.level;
    if (dot.formula === 'attackerScaled') {
      base = (s.params._base ?? 0) * (dot.perStack ? s.stacks : 1);
      boost = s.params._boost ?? 0;
    } else {
      base = breakDotDamageBase(dot, { attackerLevel: lv, breakEffect: s.params.be ?? 0, targetMaxHp: this.maxHp(u), targetMaxToughness: u.maxToughness, targetIsEliteOrHigher: elite, stacks: s.stacks }, rules);
    }
    const q: StatQuery = { target: u, attackType: 'dot', element: dot.element };
    const zones = this.defenceZones(u, dot.element, lv, null, q);
    const res = computeDamage({ multiplier: base, scalingStat: 1, isCrit: false, critRate: 0, critDmg: 0, dmgBoost: boost, ...zones }, rules).total;
    void enemyDef;
    const dealt = this.inflict(u, res);
    this.emit({ type: 'dot', target: u.uid, statusId: s.statusId, element: dot.element, amount: dealt.hp + dealt.absorbed, hpAfter: u.hp });
    if (u.hp <= 0) this.zeroHp(u, this.state.units.find((x) => x.uid === s.sourceId) ?? null, null);
  }

  // ---- Death, phases, waves ---------------------------------------------------------------------

  private zeroHp(target: Combatant, killer: Combatant | null, ctx: ExecCtx | null): void {
    if (!isActive(target)) return;
    // A boss whose HP bar is depleted continues in its next phase instead of falling.
    if (this.tryPhaseOnZero(target)) return;
    const changed = resolveZeroHp(this.state.units, target.uid);
    this.state.ultimateQueue = this.state.ultimateQueue.filter((q) => q.actorUid !== target.uid);
    this.state.insertedActions = this.state.insertedActions.filter((a) => a.actorUid !== target.uid);
    for (const c of changed) this.emit({ type: 'unitDown', uid: c.uid, by: killer?.uid ?? null });
    if (target.side === 'enemy') {
      this.defeated.push(target);
      if (killer && killer.side === 'ally' && killer.ultimate?.kind === 'energy' && this.data.rules.energy.kill > 0) this.addEnergy(killer, this.data.rules.energy.kill, false);
      ctx?.kills.push(target);
    }
    this.refreshSpeeds();
  }

  private phaseDefs(u: Combatant): readonly NonNullable<UnitInfo['enemy']>['phases'][number][] {
    return this.info(u.uid).enemy?.phases ?? [];
  }

  /** HP-threshold phases (fraction <= threshold). Depleted bars are handled by `tryPhaseOnZero`. */
  private checkPhase(u: Combatant): void {
    if (u.side !== 'enemy' || !isActive(u)) return;
    const phases = this.phaseDefs(u);
    const next = phases[u.phase + 1];
    if (next && next.hpThreshold > 0 && u.hp / this.maxHp(u) <= next.hpThreshold) this.enterPhase(u, u.phase + 1);
  }

  private tryPhaseOnZero(u: Combatant): boolean {
    if (u.side !== 'enemy') return false;
    const next = this.phaseDefs(u)[u.phase + 1];
    if (!next || next.hpThreshold !== 0) return false;
    this.enterPhase(u, u.phase + 1);
    return true;
  }

  private enterPhase(u: Combatant, index: number): void {
    const def = this.phaseDefs(u)[index];
    if (!def) return;
    u.phase = index;
    if (def.restoreHpTo !== undefined) u.hp = this.maxHp(u) * def.restoreHpTo;
    if (def.toughness !== undefined) {
      u.maxToughness = def.toughness;
      u.toughness = def.toughness;
      u.broken = false;
    }
    if (def.weaknesses) u.weaknesses = [...def.weaknesses];
    this.emit({ type: 'phaseChanged', uid: u.uid, phase: index });
    const ctx = this.newCtx(u, this.phaseAbility(u, index), null);
    for (const eff of def.onEnter) this.runEffect(ctx, eff);
    const info = this.info(u.uid);
    info.charging = null;
  }

  /** Runs the first phase's `onEnter` effects (a boss starts Weakness Protected) for enemies that have not yet. */
  private enterInitialPhases(): void {
    for (const u of this.state.units) {
      if (u.side !== 'enemy' || !isActive(u) || this.initialised.has(u.uid)) continue;
      this.initialised.add(u.uid);
      const first = this.phaseDefs(u)[0];
      if (!first || first.onEnter.length === 0) continue;
      const ctx = this.newCtx(u, this.phaseAbility(u, 0), null);
      for (const eff of first.onEnter) this.runEffect(ctx, eff);
    }
  }

  private phaseAbility(u: Combatant, index: number): EnemyAbility {
    return { id: `${u.defId}.phase-${index + 1}`, name: 'phase', kind: 'enemy', tags: [], targeting: 'none', maxLevel: 1, params: {}, description: 'phase', spCost: 0, spGain: 0, energyGain: 0, techniquePointCost: 0, keepsTurn: false, effects: [], triggers: [], modifiers: [], energyToTarget: 0, aiWeight: 0, cooldown: 0, chargeTurns: 0 };
  }

  private afterAction(): void {
    this.checkEnd();
  }

  private checkEnd(): void {
    if (this.state.outcome !== 'ongoing') return;
    if (!this.state.units.some((u) => u.side === 'ally' && isActive(u))) {
      this.finish('defeat');
      return;
    }
    if (this.state.units.some((u) => u.side === 'enemy' && isActive(u))) return;
    if (this.state.wave < this.state.waveCount) {
      this.state.wave++;
      this.spawnWave(this.state.wave);
      const enemies = this.state.units.filter((u) => u.side === 'enemy' && isActive(u));
      this.emit({ type: 'waveStarted', wave: this.state.wave, waveCount: this.state.waveCount, enemies: enemies.map((u) => u.uid) });
      this.enterInitialPhases();
      this.fire('waveStart', {});
      return;
    }
    this.finish('victory');
  }

  private finish(outcome: 'victory' | 'defeat'): void {
    this.state.outcome = outcome;
    this.awaitingUid = null;
    this.state.activeUid = null;
    this.state.ultimateQueue = [];
    this.state.insertedActions = [];
    this.rewards = outcome === 'victory' ? rollRewards(this.data, this.rng, this.defeated) : [];
    this.emit({ type: 'ended', outcome, cycles: this.state.cycle, turns: this.turns });
  }

  /** The result once the battle ended. */
  result(): BattleResult {
    if (this.state.outcome === 'ongoing') throw new BattleError('the battle is still running');
    return {
      outcome: this.state.outcome === 'victory' ? 'victory' : 'defeat',
      cycles: this.state.cycle,
      turns: this.turns,
      seed: this.seed,
      advantage: this.advantage,
      defeated: this.defeated.map((u) => ({ uid: u.uid, defId: u.defId })),
      rewards: this.rewards,
    };
  }

  // ---- Heal, shield, energy, action value -------------------------------------------------------

  private runHeal(ctx: ExecCtx, e: Extract<Effect, { kind: 'heal' }>): void {
    if (e.repeats) this.stub('effect heal.repeats', `${ctx.ability.id} (5B)`);
    const amount0 = this.val(ctx, e.multiplier) * this.stat(ctx.actor, e.stat) + (e.flat ? this.val(ctx, e.flat) : 0);
    for (const t of this.effectTargets(ctx, e.target)) {
      const amount = amount0 * (1 + this.stat(ctx.actor, 'outgoingHealing')) * (1 + this.stat(t, 'incomingHealing'));
      const before = t.hp;
      t.hp = Math.min(this.maxHp(t), t.hp + amount);
      this.emit({ type: 'heal', source: ctx.actor.uid, target: t.uid, amount: t.hp - before, hpAfter: t.hp });
    }
  }

  private runShield(ctx: ExecCtx, e: Extract<Effect, { kind: 'shield' }>): void {
    const amount = (this.val(ctx, e.multiplier) * this.stat(ctx.actor, e.stat) + (e.flat ? this.val(ctx, e.flat) : 0)) * (1 + this.stat(ctx.actor, 'shieldBonus'));
    const turns = Math.round(this.val(ctx, e.duration));
    for (const t of this.effectTargets(ctx, e.target)) {
      t.shield = Math.max(t.shield, amount);
      const cur = t.statuses.find((s) => s.statusId === SHIELD_ID);
      if (cur) {
        cur.turnsLeft = turns;
        (cur as { sourceId: string }).sourceId = ctx.actor.uid;
      } else t.statuses.push({ statusId: SHIELD_ID, sourceId: ctx.actor.uid, stacks: 1, turnsLeft: turns, params: {} });
      this.emit({ type: 'shield', source: ctx.actor.uid, target: t.uid, amount: t.shield });
    }
  }

  addEnergy(u: Combatant, base: number, fixed: boolean): void {
    const g = u.ultimate;
    if (!g || g.kind !== 'energy') return;
    const before = g.current;
    g.current = regenerateEnergy(g.current, g.max, base, this.stat(u, 'energyRegen'), fixed);
    if (g.current !== before) this.emit({ type: 'energy', uid: u.uid, current: g.current, max: g.max, delta: g.current - before });
  }

  /** Action Advance (positive fraction) or Delay (negative) of the unit's base AV. */
  shiftAction(u: Combatant, fraction: number): void {
    if (!isActive(u)) return;
    u.actionValue = shiftAction(u.actionValue, this.spd(u), fraction, this.data.rules);
    this.emit({ type: 'actionShift', uid: u.uid, fraction, av: u.actionValue });
  }

  /** SPD changes rescale remaining AV so the distance to the next turn is kept. */
  private refreshSpeeds(): void {
    for (const u of this.state.units) {
      const now = this.spd(u);
      const before = this.spdCache.get(u.uid) ?? now;
      if (Math.abs(now - before) > 1e-9) {
        if (isActive(u)) u.actionValue = rescaleForSpeedChange(u.actionValue, before, now);
        this.emit({ type: 'speedChanged', uid: u.uid, spd: now });
      }
      this.spdCache.set(u.uid, now);
    }
  }

  // ---- Statuses ---------------------------------------------------------------------------------

  private debuffResKey(def: StatusEffect): 'burn' | 'shock' | 'bleed' | 'windShear' | NonNullable<StatusEffect['cc']>['type'] | null {
    if (def.cc) return def.cc.type;
    if (def.dot) return DOT_RES_KEY[def.dot.element] ?? null;
    return null;
  }

  /** Applies a status; debuffs roll the real effect-hit chance. Returns whether it landed. */
  applyStatus(source: Combatant, target: Combatant, statusId: string, o: { baseChance?: number; fixed?: boolean; duration?: number; stacks?: number; params?: Record<string, number> }): boolean {
    if (!isActive(target)) return false;
    const def = this.data.status(statusId);
    if (def.kind === 'debuff' && o.baseChance !== undefined) {
      const enemy = this.info(target.uid).enemy;
      const key = this.debuffResKey(def);
      const debuffRes = (key && enemy ? (enemy.debuffRes as Record<string, number | undefined>)[key] : undefined) ?? 0;
      const chance = debuffApplyChance(o.baseChance, this.stat(source, 'effectHitRate'), this.stat(target, 'effectRes'), debuffRes + this.stat(target, 'debuffRes'), this.data.rules, o.fixed === true);
      if (!this.rng.chance(chance)) {
        this.emit({ type: 'statusResisted', source: source.uid, target: target.uid, statusId, chance });
        return false;
      }
    }
    if (def.script) this.stub(`status script ${def.script}`, `${statusId} has behaviour that needs its script handler (5B)`);
    const elite = target.rank !== null && ELITE_OR_HIGHER.has(target.rank);
    const n = o.stacks ?? (def.initialStacks ? (elite ? def.initialStacks.elite : def.initialStacks.normal) : 1);
    const turns = o.duration ?? def.duration.turns;
    const params: Record<string, number> = { ...(o.params ?? {}) };
    if (def.dot?.formula === 'attackerScaled') {
      const m = def.dot.multiplier;
      const mult = typeof m === 'number' ? m : m && 'param' in m ? (params[m.param] ?? 0) : 0;
      params._base = mult * this.stat(source, def.dot.stat ?? 'atk');
      params._lv = source.level;
      params._boost = this.stat(source, ELEMENT_DMG_STAT[def.dot.element]) + this.stat(source, 'allDmg') + (def.dot.damageType === 'dot' ? this.stat(source, 'dotDmg') : 0);
    }
    const existing = target.statuses.find((s) => s.statusId === statusId);
    if (existing) {
      existing.stacks = Math.min(def.maxStacks, existing.stacks + n);
      existing.turnsLeft = turns;
      Object.assign(existing.params, params);
      (existing as { sourceId: string }).sourceId = source.uid;
    } else {
      target.statuses.push({ statusId, sourceId: source.uid, stacks: Math.min(def.maxStacks, n), turnsLeft: turns, params });
    }
    const landed = target.statuses.find((s) => s.statusId === statusId)!;
    // Rescale for any SPD change first, then delay by a fraction of the (new) base AV.
    this.refreshSpeeds();
    const delay = def.cc?.delayOnApply;
    if (delay !== undefined) {
      const d = typeof delay === 'number' ? delay : 'param' in delay ? (landed.params[delay.param] ?? 0) : 0;
      if (d > 0) this.shiftAction(target, -d);
    }
    this.emit({ type: 'statusApplied', source: source.uid, target: target.uid, statusId, stacks: landed.stacks, turns });
    this.refreshSpeeds();
    return true;
  }

  removeStatus(u: Combatant, statusId: string): void {
    const before = u.statuses.length;
    u.statuses = u.statuses.filter((s) => s.statusId !== statusId);
    if (u.statuses.length !== before) {
      if (statusId === SHIELD_ID) u.shield = 0;
      this.emit({ type: 'statusExpired', target: u.uid, statusId });
      this.refreshSpeeds();
    }
  }

  private dispel(u: Combatant, kind: 'buff' | 'debuff', count: number, ccOnly: boolean): void {
    let left = count;
    for (const s of [...u.statuses]) {
      if (left <= 0) break;
      const def = statusDef(this, s.statusId);
      if (!def || def.kind !== kind || !def.dispellable || (ccOnly && def.category !== 'cc')) continue;
      this.removeStatus(u, s.statusId);
      left--;
    }
  }

  private expire(u: Combatant, s: Combatant['statuses'][number]): void {
    const def = statusDef(this, s.statusId);
    u.statuses = u.statuses.filter((x) => x !== s);
    if (s.statusId === SHIELD_ID) {
      u.shield = 0;
    }
    if (def?.dot && def.dot.tickOn === 'onExpire') this.dotTick(u, s, def);
    if (def?.cc?.delayOnExpire) this.shiftAction(u, -def.cc.delayOnExpire);
    if (def?.cc?.advanceOnExpire) this.shiftAction(u, def.cc.advanceOnExpire);
    this.emit({ type: 'statusExpired', target: u.uid, statusId: s.statusId });
    this.refreshSpeeds();
  }

  /** Counts a duration down; the status ends at 0 (turns 0 means "until removed"). */
  private tickOne(u: Combatant, s: Combatant['statuses'][number]): void {
    if (s.turnsLeft <= 0) return;
    s.turnsLeft--;
    if (s.turnsLeft <= 0) this.expire(u, s);
  }

  private tickDurations(u: Combatant, when: 'ownerTurnStart' | 'ownerTurnEnd'): void {
    for (const s of [...u.statuses]) {
      if (s.statusId === SHIELD_ID) continue;
      const def = statusDef(this, s.statusId);
      if (def?.duration.tickOn === when) this.tickOne(u, s);
    }
  }

  private tickCasterDurations(caster: Combatant, when: 'casterTurnStart' | 'casterTurnEnd'): void {
    for (const u of [...this.state.units]) {
      for (const s of [...u.statuses]) {
        if (s.sourceId !== caster.uid) continue;
        if (s.statusId === SHIELD_ID) {
          if (when === 'casterTurnStart') this.tickOne(u, s);
          continue;
        }
        if (statusDef(this, s.statusId)?.duration.tickOn === when) this.tickOne(u, s);
      }
    }
  }

  // ---- Enemy turns ------------------------------------------------------------------------------

  private runEnemyTurn(u: Combatant): void {
    const info = this.info(u.uid);
    const enemy = info.enemy!;
    let ability: EnemyAbility | undefined;
    if (info.charging) {
      info.charging.turnsLeft--;
      if (info.charging.turnsLeft > 0) {
        this.emit({ type: 'charging', uid: u.uid, abilityId: info.charging.abilityId, turns: info.charging.turnsLeft });
        return;
      }
      ability = enemy.abilities.find((a) => a.id === info.charging!.abilityId);
      info.charging = null;
    } else {
      ability = this.chooseEnemyAbility(u, info);
      if (ability && ability.chargeTurns > 0) {
        info.charging = { abilityId: ability.id, turnsLeft: ability.chargeTurns };
        this.emit({ type: 'charging', uid: u.uid, abilityId: ability.id, turns: ability.chargeTurns });
        return;
      }
    }
    if (!ability) return;
    if (ability.cooldown > 0) info.cooldowns[ability.id] = ability.cooldown;
    let selected: Combatant | null;
    switch (ability.targeting) {
      case 'enemySingle':
      case 'enemyBlast':
      case 'enemyBounce':
        selected = pickEnemyTarget(this, u);
        break;
      case 'allySingle': {
        const pool = alliesOf(this, u);
        selected = pool.length ? this.rng.pick(pool) : null;
        break;
      }
      case 'self':
        selected = u;
        break;
      default:
        selected = null;
    }
    this.executeAbility(u, ability, selected, 'enemy');
  }

  /** Data-driven skill selection: weighted random (or the data's sequence) over the phase's abilities. */
  private chooseEnemyAbility(u: Combatant, info: UnitInfo): EnemyAbility | undefined {
    const enemy = info.enemy!;
    const phase = enemy.phases[u.phase];
    const ids = phase ? new Set(phase.abilities) : null;
    const pool = enemy.abilities.filter((a) => (!ids || ids.has(a.id)) && (info.cooldowns[a.id] ?? 0) <= 0 && this.abilityPlayable(a));
    if (pool.length === 0) return undefined;
    if (enemy.ai.pattern === 'sequence' && enemy.ai.sequence?.length) {
      for (let tries = 0; tries < enemy.ai.sequence.length; tries++) {
        const id = enemy.ai.sequence[info.sequenceIndex++ % enemy.ai.sequence.length];
        const a = pool.find((x) => x.id === id);
        if (a) return a;
      }
    }
    if (enemy.ai.pattern === 'script') this.stub('enemy ai', `${enemy.id} uses a scripted AI; weighted selection is used instead (5B)`);
    return this.rng.weighted(pool, (a) => a.aiWeight) ?? undefined;
  }

  /** An ability is playable if it has at least one implemented effect (otherwise the AI skips it and says so). */
  private abilityPlayable(a: EnemyAbility): boolean {
    if (a.effects.length === 0) return false;
    const ok = a.effects.some((e) => IMPLEMENTED_EFFECT_KINDS.has(e.kind));
    if (!ok) this.stub('enemy ability', `${a.id} only has stubbed effects (${a.effects.map((e) => (e.kind === 'script' ? e.handler : e.kind)).join(', ')}); the AI skips it (5B)`);
    return ok;
  }

  // ---- Triggers ---------------------------------------------------------------------------------

  private triggerSources(u: Combatant): Array<{ trigger: Trigger; ability: AnyAbility | null; params: Record<string, readonly number[]>; key: string; level: number }> {
    const info = this.info(u.uid);
    const out: Array<{ trigger: Trigger; ability: AnyAbility | null; params: Record<string, readonly number[]>; key: string; level: number }> = [];
    const ch = info.character;
    if (ch) {
      ch.abilities.talent.triggers.forEach((t, i) => out.push({ trigger: t, ability: ch.abilities.talent, params: ch.abilities.talent.params, key: `talent#${i}`, level: u.abilityLevels.talent ?? 1 }));
    }
    info.passiveTriggers.forEach((t, i) => out.push({ trigger: t, ability: null, params: {}, key: `passive#${i}`, level: 1 }));
    for (const s of u.statuses) {
      const def = statusDef(this, s.statusId);
      def?.triggers.forEach((t, i) => out.push({ trigger: t, ability: null, params: Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, [v]])), key: `status:${s.statusId}#${i}`, level: 1 }));
    }
    return out;
  }

  private ownerMatches(event: TriggerEvent, owner: Combatant, t: TriggerCtx): boolean {
    const { actor, subject } = t;
    switch (event) {
      case 'battleStart':
      case 'waveStart':
        return true;
      case 'turnStart':
      case 'turnEnd':
      case 'afterAttack':
      case 'afterUseBasic':
      case 'afterUseSkill':
      case 'afterUseUltimate':
      case 'onKill':
      case 'onWeaknessBreak':
      case 'onFollowUp':
        return owner === actor;
      case 'afterBeingHit':
        return owner === subject;
      case 'afterAllyHit':
        return !!subject && owner !== subject && owner.side === subject.side;
      case 'afterAllyAttack':
      case 'afterAllyUsesUltimate':
        return !!actor && owner !== actor && owner.side === actor.side;
      case 'afterAllyWeaknessBreak':
        return !!actor && owner.side === actor.side;
      case 'onTargetedByAlly':
        return owner === subject;
      case 'onEnemyDefeated':
        return !!subject && owner.side !== subject.side;
      default:
        return false;
    }
  }

  /** Fires every matching trigger of every unit on the field. */
  private fire(event: TriggerEvent, t: TriggerCtx): void {
    for (const owner of [...this.state.units]) {
      if (!isActive(owner)) continue;
      for (const src of this.triggerSources(owner)) {
        if (src.trigger.on !== event) continue;
        if (!this.ownerMatches(event, owner, t)) continue;
        const ability = src.ability ?? this.pseudoAbility(owner, src);
        this.runTrigger(owner, src.trigger, ability, t, src.key, src);
      }
    }
  }

  private pseudoAbility(owner: Combatant, src: { params: Record<string, readonly number[]>; key: string }): AnyAbility {
    return { id: `${owner.defId}.${src.key}`, name: src.key, kind: 'talent', tags: [], targeting: 'none', maxLevel: 1, params: Object.fromEntries(Object.entries(src.params).map(([k, v]) => [k, [...v]])), description: src.key, spCost: 0, spGain: 0, energyGain: 0, techniquePointCost: 0, keepsTurn: false, effects: [], triggers: [], modifiers: [] };
  }

  private runTrigger(owner: Combatant, trig: Trigger, ability: AnyAbility, t: TriggerCtx, key: string, src?: { level: number; params: Record<string, readonly number[]> }): void {
    const info = this.info(owner.uid);
    const full = `${key}:${trig.on}`;
    if (trig.limitPerTurn && (info.perTurn[full] ?? 0) >= trig.limitPerTurn) return;
    if (trig.limitPerBattle && (info.perBattle[full] ?? 0) >= trig.limitPerBattle) return;
    if ((info.triggerCooldown[full] ?? 0) > 0) return;
    const q: StatQuery = { target: t.subject ?? null, attackType: t.attackType ?? null, element: t.element ?? null, allowRandom: true };
    if (trig.conditions && !trig.conditions.every((c) => evalCondition(this, c, owner, q))) return;
    info.perTurn[full] = (info.perTurn[full] ?? 0) + 1;
    info.perBattle[full] = (info.perBattle[full] ?? 0) + 1;
    if (trig.cooldown) info.triggerCooldown[full] = trig.cooldown;
    const level = src?.level ?? this.levelOf(info, owner, ability);
    const ctx: ExecCtx = {
      actor: owner,
      ability,
      params: src?.params ?? ability.params,
      level,
      attackType: t.attackType ?? this.attackTypeOf(info, ability),
      selected: t.subject ?? null,
      attacker: t.actor ?? null,
      hits: [],
      lastCrit: false,
      broke: [],
      kills: [],
    };
    for (const e of trig.effects) this.runEffect(ctx, e);
    if (ctx.hits.length > 0 || ctx.kills.length > 0 || ctx.broke.length > 0) this.afterTriggerHits(ctx);
  }

  /** Damage dealt by a trigger (a talent's extra hit) can kill or break like any other attack. */
  private afterTriggerHits(ctx: ExecCtx): void {
    for (const k of ctx.kills) this.fire('onKill', { actor: ctx.actor, subject: k });
    for (const k of ctx.broke) this.fire('afterAllyWeaknessBreak', { actor: ctx.actor, subject: k });
  }
}

const DISPATCHED: ReadonlySet<string> = new Set(DISPATCHED_TRIGGER_EVENTS);

export type { TurnKind };
