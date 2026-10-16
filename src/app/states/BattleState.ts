import type { GameState } from '@core/state/StateManager';
import type { RenderView } from '@core/render/RenderService';
import { Collections } from '@models/collections';
import type { Element as GameElement } from '@models/common';
import type { BattleStage } from '@models/battle';
import type { CameraRules, CameraShot } from '@models/camera';
import type { Advantage } from '@models/world';
import { Battle, combatDataFrom, describeEvent, type BattleEvent, type BattleResult, type CombatData, type PartyMemberSpec } from '@modules/combat';
import { CameraDirector, PoseProvider, type CameraPose } from '@modules/camera';
import { BattleHud, type HudUnit } from '@modules/ui';
import { BattleScene } from '../scenes/BattleScene';
import type { ActorSpec } from '../scenes/BattleActor';
import type { AppContext } from '../AppContext';
import { StateIds } from '../AppContext';

/** Everything a battle needs; built by the overworld (an encounter) or by the Battle Sandbox. */
export interface BattleParams {
  readonly source: 'world' | 'sandbox';
  readonly party: readonly PartyMemberSpec[];
  readonly waves: readonly (readonly string[])[];
  readonly enemyLevel: number;
  readonly seed: number;
  readonly advantage: Advantage;
  /** Character ids whose Technique was cast before the battle. */
  readonly techniques: readonly string[];
  /** Text of the button on the result screen ("Return to exploration"). */
  readonly leaveLabel: string;
  /** Called with the result when the player leaves the result screen (before the state pops). */
  readonly onFinished?: (result: BattleResult) => void;
}

type Choice = { kind: 'basic' | 'skill' } | { kind: 'ultimate'; uid: string };

/**
 * The battle scene. It builds the engine `Battle` from `BattleParams`, then plays the engine's
 * event stream: each `step()` is followed by a paced playback (lunges, hit flashes, damage numbers,
 * camera shots) driven by `rules/combat` stage data, and the HUD shows exactly the values of the
 * event being played. The player acts through Q / E / 1-4 / A D (or the HUD buttons); Ultimates can
 * be queued at any moment, including between enemy actions.
 */
export class BattleState implements GameState<BattleParams> {
  readonly id = StateIds.battle;
  private params!: BattleParams;
  private battle!: Battle;
  private scene: BattleScene | null = null;
  private view: RenderView | null = null;
  private hud: BattleHud | null = null;
  private director: CameraDirector | null = null;
  private unmount: (() => void) | null = null;
  private stage!: BattleStage;
  private cameraRules!: CameraRules;
  private shots = new Map<string, CameraShot>();
  private combatData!: CombatData;
  private speed = 1;
  private disposed = false;
  private readonly queue: BattleEvent[] = [];
  private readonly hp = new Map<string, number>();
  private readonly toughness = new Map<string, number>();
  private readonly elementColor = new Map<GameElement, string>();
  private accepting: ((c: Choice) => void) | null = null;
  private readonly queuedUlts: string[] = [];
  private selectedEnemy: string | null = null;
  private selectedAlly: string | null = null;
  private leave: (() => void) | null = null;
  private busy = true;
  private result: BattleResult | null = null;
  private pendingAnim: Promise<unknown> = Promise.resolve();
  private lastLog: string[] = [];

  constructor(private readonly ctx: AppContext) {}

  // ---- Lifecycle --------------------------------------------------------------------------------

