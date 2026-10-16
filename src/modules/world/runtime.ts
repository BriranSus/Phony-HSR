import type { Collider, Interactable, Level } from '@models/locomotion';
import type { Advantage, EnemySpawn, HiddenArea, Puzzle, Requirement, Reward, World, WorldObject, WorldRules } from '@models/world';
import { lineOfSightBlocked, v3 } from '@modules/camera';
import { CollisionWorld, type CapsuleSpec } from '@modules/player';
import { attackAdvantage, contactAdvantage, inAttackCone, isBehindEnemy } from './encounter';
import { EnemyAI, type EnemyState } from './enemies';
import type { WorldEmit, WorldEvents } from './events';
import { WorldGraph } from './graph';
import { initialState, isSpent, nextState, promptLabel, requirementMet, unmetRequirements, type RequirementContext } from './objects';
import { areaProgress, combineProgress, type AreaProgress } from './progress';
import { pressSequence, platesSatisfied } from './puzzles';
import { objectKey, WorldState } from './state';

/**
 * World runtime (spec §13 / §14): the live state of the world the player is exploring.
 *
 * It is pure TypeScript: no rendering, no DOM, no input. The app layer feeds it the player's pose
 * and the F / attack / Technique actions, and renders what it exposes (`objects()`, `enemies()`,
 * `hiddenAreas()`, the live `colliders`). Persistent facts live in `WorldState`; transient things
 * (enemy positions, plate occupancy, veil fades) live here.
 *
 * Responsibilities:
 * - loading an area from data into live colliders, objects, enemies and spawns (and unloading it);
 * - the interactable framework: prerequisites, state machines, rewards, puzzles, hidden areas,
 *   anchors and portals;
 * - overworld enemies (AI states, detection, encounter advantage, respawn);
 * - typed world events for the quest layer, and exploration progress.
 */

export interface PlayerPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export type InteractionResult =
  | { readonly type: 'message'; readonly speaker: string; readonly text: string; readonly rewards?: readonly Reward[] }
  | { readonly type: 'toast'; readonly text: string }
  | { readonly type: 'locked'; readonly text: string }
  | { readonly type: 'anchorMenu'; readonly anchorId: string }
  | { readonly type: 'transition'; readonly area: string; readonly spawn: string; readonly via: string }
  | { readonly type: 'none' };

export type AttackResult =
  | { readonly type: 'enemy'; readonly spawnId: string; readonly advantage: Advantage }
  | { readonly type: 'breakable'; readonly id: string; readonly hits: number; readonly needed: number; readonly broken: boolean }
  | { readonly type: 'miss' };

export interface EncounterInfo {
  readonly spawnId: string;
  readonly enemies: readonly string[];
  readonly advantage: Advantage;
  readonly trigger: 'attack' | 'contact';
  readonly areaId: string;
  /** Enemy level for the battle. */
  readonly level: number;
}

export interface ObjectView {
  readonly def: WorldObject;
  readonly state: string;
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EnemyView {
  readonly spawnId: string;
  readonly enemies: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly state: EnemyState;
}

export interface HiddenView {
  readonly def: HiddenArea;
  readonly discovered: boolean;
  /** 0 = veiled, 1 = fully revealed (the fade-in). */
  readonly reveal: number;
}

export interface AnchorEntry {
  readonly key: string;
  readonly objectId: string;
  readonly areaId: string;
  readonly areaName: string;
  readonly regionName: string;
  readonly label: string;
  readonly current: boolean;
}

export interface WorldLogEntry {
  readonly time: number;
  readonly name: string;
  readonly text: string;
}

interface ObjectInstance {
  readonly def: WorldObject;
  readonly key: string;
  x: number;
  y: number;
  z: number;
}

interface EnemyInstance {
  readonly spawn: EnemySpawn;
  readonly key: string;
  readonly ai: EnemyAI;
  y: number;
}

interface AreaRuntime {
  readonly id: string;
  readonly level: Level;
  readonly objects: Map<string, ObjectInstance>;
  enemies: EnemyInstance[];
  readonly reveal: Map<string, number>;
  /** Plates currently held down (transient). */
  readonly pressed: Set<string>;
}

export interface WorldRuntimeOptions {
  readonly world: World;
  readonly levels: ReadonlyMap<string, Level>;
  readonly rules: WorldRules;
  readonly capsule: CapsuleSpec;
  readonly emit: WorldEmit;
  /** Restored progress (otherwise a fresh state starting at `world.startArea`). */
  readonly state?: WorldState;
  /** Display names for messages (defaults to the id). */
  readonly itemName?: (id: string) => string;
}

const LOG_LIMIT = 80;
const CRATE_HEIGHT = 1;

export class WorldRuntime {
  /** The live collision geometry of the loaded area: shared by the controller, camera and AI. */
  readonly colliders: Collider[] = [];
  readonly state: WorldState;
  readonly graph: WorldGraph;
  readonly log: WorldLogEntry[] = [];
  private readonly rules: WorldRules;
  private readonly rawEmit: WorldEmit;
  private readonly itemName: (id: string) => string;
  private enemyWorld: CollisionWorld;
  private area: AreaRuntime | null = null;
  private encounterInfo: EncounterInfo | null = null;
  private lastProgress = '';

