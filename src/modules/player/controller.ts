import type { Interactable, LocomotionRules } from '@models/locomotion';
import { AnimationStateMachine, type AnimationFrame } from './animation';
import { CollisionWorld } from './collision';
import { PromptList, interactablesInRange } from './interaction';
import { approachVelocity, length, moveDirection, selectGait, turnToward, yawOf, type Gait, type Vec2 } from './movement';
import { PartyRoster } from './party';

/**
 * Overworld player controller. Input-agnostic and deterministic: each fixed step receives a
 * `ControlInput` snapshot (built from the action map by the app layer) and emits hook events.
 *
 * Per step: gait (walk toggle / sprint) -> camera-relative target velocity -> acceleration ->
 * facing (turn-rate limited) -> horizontal collision -> step-up / ground snap / gravity ->
 * animation state -> footsteps -> interaction prompts -> action hooks (interact, Technique,
 * overworld attack) and party switching. There is no jump.
 */
export interface ControlInput {
  /** Strafe axis (-1 left .. 1 right) and forward axis (-1 back .. 1 forward): keys or stick. */
  readonly right: number;
  readonly forward: number;
  readonly cameraYaw: number;
  readonly sprint: boolean;
  readonly walkTogglePressed: boolean;
  readonly interactPressed: boolean;
  readonly techniquePressed: boolean;
  readonly attackPressed: boolean;
  /** 0-based party slot requested this step, or null. */
  readonly slotPressed: number | null;
  /** Prompt list scroll (wheel notches), 0 for none. */
  readonly promptScroll: number;
}

export const NO_INPUT: ControlInput = {
  right: 0,
  forward: 0,
  cameraYaw: 0,
  sprint: false,
  walkTogglePressed: false,
  interactPressed: false,
  techniquePressed: false,
  attackPressed: false,
  slotPressed: null,
  promptScroll: 0,
};

export type ControllerEvent =
  | { readonly type: 'footstep'; readonly characterId: string; readonly foot: 'left' | 'right'; readonly gait: Gait; readonly material: string; readonly position: readonly [number, number, number] }
  | { readonly type: 'interact'; readonly characterId: string; readonly interactable: Interactable }
  | { readonly type: 'technique'; readonly characterId: string; readonly position: readonly [number, number, number] }
  | { readonly type: 'overworldAttack'; readonly characterId: string; readonly position: readonly [number, number, number]; readonly yaw: number }
  | { readonly type: 'leaderChanged'; readonly characterId: string; readonly slot: number; readonly previous: string }
  | { readonly type: 'animationState'; readonly state: string; readonly clip: string }
  | { readonly type: 'prompts'; readonly prompts: readonly Interactable[]; readonly selected: number }
  | { readonly type: 'respawn' };

export class OverworldController {
  readonly world: CollisionWorld;
  readonly party: PartyRoster;
  readonly prompts = new PromptList();
  x: number;
  y: number;
  z: number;
  yaw: number;
  velocity: Vec2 = { x: 0, z: 0 };
  verticalSpeed = 0;
  grounded = true;
  walkToggled = false;
  gait: Gait;
  frame: AnimationFrame;
  enabled = true;
  private readonly anim: AnimationStateMachine;
  private stepDistance = 0;
  private nextFoot: 'left' | 'right' = 'left';
  private groundMaterial = 'stone';
  private cooldown = 0;

  constructor(
    readonly rules: LocomotionRules,
    colliders: ConstructorParameters<typeof CollisionWorld>[0],
    public interactables: readonly Interactable[],
    members: readonly string[],
    private spawn: { position: readonly [number, number, number]; yaw: number },
    private killHeight: number,
    private readonly emit: (e: ControllerEvent) => void,
  ) {
    this.world = new CollisionWorld(colliders, rules.capsule);
    this.party = new PartyRoster(members);
    this.anim = new AnimationStateMachine(rules.animation);
    [this.x, this.y, this.z] = spawn.position;
    this.yaw = spawn.yaw;
    this.gait = rules.defaultGait;
    this.frame = this.anim.update(0, 0, this.gait, 0);
    this.refreshPrompts(true);
  }

  get speed(): number {
    return length(this.velocity);
  }

  get leader(): string {
    return this.party.leader;
  }

  /** Replaces the promptable objects (the world layer owns their state; Phase 4). */
  setInteractables(list: readonly Interactable[]): void {
    this.interactables = list;
  }

  /** Respawn point and kill height of the loaded area (an area transition changes them). */
  setSpawn(spawn: { position: readonly [number, number, number]; yaw: number }, killHeight: number): void {
    this.spawn = spawn;
    this.killHeight = killHeight;
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.velocity = { x: 0, z: 0 };
    this.verticalSpeed = 0;
  }