  enter(params: BattleParams): void {
    this.params = params;
    const { data, config, render, ui } = this.ctx;
    this.combatData = combatDataFrom(data);
    this.stage = data.get(Collections.battleStage, 'default');
    this.cameraRules = data.get(Collections.cameraRules, 'default');
    this.shots = new Map(data.all(Collections.cameraShots).map((s) => [s.id, s]));
    for (const e of data.all(Collections.elements)) this.elementColor.set(e.element, e.color);
    this.speed = config.get().combat.animationSpeed;

    this.battle = new Battle({ data: this.combatData, party: params.party, waves: params.waves, enemyLevel: params.enemyLevel, seed: params.seed, advantage: params.advantage, techniques: params.techniques, id: `${params.source}-${params.seed}` });
    this.battle.subscribe((e) => this.queue.push(e));

    const anim = data.get(Collections.locomotionRules, 'default').animation;
    this.scene = new BattleScene(this.stage, anim, Math.round(config.get().graphics.starCount * 0.5), this.stage.camera.fov);
    this.view = render.createView(this.scene.scene, this.scene.camera, { bloom: true, bloomRadius: 0.45, bloomThreshold: 0.6, bloomStrength: 0.5 });
    this.director = new CameraDirector(this.cameraRules, () => config.get().camera.shakeIntensity);
    this.director.push(new PoseProvider('battle-overview', 'combat', this.cameraRules.priorities.combat ?? 10, () => this.scene!.overview(), true));

    this.hud = new BattleHud(
      {
        action: (slot) => this.choose({ kind: slot }),
        ultimate: (uid) => this.requestUltimate(uid),
        target: (uid) => this.pickTarget(uid),
        leave: () => this.leave?.(),
        retry: () => this.retry(),
      },
      (id) => this.statusName(id),
    );
    this.hud.setFloatSeconds(this.stage.timing.floatSeconds / this.speed);
    this.unmount = ui.mount(this.hud.el);
    this.buildRoster();
    this.hud.setCycle(1, 1, this.battle.state.waveCount);
    if (window.__ASTRAL__) window.__ASTRAL__.probes.battle = () => this.probe();
    void this.run();
  }

  exit(): void {
    this.disposed = true;
    this.accepting = null;
    this.leave = null;
    this.unmount?.();
    this.hud?.dispose();
    this.view?.dispose();
    this.scene?.dispose();
    if (window.__ASTRAL__) delete window.__ASTRAL__.probes.battle;
    this.scene = null;
    this.view = null;
    this.hud = null;
    this.director = null;
  }

  pause(): void {
    this.hud?.el.classList.add('is-hidden');
  }

  resume(): void {
    this.hud?.el.classList.remove('is-hidden');
  }

  // ---- Scene setup ------------------------------------------------------------------------------

  private statusName(id: string): string {
    if (id === 'builtin.shield') return 'Shield';
    try {
      return this.combatData.status(id).name;
    } catch {
      return id;
    }
  }

  private unitLabel(uid: string): string {
    return this.battle.nameOf(uid);
  }

  private color(el: GameElement | null | undefined): string {
    return (el && this.elementColor.get(el)) ?? '#ffffff';
  }

  private actorSpec(uid: string): ActorSpec {
    const u = this.battle.unit(uid);
    const info = this.battle.info(uid);
    if (u.side === 'ally') return { uid, side: 'ally', name: this.unitLabel(uid), color: this.color(u.element), scale: 1 };
    const rank = u.rank ?? 'normal';
    const scale = rank === 'normal' || rank === 'event' ? this.stage.enemyScale.normal : rank === 'elite' ? this.stage.enemyScale.elite : this.stage.enemyScale.boss;
    return { uid, side: 'enemy', name: this.unitLabel(uid), color: this.color(info.enemy?.weaknesses[0]), scale };
  }

  private hudUnit(uid: string, slot?: number): HudUnit {
    const u = this.battle.unit(uid);
    const spec = this.actorSpec(uid);
    return {
      uid,
      name: spec.name,
      side: u.side,
      color: spec.color,
      element: u.element ?? undefined,
      hp: u.hp,
      maxHp: this.battle.maxHp(u),
      energy: u.ultimate?.kind === 'energy' ? { current: u.ultimate.current, max: u.ultimate.max } : undefined,
      weaknesses: u.side === 'enemy' ? u.weaknesses : undefined,
      toughness: u.toughness,
      maxToughness: u.maxToughness,
      slot,
      rank: u.rank ?? undefined,
    };
  }