  constructor(opts: WorldRuntimeOptions) {
    this.graph = new WorldGraph(opts.world, opts.levels);
    this.rules = opts.rules;
    this.rawEmit = opts.emit;
    this.itemName = opts.itemName ?? ((id) => id);
    this.state = opts.state ?? WorldState.fresh(opts.world.id, opts.world.startArea);
    this.enemyWorld = new CollisionWorld(this.colliders, { ...opts.capsule, radius: opts.rules.enemy.radius });
  }

  // ---- Queries ----------------------------------------------------------------------------------

  get areaId(): string {
    return this.mustArea().id;
  }

  get level(): Level {
    return this.mustArea().level;
  }

  get regionId(): string {
    return this.graph.regionOf(this.areaId).id;
  }

  get encounter(): EncounterInfo | null {
    return this.encounterInfo;
  }

  get loaded(): boolean {
    return this.area !== null;
  }

  stateOf(objectId: string): string | undefined {
    return this.state.data.objects[objectKey(this.areaId, objectId)]?.state;
  }

  private mustArea(): AreaRuntime {
    if (!this.area) throw new Error('no area is loaded; call enterArea() first');
    return this.area;
  }

  private visible(def: WorldObject): boolean {
    return !def.hiddenIn || this.state.isDiscovered(this.mustArea().id, def.hiddenIn);
  }

  private rec(inst: ObjectInstance): { state: string; hits?: number; x?: number; z?: number } {
    return this.state.data.objects[inst.key]!;
  }

  private ctx(): RequirementContext {
    const area = this.mustArea();
    return {
      puzzleSolved: (id) => this.state.data.puzzles[objectKey(area.id, id)]?.solved === true,
      objectState: (id) => this.state.data.objects[objectKey(area.id, id)]?.state,
      itemCount: (id) => this.state.itemCount(id),
      hiddenDiscovered: (id) => this.state.isDiscovered(area.id, id),
    };
  }

  /** The F-prompt list: visible, not-yet-spent objects with their current labels and positions. */
  prompts(): Interactable[] {
    const out: Interactable[] = [];
    for (const inst of this.mustArea().objects.values()) {
      if (!this.visible(inst.def)) continue;
      const s = this.rec(inst).state;
      if (isSpent(inst.def, s)) continue;
      out.push({ ...inst.def, label: promptLabel(inst.def, s), position: [inst.x, inst.y, inst.z] } as Interactable);
    }
    return out;
  }

  objects(): ObjectView[] {
    return [...this.mustArea().objects.values()].map((inst) => ({ def: inst.def, state: this.rec(inst).state, visible: this.visible(inst.def), x: inst.x, y: inst.y, z: inst.z }));
  }

  enemies(): EnemyView[] {
    return this.mustArea().enemies.map((e) => ({ spawnId: e.spawn.id, enemies: e.spawn.enemies, x: e.ai.x, y: e.y, z: e.ai.z, yaw: e.ai.yaw, state: e.ai.state }));
  }