  step(dt: number, input: ControlInput): void {
    const r = this.rules;
    const ctl = this.enabled ? input : NO_INPUT;
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Party switching keeps position, facing and momentum.
    if (ctl.slotPressed !== null) {
      const previous = this.party.leader;
      if (this.party.switchTo(ctl.slotPressed)) this.emit({ type: 'leaderChanged', characterId: this.party.leader, slot: ctl.slotPressed, previous });
    }

    // Gait and target velocity.
    if (ctl.walkTogglePressed) this.walkToggled = !this.walkToggled;
    const dir = moveDirection(ctl.right, ctl.forward, ctl.cameraYaw, r.inputDeadzone);
    const moving = dir.x !== 0 || dir.z !== 0;
    this.gait = selectGait(this.walkToggled, ctl.sprint && moving, r.defaultGait);
    const speed = r.gaits[this.gait].speed;
    const target = { x: dir.x * speed, z: dir.z * speed };
    this.velocity = approachVelocity(this.velocity, target, dt, r.acceleration, r.deceleration);
    if (moving) this.yaw = turnToward(this.yaw, yawOf(dir), r.turnRate * dt);

    // Horizontal move + collision.
    const fromX = this.x;
    const fromZ = this.z;
    const res = this.world.resolveHorizontal(this.x + this.velocity.x * dt, this.z + this.velocity.z * dt, this.y);
    this.x = res.x;
    this.z = res.z;
    if (res.blocked) {
      // Remove the velocity component that pushed into the obstacle (slide along walls).
      const mx = (this.x - fromX) / dt;
      const mz = (this.z - fromZ) / dt;
      this.velocity = { x: Math.abs(mx) < Math.abs(this.velocity.x) ? mx : this.velocity.x, z: Math.abs(mz) < Math.abs(this.velocity.z) ? mz : this.velocity.z };
    }

    // Vertical: step up, snap down slopes / steps, otherwise fall.
    const ground = this.world.groundAt(this.x, this.z, this.y);
    if (ground && ground.height >= this.y - (this.grounded ? r.capsule.snapDistance : 0) - 1e-6) {
      this.y = ground.height;
      this.verticalSpeed = 0;
      this.grounded = true;
      this.groundMaterial = ground.collider.material;
    } else {
      this.grounded = false;
      this.verticalSpeed -= r.gravity * dt;
      this.y += this.verticalSpeed * dt;
      if (ground && this.y <= ground.height) {
        this.y = ground.height;
        this.verticalSpeed = 0;
        this.grounded = true;
        this.groundMaterial = ground.collider.material;
      }
    }
    if (this.y < this.killHeight) {
      this.teleport(...this.spawn.position, this.spawn.yaw);
      this.emit({ type: 'respawn' });
    }

    // Animation + footsteps.
    const travelled = this.grounded ? Math.hypot(this.x - fromX, this.z - fromZ) : 0;
    const previousState = this.frame.state.id;
    this.frame = this.anim.update(dt, this.speed, this.gait, travelled);
    if (this.frame.state.id !== previousState) this.emit({ type: 'animationState', state: this.frame.state.id, clip: this.frame.state.clip });
    if (this.frame.state.footsteps && this.grounded) {
      this.stepDistance += travelled;
      const stride = r.gaits[this.gait].stride;
      while (this.stepDistance >= stride) {
        this.stepDistance -= stride;
        this.emit({ type: 'footstep', characterId: this.party.leader, foot: this.nextFoot, gait: this.gait, material: this.groundMaterial, position: [this.x, this.y, this.z] });
        this.nextFoot = this.nextFoot === 'left' ? 'right' : 'left';
      }
    } else {
      this.stepDistance = 0;
    }

    // Interaction prompts and action hooks.
    if (ctl.promptScroll !== 0 && this.prompts.scroll(ctl.promptScroll)) this.emitPrompts();
    this.refreshPrompts(false);
    if (ctl.interactPressed && this.prompts.selected) this.emit({ type: 'interact', characterId: this.party.leader, interactable: this.prompts.selected });
    if (this.cooldown === 0 && (ctl.techniquePressed || ctl.attackPressed)) {
      const pos = [this.x, this.y, this.z] as const;
      if (ctl.techniquePressed) this.emit({ type: 'technique', characterId: this.party.leader, position: pos });
      else this.emit({ type: 'overworldAttack', characterId: this.party.leader, position: pos, yaw: this.yaw });
      this.cooldown = r.actionCooldown;
    }
  }

  private refreshPrompts(force: boolean): void {
    const entries = interactablesInRange(this.interactables, this.x, this.y, this.z, this.rules.interaction.radius);
    if (this.prompts.update(entries) || force) this.emitPrompts();
  }

  private emitPrompts(): void {
    this.emit({ type: 'prompts', prompts: this.prompts.items.map((e) => e.interactable), selected: this.prompts.selectedIndex });
  }
}