  private buildRoster(): void {
    const allies = this.battle.units.filter((u) => u.side === 'ally');
    const enemies = this.battle.units.filter((u) => u.side === 'enemy');
    this.scene!.setAllies(allies.map((u) => this.actorSpec(u.uid)));
    this.scene!.setEnemies(enemies.map((u) => this.actorSpec(u.uid)));
    for (const u of this.battle.units) {
      this.hp.set(u.uid, u.hp);
      this.toughness.set(u.uid, u.toughness);
    }
    this.hud!.setRoster([...allies.map((u, i) => this.hudUnit(u.uid, i + 1)), ...enemies.map((u) => this.hudUnit(u.uid))]);
    this.normaliseSelection();
    this.hud!.setSp(this.battle.state.skillPoints.current, this.battle.state.skillPoints.max);
    this.refreshTurnOrder();
  }

  // ---- The loop ---------------------------------------------------------------------------------

  private sleep(seconds: number): Promise<void> {
    return new Promise((r) => setTimeout(r, Math.max(0, (seconds * 1000) / this.speed)));
  }

  private async run(): Promise<void> {
    try {
      this.battle.start();
      await this.playPending();
      while (!this.disposed && this.battle.outcome === 'ongoing') {
        for (const uid of this.queuedUlts.splice(0)) this.tryQueueUltimate(uid);
        const r = this.battle.step();
        await this.playPending();
        if (r.kind === 'awaiting') await this.playerTurn(r.uid);
        else if (r.kind === 'ended') break;
        else await this.sleep(this.stage.timing.turnGap);
      }
      if (!this.disposed) await this.finish();
    } catch (error) {
      this.ctx.logger.error('battle loop failed', error);
      throw error;
    }
  }

  private tryQueueUltimate(uid: string): void {
    const u = this.battle.unit(uid);
    if (!this.battle.canUltimate(u)) return;
    const target = this.defaultTarget(uid, 'ultimate');
    this.battle.queueUltimate(uid, target);
  }

  private async playerTurn(uid: string): Promise<void> {
    for (;;) {
      this.busy = false;
      this.refreshActions(uid);
      const choice = await new Promise<Choice>((resolve) => {
        this.accepting = resolve;
      });
      this.accepting = null;
      this.busy = true;
      this.hud!.setActions(null, null, '');
      if (this.disposed) return;
      if (choice.kind === 'ultimate') {
        if (this.battle.canUltimate(this.battle.unit(choice.uid))) {
          this.battle.queueUltimate(choice.uid, this.defaultTarget(choice.uid, 'ultimate'));
          this.battle.step();
          await this.playPending();
        }
        if (this.battle.outcome !== 'ongoing') return;
        continue;
      }
      this.battle.submit({ type: choice.kind, actor: uid, target: this.defaultTarget(uid, choice.kind) });
      await this.playPending();
      return;
    }
  }

  private choose(c: Choice): void {
    if (!this.accepting) return;
    if (c.kind === 'basic' || c.kind === 'skill') {
      const uid = this.battle.awaiting;
      if (!uid || !this.battle.canUse(uid, c.kind).ok) return;
    }
    this.accepting(c);
  }

  private requestUltimate(uid: string): void {
    const u = this.battle.units.find((x) => x.uid === uid);
    if (!u || u.side !== 'ally' || !this.battle.canUltimate(u)) return;
    if (this.accepting) this.accepting({ kind: 'ultimate', uid });
    else if (!this.queuedUlts.includes(uid)) {
      this.queuedUlts.push(uid);
      this.hud?.float(uid, 'Ultimate queued', 'text');
    }
  }

  private async finish(): Promise<void> {
    const result = this.battle.result();
    this.result = result;
    const items = this.ctx.data;
    this.hud!.setActions(null, null, '');
    await this.sleep(0.5);
    this.hud!.showResult({
      outcome: result.outcome,
      cycles: result.cycles,
      turns: result.turns,
      defeated: result.defeated.map((d) => this.combatData.enemy(d.defId).name),
      rewards: result.rewards.map((r) => ({ name: items.get(Collections.items, r.item).name, count: r.count })),
      leaveLabel: this.params.leaveLabel,
      canRetry: result.outcome === 'defeat',
    });
    this.busy = false;
    await new Promise<void>((resolve) => {
      this.leave = resolve;
    });
    if (this.disposed) return;
    this.params.onFinished?.(result);
    await this.ctx.states.pop({ transition: true });
  }