  hiddenAreas(): HiddenView[] {
    const area = this.mustArea();
    return area.level.hiddenAreas.map((def) => ({ def, discovered: this.state.isDiscovered(area.id, def.id), reveal: area.reveal.get(def.id) ?? 0 }));
  }

  anchors(): AnchorEntry[] {
    const out: AnchorEntry[] = [];
    for (const areaId of this.graph.areaIds()) {
      const level = this.graph.level(areaId);
      for (const o of level.interactables) {
        if (o.kind !== 'anchor' || this.state.data.objects[objectKey(areaId, o.id)]?.state !== 'active') continue;
        out.push({
          key: objectKey(areaId, o.id),
          objectId: o.id,
          areaId,
          areaName: level.name,
          regionName: this.graph.regionOf(areaId).name,
          label: o.label.replace(/^Space Anchor:\s*/, ''),
          current: this.area?.id === areaId,
        });
      }
    }
    return out;
  }

  progress(areaId: string = this.areaId): AreaProgress {
    return areaProgress(areaId, this.graph.level(areaId), this.state);
  }

  regionProgress(regionId: string): AreaProgress {
    const region = this.graph.world.regions.find((r) => r.id === regionId);
    return combineProgress((region?.areas ?? []).map((a) => this.progress(a)));
  }

  worldProgress(): AreaProgress {
    return combineProgress(this.graph.areaIds().map((a) => this.progress(a)));
  }

  // ---- Events -----------------------------------------------------------------------------------

  private emit<K extends keyof WorldEvents>(name: K, payload: WorldEvents[K]): void {
    const text = Object.entries(payload as Record<string, unknown>)
      .map(([k, v]) => (Array.isArray(v) ? `${k}=${v.length}` : typeof v === 'object' ? k : `${v}`))
      .slice(0, 3)
      .join(' ');
    this.log.push({ time: this.state.data.clock, name: name.replace('world:', ''), text });
    if (this.log.length > LOG_LIMIT) this.log.shift();
    this.rawEmit(name, payload);
  }

  private emitProgress(): void {
    const p = this.progress();
    const key = `${this.areaId}:${p.found}/${p.total}`;
    if (key === this.lastProgress) return;
    const first = this.lastProgress === '';
    this.lastProgress = key;
    if (!first) this.emit('world:progressChanged', { areaId: this.areaId, percent: p.percent, found: p.found, total: p.total });
  }

  private changed(inst: ObjectInstance): void {
    this.emit('world:objectChanged', { objectId: inst.def.id, areaId: this.areaId, kind: inst.def.kind, state: this.rec(inst).state });
  }

  // ---- Area loading -----------------------------------------------------------------------------

  /** Loads an area from data (unloading the previous one) and returns where the player arrives. */
  enterArea(areaId: string, spawnName = 'default'): { position: readonly [number, number, number]; yaw: number } {
    const level = this.graph.level(areaId);
    const region = this.graph.regionOf(areaId);
    this.encounterInfo = null;
    this.colliders.length = 0;
    this.colliders.push(...level.colliders);
    const area: AreaRuntime = { id: areaId, level, objects: new Map(), enemies: [], reveal: new Map(), pressed: new Set() };
    this.area = area;
    for (const def of level.interactables) {
      const key = objectKey(areaId, def.id);
      const rec = (this.state.data.objects[key] ??= { state: initialState(def) });
      if (def.kind === 'plate') rec.state = 'idle';
      const inst: ObjectInstance = { def, key, x: rec.x ?? def.position[0], y: def.position[1], z: rec.z ?? def.position[2] };
      area.objects.set(def.id, inst);
      if (def.kind === 'gate' && rec.state === 'open') this.removeCollider(def.collider);
      if (def.kind === 'breakable' && rec.state === 'broken' && def.collider) this.removeCollider(def.collider);
      if (def.kind === 'crate') this.colliders.push(this.crateCollider(inst));
    }
    for (const h of level.hiddenAreas) area.reveal.set(h.id, this.state.isDiscovered(areaId, h.id) ? 1 : 0);
    // Enemies: defeated groups come back per their respawn rule.
    for (const sp of level.enemySpawns) {
      const key = objectKey(areaId, sp.id);
      const at = this.state.data.defeated[key];
      if (at !== undefined) {
        if (!this.respawnDue(sp, at, true)) continue;
        delete this.state.data.defeated[key];
      }
      area.enemies.push(this.spawnEnemy(sp, key));
    }
    const first = !this.state.data.visited.includes(areaId);
    if (first) this.state.data.visited.push(areaId);
    this.state.data.area = areaId;
    this.reevaluateGates();
    this.lastProgress = '';
    this.emitProgress();
    this.emit('world:areaEntered', { areaId, areaName: level.name, regionId: region.id, regionName: region.name, firstVisit: first });
    const spawn = spawnName === 'default' ? level.spawn : (level.spawns[spawnName] ?? level.spawn);
    return { position: spawn.position, yaw: spawn.yaw };
  }

