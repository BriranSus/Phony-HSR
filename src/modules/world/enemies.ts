import type { WorldRules } from '@models/world';
import { wrapAngle } from '@modules/player';

/**
 * Overworld enemy AI as a small state machine (pure, driven by the runtime):
 *
 *   idle / patrol --senses player--> alert --(alertSeconds)--> chase --contact--> encounter
 *   chase --player beyond loseRadius for loseSeconds--> return --home--> idle / patrol
 *   any --Technique--> stunned --(stunSeconds)--> alert (if it senses the player) or return
 *
 * Detection is a radius with a field-of-view cone plus a small all-round close radius, gated by
 * line of sight (the runtime supplies `canSee`).
 */
export type EnemyState = 'idle' | 'patrol' | 'alert' | 'chase' | 'return' | 'stunned';
export type EnemyParams = WorldRules['enemy'];

export interface AIContext {
  readonly px: number;
  readonly pz: number;
  readonly canSee: boolean;
  /** Moves from (x, z) toward (tx, tz) by at most `maxStep`, resolving collisions. */
  move(x: number, z: number, tx: number, tz: number, maxStep: number): { x: number; z: number };
}

export interface AIResult {
  /** Entered `alert` this step (noticed the player). */
  readonly detected: boolean;
  /** Reached the player while alert / chasing. */
  readonly contact: boolean;
}

const ARRIVE = 0.25;

export class EnemyAI {
  state: EnemyState;
  x: number;
  z: number;
  yaw: number;
  private timer = 0;
  private lost = 0;
  private pause = 0;
  private waypoint = 0;

  constructor(
    readonly home: { readonly x: number; readonly z: number },
    yaw: number,
    readonly patrol: ReadonlyArray<readonly [number, number]>,
    private readonly params: EnemyParams,
    private readonly detectionRadius = params.detectionRadius,
  ) {
    this.x = home.x;
    this.z = home.z;
    this.yaw = yaw;
    this.state = patrol.length > 1 ? 'patrol' : 'idle';
  }

  private get restState(): EnemyState {
    return this.patrol.length > 1 ? 'patrol' : 'idle';
  }

  stun(seconds = this.params.stunSeconds): void {
    this.state = 'stunned';
    this.timer = seconds;
    this.lost = 0;
  }

  /** Does the enemy notice a player at (px, pz)? */
  senses(px: number, pz: number, canSee: boolean): boolean {
    const dx = px - this.x;
    const dz = pz - this.z;
    const d = Math.hypot(dx, dz);
    if (!canSee || d > this.detectionRadius) return false;
    if (d <= this.params.closeRadius) return true;
    const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.yaw));
    return off <= (this.params.detectionFovDeg * Math.PI) / 360;
  }

  private face(tx: number, tz: number): void {
    if (Math.hypot(tx - this.x, tz - this.z) > 1e-3) this.yaw = Math.atan2(tx - this.x, tz - this.z);
  }

  private walk(ctx: AIContext, tx: number, tz: number, speed: number, dt: number): boolean {
    this.face(tx, tz);
    const p = ctx.move(this.x, this.z, tx, tz, speed * dt);
    this.x = p.x;
    this.z = p.z;
    return Math.hypot(tx - this.x, tz - this.z) <= ARRIVE;
  }

  step(dt: number, ctx: AIContext): AIResult {
    const dist = Math.hypot(ctx.px - this.x, ctx.pz - this.z);
    let detected = false;
    let contact = false;
    const alert = (): void => {
      this.state = 'alert';
      this.timer = this.params.alertSeconds;
      this.face(ctx.px, ctx.pz);
      detected = true;
    };
    switch (this.state) {
      case 'idle':
      case 'patrol': {
        if (this.senses(ctx.px, ctx.pz, ctx.canSee)) {
          alert();
          break;
        }
        if (this.state === 'patrol') {
          if (this.pause > 0) this.pause -= dt;
          else {
            const [tx, tz] = this.patrol[this.waypoint]!;
            if (this.walk(ctx, tx, tz, this.params.patrolSpeed, dt)) {
              this.waypoint = (this.waypoint + 1) % this.patrol.length;
              this.pause = this.params.patrolPause;
            }
          }
        }
        break;
      }
      case 'alert':
        this.face(ctx.px, ctx.pz);
        this.timer -= dt;
        if (dist <= this.params.contactRadius) contact = true;
        else if (this.timer <= 0) this.state = dist <= this.params.loseRadius ? 'chase' : 'return';
        break;
      case 'chase':
        this.walk(ctx, ctx.px, ctx.pz, this.params.chaseSpeed, dt);
        this.lost = dist > this.params.loseRadius ? this.lost + dt : 0;
        if (this.lost >= this.params.loseSeconds) {
          this.state = 'return';
          this.lost = 0;
        } else if (Math.hypot(ctx.px - this.x, ctx.pz - this.z) <= this.params.contactRadius) contact = true;
        break;
      case 'return':
        if (this.senses(ctx.px, ctx.pz, ctx.canSee)) {
          alert();
        } else if (this.walk(ctx, this.home.x, this.home.z, this.params.returnSpeed, dt)) {
          this.state = this.restState;
        }
        break;
      case 'stunned':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.senses(ctx.px, ctx.pz, ctx.canSee)) alert();
          else this.state = 'return';
        }
        break;
    }
    return { detected, contact };
  }
}