  private retry(): void {
    if (this.ctx.states.busy || !this.result) return;
    const next: BattleParams = { ...this.params, seed: this.params.seed + 1 };
    void this.ctx.states.replace(StateIds.battle, next, { transition: true });
  }

  // ---- Targets and actions ----------------------------------------------------------------------

  private liveEnemies(): string[] {
    return this.battle.units.filter((u) => u.side === 'enemy' && u.presence === 'active').map((u) => u.uid);
  }

  private normaliseSelection(): void {
    const enemies = this.liveEnemies();
    if (!this.selectedEnemy || !enemies.includes(this.selectedEnemy)) this.selectedEnemy = enemies[0] ?? null;
    this.hud?.setSelected(this.selectedEnemy);
  }

  /** A/D: cycle the highlighted enemy. */
  private cycleTarget(delta: number): void {
    const enemies = this.liveEnemies();
    if (enemies.length === 0) return;
    const i = Math.max(0, enemies.indexOf(this.selectedEnemy ?? ''));
    this.selectedEnemy = enemies[(i + delta + enemies.length) % enemies.length] ?? null;
    this.hud?.setSelected(this.selectedEnemy);
    this.refreshActions(this.battle.awaiting);
  }

  /** A click on an enemy plate or a party card. */
  private pickTarget(uid: string): void {
    const u = this.battle.units.find((x) => x.uid === uid);
    if (!u || u.presence !== 'active') return;
    if (u.side === 'enemy') this.selectedEnemy = uid;
    else this.selectedAlly = uid;
    this.hud?.setSelected(uid);
    this.refreshActions(this.battle.awaiting);
  }

  /** The unit an action is aimed at: the highlighted enemy, or the chosen ally for ally-targeted abilities. */
  private defaultTarget(actor: string, slot: 'basic' | 'skill' | 'ultimate'): string {
    this.normaliseSelection();
    const options = this.battle.selectableTargets(actor, slot);
    if (options.length === 0) return actor;
    if (options[0]!.side === 'enemy') return options.some((o) => o.uid === this.selectedEnemy) ? this.selectedEnemy! : options[0]!.uid;
    return options.some((o) => o.uid === this.selectedAlly) ? this.selectedAlly! : actor;
  }

  private refreshActions(uid: string | null): void {
    if (!uid || !this.hud || this.battle.awaiting !== uid) return;
    const ch = this.battle.info(uid).character!;
    const basic = this.battle.canUse(uid, 'basic');
    const skill = this.battle.canUse(uid, 'skill');
    const target = this.defaultTarget(uid, 'basic');
    this.hud.setActions(
      { name: ch.abilities.basic.name, enabled: basic.ok, hint: `+${ch.abilities.basic.spGain} Skill Point` },
      { name: ch.abilities.skill.name, enabled: skill.ok, hint: skill.ok ? `-${ch.abilities.skill.spCost} Skill Point` : (skill.reason ?? '') },
      `${this.unitLabel(uid)}'s turn${this.liveEnemies().length > 1 ? ` · target: ${this.unitLabel(target)}` : ''}`,
    );
    this.refreshTurnOrder();
  }

  private refreshTurnOrder(): void {
    if (!this.hud || this.battle.outcome !== 'ongoing') return;
    const order = this.battle.turnOrder(this.stage.turnOrderCount);
    const current = this.battle.state.activeUid ?? this.battle.awaiting;
    const entries = order.map((o) => ({ uid: o.uid, name: this.unitLabel(o.uid), color: this.actorSpecColor(o.uid), side: this.battle.unit(o.uid).side }));
    if (current && !(entries[0]?.uid === current)) {
      const u = this.battle.unit(current);
      entries.unshift({ uid: current, name: this.unitLabel(current), color: this.actorSpecColor(current), side: u.side });
      entries.length = Math.min(entries.length, this.stage.turnOrderCount);
    }
    this.hud.setTurnOrder(entries, current);
    this.hud.setActive(current);
  }

  private actorSpecColor(uid: string): string {
    return this.scene?.actors.get(uid)?.spec.color ?? '#ffffff';
  }