  private spawnEnemy(sp: EnemySpawn, key: string): EnemyInstance {
    const ai = new EnemyAI({ x: sp.position[0], z: sp.position[2] }, sp.yaw, sp.patrol, this.rules.enemy, sp.detectionRadius);
    return { spawn: sp, key, ai, y: sp.position[1] };
  }

  private respawnDue(sp: EnemySpawn, defeatedAt: number, atEntry: boolean): boolean {
    const mode = sp.respawn?.mode ?? this.rules.respawn.mode;
    const seconds = sp.respawn?.seconds ?? this.rules.respawn.seconds;
    if (mode === 'never') return false;
    if (mode === 'reenter') return atEntry;
    return this.state.data.clock - defeatedAt >= seconds;
  }

  private removeCollider(id: string): void {
    const i = this.colliders.findIndex((c) => c.id === id);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  private crateCollider(inst: ObjectInstance): Collider {
    const half = (inst.def.kind === 'crate' ? inst.def.size : 1.4) / 2;
    return { shape: 'box', id: `crate:${inst.def.id}`, min: [inst.x - half, 0, inst.z - half], max: [inst.x + half, CRATE_HEIGHT, inst.z + half], material: 'crate' };
  }

  // ---- Frame update -----------------------------------------------------------------------------

  update(dt: number, p: PlayerPose): void {
    const area = this.mustArea();
    if (this.encounterInfo) return;
    const data = this.state.data;
    data.clock += dt;
    this.updatePlates(p);

    for (const h of area.level.hiddenAreas) {
      if (this.state.isDiscovered(area.id, h.id)) {
        const r = area.reveal.get(h.id) ?? 0;
        if (r < 1) area.reveal.set(h.id, Math.min(1, r + dt / this.rules.hiddenFadeSeconds));
      } else if (h.discover.by === 'enter' && p.x >= h.bounds.min[0] && p.x <= h.bounds.max[0] && p.z >= h.bounds.min[1] && p.z <= h.bounds.max[1]) {
        this.discover(h);
      }
    }

    for (const e of area.enemies) {
      const canSee = !lineOfSightBlocked(this.colliders, v3(e.ai.x, e.y + 1, e.ai.z), v3(p.x, p.y + 1, p.z));
      const result = e.ai.step(dt, {
        px: p.x,
        pz: p.z,
        canSee,
        move: (x, z, tx, tz, maxStep) => {
          const dx = tx - x;
          const dz = tz - z;
          const d = Math.hypot(dx, dz);
          if (d < 1e-6) return { x, z };
          const s = Math.min(maxStep, d);
          const r = this.enemyWorld.resolveHorizontal(x + (dx / d) * s, z + (dz / d) * s, e.y);
          return { x: r.x, z: r.z };
        },
      });
      const ground = this.enemyWorld.groundAt(e.ai.x, e.ai.z, e.y + 0.5);
      if (ground) e.y = ground.height;
      if (result.detected) this.emit('world:enemyDetected', { spawnId: e.spawn.id, enemies: e.spawn.enemies, areaId: area.id });
      if (result.contact) {
        this.startEncounter(e, contactAdvantage(this.rules.encounter, p.yaw, p.x, p.z, e.ai.x, e.ai.z), 'contact');
        return;
      }
    }

    // Timed respawns of defeated groups in this area.
    for (const sp of area.level.enemySpawns) {
      const key = objectKey(area.id, sp.id);
      const at = data.defeated[key];
      if (at !== undefined && (sp.respawn?.mode ?? this.rules.respawn.mode) === 'timer' && this.respawnDue(sp, at, false)) {
        delete data.defeated[key];
        area.enemies.push(this.spawnEnemy(sp, key));
      }
    }
  }

  private updatePlates(p: PlayerPose): void {
    const area = this.mustArea();
    const crates = [...area.objects.values()].filter((o) => o.def.kind === 'crate' && this.visible(o.def));
    let any = false;
    for (const inst of area.objects.values()) {
      const def = inst.def;
      if (def.kind !== 'plate' || !this.visible(def)) continue;
      const underPlayer = Math.hypot(p.x - inst.x, p.z - inst.z) <= def.radius && Math.abs(p.y - inst.y) <= 1;
      const underCrate = crates.some((c) => Math.hypot(c.x - inst.x, c.z - inst.z) <= this.rules.plates.crateRadius);
      const event = underPlayer || underCrate ? 'press' : 'release';
      const next = nextState(def, this.rec(inst).state, event);
      if (next) {
        this.rec(inst).state = next;
        if (next === 'pressed') area.pressed.add(def.id);
        else area.pressed.delete(def.id);
        this.changed(inst);
        any = true;
      }
    }
    if (!any) return;
    for (const pz of area.level.puzzles) {
      if (pz.type !== 'plates') continue;
      const key = objectKey(area.id, pz.id);
      if (this.state.data.puzzles[key]?.solved) continue;
      if (platesSatisfied(pz, area.pressed)) this.solvePuzzle(pz);
    }
  }

  // ---- Interaction ------------------------------------------------------------------------------

  private missingText(def: WorldObject, unmet: readonly Requirement[]): string {
    if (def.lockedMessage) return def.lockedMessage;
    const r = unmet[0];
    if (r?.kind === 'item') return `Requires ${this.itemName(r.id)}.`;
    return 'It will not respond yet.';
  }

  interact(objectId: string, p: PlayerPose): InteractionResult {
    const area = this.mustArea();
    const inst = area.objects.get(objectId);
    if (!inst || !this.visible(inst.def) || this.encounterInfo) return { type: 'none' };
    const def = inst.def;
    const rec = this.rec(inst);
    const unmet = unmetRequirements(def.requires, this.ctx());
    if (unmet.length > 0 && def.kind !== 'gate') {
      const text = this.missingText(def, unmet);
      this.emit('world:locked', { objectId: def.id, areaId: area.id, reason: unmet[0]!.kind });
      return { type: 'locked', text };
    }
    switch (def.kind) {
      case 'sign':
        return { type: 'message', speaker: 'Notice', text: def.message };
      case 'npc':
        this.emit('world:npcTalked', { npcId: def.id, areaId: area.id });
        return { type: 'message', speaker: def.label.replace(/^Talk:\s*/, ''), text: def.message };
      case 'chest': {
        const next = nextState(def, rec.state, 'interact');
        if (!next) return { type: 'none' };
        rec.state = next;
        this.changed(inst);
        this.grant(def.rewards, def.id);
        this.emit('world:chestOpened', { chestId: def.id, areaId: area.id, rewards: def.rewards });
        this.emitProgress();
        return { type: 'message', speaker: 'Treasure', text: def.message ?? 'The chest is open.', rewards: def.rewards };
      }
      case 'collectible': {
        const next = nextState(def, rec.state, 'interact');
        if (!next) return { type: 'none' };
        rec.state = next;
        this.changed(inst);
        this.grant([def.reward], def.id);
        this.emitProgress();
        // The item toast comes from the itemCollected event.
        return { type: 'none' };
      }
      case 'breakable':
        return { type: 'toast', text: def.message ?? 'Strike it with a left click.' };
      case 'switch':
        return this.pressSwitch(inst, def);
      case 'plate':
        return { type: 'none' };
      case 'crate':
        return this.pushCrate(inst, p);
      case 'gate':
        return this.useGate(inst, def, unmet, p);
      case 'anchor': {
        const next = nextState(def, rec.state, 'interact');
        if (next) {
          rec.state = next;
          this.changed(inst);
          this.emit('world:anchorActivated', { anchorId: def.id, areaId: area.id });
          this.emitProgress();
        }
        return { type: 'anchorMenu', anchorId: def.id };
      }
      case 'portal':
        return { type: 'transition', area: def.toArea, spawn: def.toSpawn, via: def.id };
    }
  }

  private grant(rewards: readonly Reward[], source: string): void {
    for (const r of rewards) {
      this.state.addItem(r.item, r.count);
      this.emit('world:itemCollected', { itemId: r.item, count: r.count, source, areaId: this.areaId });
    }
  }

  private pressSwitch(inst: ObjectInstance, def: Extract<WorldObject, { kind: 'switch' }>): InteractionResult {
    const area = this.mustArea();
    const rec = this.rec(inst);
    const puzzle = area.level.puzzles.find((pz): pz is Extract<Puzzle, { type: 'sequence' }> => pz.type === 'sequence' && pz.switches.includes(def.id));
    const next = nextState(def, rec.state, 'interact');
    if (!next) return { type: 'none' };
    rec.state = next;
    this.changed(inst);
    if (!puzzle) return { type: 'toast', text: `${def.label.replace(/^Press:\s*/, '')} ${next === 'on' ? 'engaged' : 'released'}` };
    const pkey = objectKey(area.id, puzzle.id);
    const prog = (this.state.data.puzzles[pkey] ??= { progress: 0, solved: false });
    if (prog.solved) return { type: 'none' };
    const step = pressSequence(puzzle, prog.progress, def.id);
    prog.progress = step.progress;
    if (step.outcome === 'failed') {
      for (const id of puzzle.switches) {
        const s = area.objects.get(id)!;
        if (nextState(s.def, this.rec(s).state, 'reset')) {
          this.rec(s).state = 'off';
          this.changed(s);
        }
      }
      this.emit('world:puzzleFailed', { puzzleId: puzzle.id, areaId: area.id });
      return { type: 'toast', text: 'The switches reset. Wrong order.' };
    }
    if (step.outcome === 'solved') {
      this.solvePuzzle(puzzle);
      return { type: 'toast', text: `${puzzle.name} solved` };
    }
    return { type: 'toast', text: `${step.progress} / ${puzzle.switches.length}` };
  }

  private solvePuzzle(puzzle: Puzzle): void {
    const key = objectKey(this.areaId, puzzle.id);
    const prog = (this.state.data.puzzles[key] ??= { progress: 0, solved: false });
    if (prog.solved) return;
    prog.solved = true;
    prog.progress = puzzle.type === 'sequence' ? puzzle.switches.length : puzzle.plates.length;
    this.emit('world:puzzleSolved', { puzzleId: puzzle.id, areaId: this.areaId });
    this.grant(puzzle.rewards, puzzle.id);
    this.reevaluateGates();
    this.emitProgress();
  }

  private pushCrate(inst: ObjectInstance, p: PlayerPose): InteractionResult {
    const def = inst.def;
    if (def.kind !== 'crate') return { type: 'none' };
    const dx = inst.x - p.x;
    const dz = inst.z - p.z;
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    const tx = inst.x + (horizontal ? Math.sign(dx) * def.step : 0);
    const tz = inst.z + (horizontal ? 0 : Math.sign(dz) * def.step);
    if (this.crateBlocked(inst, tx, tz)) return { type: 'toast', text: 'The crate will not budge.' };
    inst.x = tx;
    inst.z = tz;
    const rec = this.rec(inst);
    rec.x = tx;
    rec.z = tz;
    const half = def.size / 2;
    const c = this.colliders.find((k) => k.id === `crate:${def.id}`);
    if (c) {
      c.min = [tx - half, 0, tz - half];
      c.max = [tx + half, CRATE_HEIGHT, tz + half];
    }
    this.changed(inst);
    return { type: 'none' };
  }

  private crateBlocked(inst: ObjectInstance, x: number, z: number): boolean {
    if (inst.def.kind !== 'crate') return true;
    const half = inst.def.size / 2 - 0.01;
    const own = `crate:${inst.def.id}`;
    return this.colliders.some((c) => {
      if (c.id === own || c.max[1] <= 0.3 || c.min[1] >= CRATE_HEIGHT) return false;
      return x + half > c.min[0] && x - half < c.max[0] && z + half > c.min[2] && z - half < c.max[2];
    });
  }

  private useGate(inst: ObjectInstance, def: Extract<WorldObject, { kind: 'gate' }>, unmet: readonly Requirement[], p: PlayerPose): InteractionResult {
    const rec = this.rec(inst);
    if (rec.state === 'open') return { type: 'none' };
    if (def.openFrom) {
      const side = (p.x - inst.x) * def.openFrom[0] + (p.z - inst.z) * def.openFrom[1];
      if (side <= 0) return { type: 'locked', text: def.lockedMessage ?? 'It will not open from this side.' };
    }
    if (unmet.length > 0 || !def.manual) {
      this.emit('world:locked', { objectId: def.id, areaId: this.areaId, reason: unmet[0]?.kind ?? 'sealed' });
      return { type: 'locked', text: this.missingText(def, unmet) };
    }
    this.openGate(inst);
    return { type: 'toast', text: def.message ?? 'The way opens.' };
  }

  private openGate(inst: ObjectInstance): void {
    const def = inst.def;
    if (def.kind !== 'gate') return;
    for (const r of def.requires) if (r.kind === 'item' && r.consume) this.state.takeItem(r.id, r.count);
    this.rec(inst).state = 'open';
    this.removeCollider(def.collider);
    this.changed(inst);
  }

  /** Opens every automatic gate whose requirements now hold. */
  private reevaluateGates(): void {
    const area = this.mustArea();
    for (const inst of area.objects.values()) {
      const def = inst.def;
      if (def.kind !== 'gate' || def.manual || def.requires.length === 0 || this.rec(inst).state !== 'closed') continue;
      if (def.requires.every((r) => requirementMet(r, this.ctx()))) this.openGate(inst);
    }
  }

  private discover(h: HiddenArea): void {
    const area = this.mustArea();
    if (this.state.isDiscovered(area.id, h.id)) return;
    this.state.data.discovered.push(objectKey(area.id, h.id));
    this.emit('world:hiddenAreaDiscovered', { hiddenId: h.id, areaId: area.id, name: h.name });
    this.reevaluateGates();
  }

  // ---- Combat hooks -----------------------------------------------------------------------------

  /** Overworld attack: strikes the nearest enemy in front (starting an encounter) or a breakable. */
  attack(p: PlayerPose): AttackResult {
    const area = this.mustArea();
    if (this.encounterInfo) return { type: 'miss' };
    const er = this.rules.encounter;
    let target: EnemyInstance | null = null;
    let best = Infinity;
    for (const e of area.enemies) {
      if (!inAttackCone(p.yaw, p.x, p.z, e.ai.x, e.ai.z, er.attackRange, er.attackArcDeg)) continue;
      const d = Math.hypot(e.ai.x - p.x, e.ai.z - p.z);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    if (target) {
      // During the alert window the enemy has already turned to face the player, so what counts is where it noticed them from.
      const behind = target.ai.state === 'alert' ? target.ai.noticedFromBehind : isBehindEnemy(target.ai.yaw, target.ai.x, target.ai.z, p.x, p.z, this.rules.enemy.detectionFovDeg);
      const advantage = attackAdvantage(er, target.ai.state, behind);
      this.startEncounter(target, advantage, 'attack');
      return { type: 'enemy', spawnId: target.spawn.id, advantage };
    }
    const br = this.rules.breakable;
    let hit: ObjectInstance | null = null;
    best = Infinity;
    for (const inst of area.objects.values()) {
      if (inst.def.kind !== 'breakable' || !this.visible(inst.def) || this.rec(inst).state !== 'intact') continue;
      if (!inAttackCone(p.yaw, p.x, p.z, inst.x, inst.z, br.reach, br.arcDeg)) continue;
      const d = Math.hypot(inst.x - p.x, inst.z - p.z);
      if (d < best) {
        best = d;
        hit = inst;
      }
    }
    if (!hit || hit.def.kind !== 'breakable') return { type: 'miss' };
    const def = hit.def;
    const rec = this.rec(hit);
    const before = rec.hits ?? 0;
    const next = nextState(def, rec.state, 'hit', before)!;
    rec.hits = before + 1;
    rec.state = next;
    if (next === 'broken') {
      if (def.collider) this.removeCollider(def.collider);
      this.grant(def.rewards, def.id);
      for (const h of area.level.hiddenAreas) if (h.discover.by === 'object' && h.discover.object === def.id) this.discover(h);
      this.reevaluateGates();
      this.emitProgress();
    }
    this.changed(hit);
    return { type: 'breakable', id: def.id, hits: rec.hits, needed: def.hits, broken: next === 'broken' };
  }

  /** The Technique hook: stuns every enemy in range so the next attack is a player strike. */
  technique(p: PlayerPose): number {
    const area = this.mustArea();
    let affected = 0;
    if (!this.encounterInfo) {
      for (const e of area.enemies) {
        if (Math.hypot(e.ai.x - p.x, e.ai.z - p.z) <= this.rules.technique.radius) {
          e.ai.stun();
          affected++;
        }
      }
    }
    this.emit('world:techniqueUsed', { affected, areaId: area.id });
    return affected;
  }

  private startEncounter(e: EnemyInstance, advantage: Advantage, trigger: 'attack' | 'contact'): void {
    this.encounterInfo = { spawnId: e.spawn.id, enemies: e.spawn.enemies, advantage, trigger, areaId: this.areaId, level: e.spawn.level ?? this.rules.encounter.enemyLevel };
    this.emit('world:encounterStarted', { ...this.encounterInfo });
  }

  /**
   * Ends the pending encounter with the battle's result. A victory removes the group (respawn per
   * its rule); a defeat leaves it standing, back at its post and calm, so the player can retry.
   */
  endEncounter(result: 'victory' | 'defeat' = 'victory'): void {
    const info = this.encounterInfo;
    if (!info) return;
    const area = this.mustArea();
    this.encounterInfo = null;
    const i = area.enemies.findIndex((e) => e.spawn.id === info.spawnId);
    if (i >= 0) {
      const e = area.enemies[i]!;
      if (result === 'victory') {
        area.enemies.splice(i, 1);
        this.state.data.defeated[e.key] = this.state.data.clock;
        for (const enemyId of e.spawn.enemies) this.emit('world:enemyDefeated', { spawnId: e.spawn.id, enemyId, areaId: area.id });
      } else {
        area.enemies[i] = this.spawnEnemy(e.spawn, e.key);
      }
    }
    this.emit('world:encounterEnded', { spawnId: info.spawnId, areaId: info.areaId, result });
  }

  /** Items won in a battle: added to the world's item ledger with the usual `itemCollected` events. */
  grantRewards(rewards: readonly Reward[], source: string): void {
    this.grant(rewards, source);
  }

  /** Returns the party to the area's default arrival point (after a defeat). */
  respawnPoint(): { position: readonly [number, number, number]; yaw: number } {
    const l = this.mustArea().level;
    return { position: l.spawn.position, yaw: l.spawn.yaw };
  }

  // ---- Travel -----------------------------------------------------------------------------------

  /** Travels to an activated anchor (any area of the world). The app fades around this call. */
  teleportToAnchor(key: string): { areaId: string; position: readonly [number, number, number]; yaw: number } | null {
    const entry = this.anchors().find((a) => a.key === key);
    if (!entry) return null;
    const def = this.graph.level(entry.areaId).interactables.find((o) => o.id === entry.objectId);
    if (def?.kind !== 'anchor') return null;
    const from = this.areaId;
    const arrive = this.enterArea(entry.areaId, def.spawn);
    this.emit('world:teleported', { anchorId: def.id, fromArea: from, toArea: entry.areaId });
    return { areaId: entry.areaId, ...arrive };
  }

  toJSON(): ReturnType<WorldState['toJSON']> {
    return this.state.toJSON();
  }
}