  // ---- Playback of the engine's events ----------------------------------------------------------

  private async playPending(): Promise<void> {
    while (this.queue.length > 0 && !this.disposed) await this.play(this.queue.shift()!);
    await this.pendingAnim;
    this.refreshTurnOrder();
    this.normaliseSelection();
  }

  private syncStatuses(uid: string): void {
    const u = this.battle.units.find((x) => x.uid === uid);
    if (u) this.hud?.setStatuses(uid, u.statuses.map((s) => s.statusId));
  }

  private shotFor(e: Extract<BattleEvent, { type: 'action' }>): string | null {
    const u = this.battle.unit(e.uid);
    if (u.side === 'enemy') return this.stage.shots.enemy;
    if (e.slot === 'ultimate') return this.stage.shots.ultimate;
    if (e.slot === 'skill') return this.stage.shots.skill;
    return null;
  }

  private async play(e: BattleEvent): Promise<void> {
    const hud = this.hud!;
    const scene = this.scene!;
    const t = this.stage.timing;
    const text = describeEvent(e, (uid) => this.unitLabel(uid));
    if (text) {
      hud.log(text);
      this.lastLog.push(text);
      if (this.lastLog.length > 40) this.lastLog.shift();
    }
    switch (e.type) {
      case 'battleStarted':
        if (e.advantage === 'playerStrike') hud.banner('Player Strike', 'The party acts first', t.banner / this.speed);
        else if (e.advantage === 'ambush') hud.banner('Ambush', 'The enemy acts first', t.banner / this.speed);
        await this.sleep(e.advantage === 'neutral' ? 0.05 : t.banner * 0.6);
        break;
      case 'waveStarted': {
        if (e.wave > 1) {
          const enemies = this.battle.units.filter((u) => u.side === 'enemy' && u.presence === 'active');
          scene.setEnemies(enemies.map((u) => this.actorSpec(u.uid)));
          for (const u of enemies) {
            this.hp.set(u.uid, u.hp);
            this.toughness.set(u.uid, u.toughness);
          }
          hud.setEnemies(enemies.map((u) => this.hudUnit(u.uid)));
          this.selectedEnemy = null;
          this.normaliseSelection();
          hud.banner(`Wave ${e.wave}`, `of ${e.waveCount}`, t.banner / this.speed);
          await this.sleep(t.banner * 0.7);
        }
        hud.setCycle(this.battle.state.cycle, e.wave, e.waveCount);
        break;
      }
      case 'cycle':
        hud.setCycle(e.cycle, this.battle.state.wave, this.battle.state.waveCount);
        break;
      case 'turnStarted':
        if (e.kind !== 'ultimate') {
          hud.setActive(e.uid);
          scene.actors.get(e.uid)?.pulse();
        }
        break;
      case 'turnSkipped': {
        hud.float(e.uid, e.reason === 'freeze' ? 'Frozen' : 'Cannot act', 'text');
        await this.sleep(t.dotPause);
        break;
      }
      case 'action':
        await this.playAction(e);
        break;
      case 'hit': {
        const target = scene.actors.get(e.target);
        const colour = this.color(e.element);
        target?.hit(colour, e.crit || e.broke);
        const max = this.battle.maxHp(this.battle.unit(e.target));
        this.hp.set(e.target, e.hpAfter);
        hud.setHp(e.target, e.hpAfter, max);
        if (e.toughnessDamage > 0) {
          const left = Math.max(0, (this.toughness.get(e.target) ?? 0) - e.toughnessDamage);
          this.toughness.set(e.target, left);
          hud.setToughness(e.target, left, this.battle.unit(e.target).maxToughness, false);
        }
        hud.float(e.target, Math.round(e.total).toLocaleString('en-US'), e.crit ? 'crit' : e.weakness ? 'weak' : 'damage');
        if (e.crit) this.director?.shake('hit');
        await this.sleep(t.hitGap);
        break;
      }
      case 'weaknessBreak': {
        const target = scene.actors.get(e.target);
        target?.hit('#c9a8ff', true);
        hud.setToughness(e.target, 0, this.battle.unit(e.target).maxToughness, true);
        this.toughness.set(e.target, 0);
        hud.float(e.target, `BREAK ${Math.round(e.damage).toLocaleString('en-US')}`, 'break');
        hud.setHp(e.target, this.battle.unit(e.target).hp, this.battle.maxHp(this.battle.unit(e.target)));
        this.director?.shake('hit');
        await this.sleep(t.breakPause);
        break;
      }
      case 'toughnessRecovered': {
        const u = this.battle.unit(e.uid);
        this.toughness.set(e.uid, u.maxToughness);
        hud.setToughness(e.uid, u.maxToughness, u.maxToughness, false);
        break;
      }
      case 'dot': {
        scene.actors.get(e.target)?.hit(this.color(e.element));
        hud.setHp(e.target, e.hpAfter, this.battle.maxHp(this.battle.unit(e.target)));
        hud.float(e.target, Math.round(e.amount).toLocaleString('en-US'), 'dot');
        await this.sleep(t.dotPause);
        break;
      }
      case 'heal':
        hud.setHp(e.target, e.hpAfter, this.battle.maxHp(this.battle.unit(e.target)));
        hud.float(e.target, `+${Math.round(e.amount).toLocaleString('en-US')}`, 'heal');
        await this.sleep(t.statusPause);
        break;
      case 'shield':
        hud.float(e.target, 'Shield', 'text');
        this.syncStatuses(e.target);
        await this.sleep(t.statusPause);
        break;
      case 'statusApplied':
        this.syncStatuses(e.target);
        await this.sleep(t.statusPause);
        break;
      case 'statusResisted':
        hud.float(e.target, 'RESIST', 'text');
        await this.sleep(t.statusPause);
        break;
      case 'statusExpired':
        this.syncStatuses(e.target);
        break;
      case 'energy':
        hud.setEnergy(e.uid, e.current, e.max);
        break;
      case 'skillPoints':
        hud.setSp(e.current, this.battle.state.skillPoints.max);
        break;
      case 'unitDown': {
        const u = this.battle.unit(e.uid);
        this.hp.set(e.uid, 0);
        hud.setHp(e.uid, 0, this.battle.maxHp(u));
        hud.setDown(e.uid, true);
        const actor = scene.actors.get(e.uid);
        if (actor) await actor.defeat(t.downPause / this.speed);
        break;
      }
      case 'phaseChanged': {
        const u = this.battle.unit(e.uid);
        hud.banner(`${this.unitLabel(e.uid)}`, `Phase ${e.phase + 1}`, t.banner / this.speed);
        hud.setHp(e.uid, u.hp, this.battle.maxHp(u));
        hud.setToughness(e.uid, u.toughness, u.maxToughness, false);
        this.toughness.set(e.uid, u.toughness);
        this.director?.shake('boss-roar');
        await this.sleep(t.banner * 0.7);
        break;
      }
      case 'charging':
        hud.float(e.uid, 'Charging…', 'text');
        await this.sleep(t.dotPause);
        break;
      case 'techniqueApplied':
        hud.float(e.uid, 'Technique', 'text');
        break;
      case 'resource':
      case 'actionShift':
      case 'speedChanged':
      case 'insertQueued':
      case 'turnEnded':
      case 'stub':
      case 'ended':
        break;
    }
  }

  private async playAction(e: Extract<BattleEvent, { type: 'action' }>): Promise<void> {
    const scene = this.scene!;
    const t = this.stage.timing;
    const actor = scene.actors.get(e.uid);
    const target = e.targets[0];
    const u = this.battle.unit(e.uid);
    scene.setShot(e.uid, target ?? null);
    const hostile = target ? this.battle.unit(target).side !== u.side : false;
    const anims: Promise<unknown>[] = [];
    const shotId = this.shotFor(e);
    const shot = shotId ? this.shots.get(shotId) : undefined;
    if (shot && (hostile || e.slot === 'ultimate') && this.director) {
      this.director.stopShots();
      anims.push(this.director.playShot(shot, scene.units));
    }
    this.hud?.float(e.uid, e.abilityId.split('.').pop()!.replace(/-/g, ' '), 'text');
    if (actor && hostile && target) anims.push(actor.attack(scene.actor(target).home, t.lunge / this.speed));
    this.pendingAnim = Promise.all([this.pendingAnim, ...anims]);
    await this.sleep(t.actionLead + (hostile ? t.lunge * 0.42 : 0.15));
  }

  // ---- Frame ------------------------------------------------------------------------------------

  update(dt: number): void {
    const scene = this.scene;
    const hud = this.hud;
    const director = this.director;
    if (!scene || !hud || !director) return;
    const input = this.ctx.input;
    const sdt = Math.min(dt, 0.1) * this.speed;
    // Input.
    if (this.result && this.leave) {
      if (input.wasPressed('confirm') || input.wasPressed('back')) this.leave();
    } else {
      if (input.wasPressed('basicAttack')) this.choose({ kind: 'basic' });
      if (input.wasPressed('skill')) this.choose({ kind: 'skill' });
      ['ultimate1', 'ultimate2', 'ultimate3', 'ultimate4'].forEach((a, i) => {
        if (!input.wasPressed(a)) return;
        const ally = this.battle.units.filter((u) => u.side === 'ally')[i];
        if (ally) this.requestUltimate(ally.uid);
      });
      if (input.wasPressed('targetPrev')) this.cycleTarget(-1);
      if (input.wasPressed('targetNext')) this.cycleTarget(1);
    }
    if (input.wasPressed('combatLog')) hud.toggleLog();
    // World.
    scene.update(sdt);
    const pose = director.update(sdt);
    if (pose) this.applyPose(pose);
    hud.setLetterbox(director.letterbox, this.cameraRules.letterboxHeight);
    const cam = scene.camera;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    hud.project((uid) => {
      const a = scene.actors.get(uid);
      if (!a) return null;
      const v = a.head().project(cam);
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * hgt, visible: v.z < 1 };
    });
  }

  private applyPose(p: CameraPose): void {
    const cam = this.scene!.camera;
    cam.position.set(p.position.x, p.position.y, p.position.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.target.x, p.target.y, p.target.z);
    if (p.roll !== 0) cam.rotateZ(p.roll);
    if (Math.abs(p.fov - cam.fov) > 1e-4) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
  }

  render(): void {
    this.view?.render();
  }

  // ---- Probe (E2E / debugging) ------------------------------------------------------------------

  private probe(): Record<string, unknown> {
    const b = this.battle;
    if (!b) return {};
    const camera = this.scene?.camera;
    return {
      source: this.params.source,
      outcome: b.outcome,
      awaiting: b.awaiting,
      accepting: this.accepting !== null,
      busy: this.busy,
      advantage: b.advantage,
      sp: b.state.skillPoints.current,
      cycle: b.state.cycle,
      wave: b.state.wave,
      turns: b.turns,
      selectedEnemy: this.selectedEnemy,
      cameraMode: this.director?.mode ?? null,
      letterbox: this.director?.letterbox ?? 0,
      trauma: this.director?.trauma ?? 0,
      cameraPos: camera ? [camera.position.x, camera.position.y, camera.position.z] : null,
      units: b.units.map((u) => ({
        uid: u.uid,
        defId: u.defId,
        name: b.nameOf(u.uid),
        side: u.side,
        presence: u.presence,
        hp: u.hp,
        maxHp: b.maxHp(u),
        energy: u.ultimate?.current ?? null,
        maxEnergy: u.ultimate?.max ?? null,
        toughness: u.toughness,
        maxToughness: u.maxToughness,
        broken: u.broken,
        weaknesses: u.weaknesses,
        statuses: u.statuses.map((s) => s.statusId),
      })),
      turnOrder: b.turnOrder(this.stage.turnOrderCount).map((o) => b.nameOf(o.uid)),
      log: this.lastLog.slice(-20),
      stubs: b.log.filter((e) => e.type === 'stub').map((e) => (e.type === 'stub' ? `${e.what}: ${e.detail}` : '')),
      result: this.result,
      eventCount: b.log.length,
    };
  }
}

