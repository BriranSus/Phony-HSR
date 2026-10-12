import type { CameraRules } from '@models/camera';
import type { Collider } from '@models/locomotion';
import { turnToward } from '@modules/player';
import { add, clamp, len, orbitDirection, scale, smoothing, v3, type CameraPose, type Vec3 } from './math';
import { sphereCast } from './occlusion';

/** Highest pitch the collision lift may use (camera almost straight above the player). */
const LIFT_PITCH_LIMIT = 1.45;

/** Raw camera input for one frame (the rig applies tuning and the player's settings). */
export interface CameraInput {
  /** Mouse movement (px) that rotates the camera this frame (drag or pointer lock). */
  readonly mouseDx: number;
  readonly mouseDy: number;
  /** Key / stick axes in [-1, 1]: yaw (right +) and pitch (up +). */
  readonly yawAxis: number;
  readonly pitchAxis: number;
  /** Wheel delta (browser units, + = zoom out) and key zoom axis (+ = out). */
  readonly wheel: number;
  readonly zoomAxis: number;
}

export const NO_CAMERA_INPUT: CameraInput = { mouseDx: 0, mouseDy: 0, yawAxis: 0, pitchAxis: 0, wheel: 0, zoomAxis: 0 };

export interface CameraSettings {
  readonly fov: number;
  readonly orbitSensitivity: number;
  readonly zoomSensitivity: number;
  readonly invertY: boolean;
  readonly autoRecenter: boolean;
}

/** What the rig follows (the player controller satisfies it). */
export interface FollowTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Facing yaw, for auto-recenter. */
  readonly yaw?: number;
  /** Horizontal velocity, for look-ahead and recenter. */
  readonly velocity?: { readonly x: number; readonly z: number };
}

/**
 * Exploration camera in the reference game's style: a third-person orbit around the player's
 * head with yaw / pitch from the mouse, keys or right stick, clamped pitch, a smooth zoom range,
 * a slight look-ahead in the direction of travel, damping, and a gentle auto-recenter behind the
 * player once they move without touching the camera for `recenter.delay` seconds.
 *
 * Collision: every frame a sphere is cast from the player's head toward the desired camera
 * position against the level colliders; the camera is pulled in instantly to the free distance
 * and eases back out at `collision.recoverSpeed`, so a wall can never sit between the camera and
 * the player.
 */
export class ExplorationRig {
  yaw: number;
  pitch: number;
  /** Requested zoom (m) and its smoothed value. */
  zoom: number;
  zoomSmoothed: number;
  /** Distance actually used after collision. */
  distance: number;
  /** Seconds since the last camera input. */
  idle = 0;
  private focus: Vec3 | null = null;
  private ahead: Vec3 = v3(0, 0, 0);
  private lastPose: CameraPose | null = null;
  /** Effective pitch after the wall-squeeze lift (>= pitch). */
  private liftPitch = -Infinity;

  constructor(
    private readonly rules: CameraRules['exploration'],
    private readonly colliders: readonly Collider[],
    private readonly settings: () => CameraSettings,
    yaw = 0,
  ) {
    this.yaw = yaw;
    this.pitch = rules.pitch.default;
    this.zoom = rules.distance.default;
    this.zoomSmoothed = this.zoom;
    this.distance = this.zoom;
  }

  get pose(): CameraPose | null {
    return this.lastPose;
  }

  /** Manual recenter (X / R3): swing behind the player's facing at 3x the auto-recenter speed. */
  requestRecenter(): void {
    this.recentering = true;
  }

  private recentering = false;

  /** Snap behind the target (spawn, teleport, leaving a scripted shot cut). */
  reset(target: FollowTarget, yaw: number): void {
    this.yaw = yaw;
    this.pitch = this.rules.pitch.default;
    this.focus = null;
    this.ahead = v3(0, 0, 0);
    this.distance = this.zoomSmoothed;
    this.idle = 0;
    this.update(0, target, NO_CAMERA_INPUT);
  }

  update(dt: number, target: FollowTarget, input: CameraInput): CameraPose {
    const r = this.rules;
    const s = this.settings();
    const inv = s.invertY ? -1 : 1;

    // Rotation and zoom from input.
    const mouse = r.mouseRadiansPerPixel * s.orbitSensitivity;
    const turning = input.mouseDx !== 0 || input.mouseDy !== 0 || input.yawAxis !== 0 || input.pitchAxis !== 0;
    this.yaw -= input.mouseDx * mouse + input.yawAxis * r.rotateSpeed * s.orbitSensitivity * dt;
    this.pitch += (input.mouseDy * mouse - input.pitchAxis * r.rotateSpeed * 0.6 * s.orbitSensitivity * dt) * inv;
    this.pitch = clamp(this.pitch, r.pitch.min, r.pitch.max);
    if (input.wheel !== 0 || input.zoomAxis !== 0) {
      this.zoom *= Math.exp(input.wheel * r.distance.wheelStep * s.zoomSensitivity + input.zoomAxis * dt * 1.2);
      this.zoom = clamp(this.zoom, r.distance.min, r.distance.max);
    }
    this.zoomSmoothed += (this.zoom - this.zoomSmoothed) * (dt === 0 ? 1 : smoothing(r.distance.smoothing, dt));
    this.idle = turning ? 0 : this.idle + dt;

    // Auto-recenter behind a moving player after the idle delay.
    const vel = target.velocity ?? { x: 0, z: 0 };
    const speed = Math.hypot(vel.x, vel.z);
    if (this.recentering && target.yaw !== undefined) {
      this.yaw = turnToward(this.yaw, target.yaw, r.recenter.speed * 3 * dt);
      this.pitch += (r.pitch.default - this.pitch) * smoothing(r.recenter.speed * 2, dt);
      if (Math.abs(this.yaw - target.yaw) < 1e-3 || turning) this.recentering = false;
    } else if (s.autoRecenter && target.yaw !== undefined && this.idle >= r.recenter.delay && speed >= r.recenter.minPlayerSpeed) {
      this.yaw = turnToward(this.yaw, target.yaw, r.recenter.speed * dt);
      this.pitch += (r.pitch.default - this.pitch) * smoothing(r.recenter.speed * 0.5, dt);
    }

    // Pivot: the player's head, damped. The camera orbits and collides around the pivot; the
    // look-ahead only shifts the look target, so the camera always stays behind the player.
    const head = v3(target.x, target.y + r.focusHeight, target.z);
    this.focus = this.focus === null || dt === 0 ? head : add(this.focus, scale(add(head, scale(this.focus, -1)), smoothing(r.followSmoothing, dt)));
    const lag = add(this.focus, scale(head, -1));
    if (len(lag) > 0.75) this.focus = add(head, scale(lag, 0.75 / len(lag)));
    const aheadGoal = v3(vel.x * r.lookAhead, 0, vel.z * r.lookAhead);
    this.ahead = dt === 0 ? aheadGoal : add(this.ahead, scale(add(aheadGoal, scale(this.ahead, -1)), smoothing(r.lookAheadSmoothing, dt)));

    // Collision: pull in instantly, ease back out. If even the minimum distance is blocked (the
    // player hugging a wall or corner), lift the camera over the player by raising the pitch until
    // there is room, so it never ends up inside or behind the wall.
    const castFrom = this.focus;
    let pitch = this.pitch;
    let free = sphereCast(this.colliders, castFrom, orbitDirection(this.yaw, pitch), this.zoomSmoothed, r.collision.radius);
    while (free < r.collision.minDistance && pitch < LIFT_PITCH_LIMIT) {
      pitch = Math.min(LIFT_PITCH_LIMIT, pitch + 0.05);
      free = sphereCast(this.colliders, castFrom, orbitDirection(this.yaw, pitch), this.zoomSmoothed, r.collision.radius);
    }
    this.liftPitch = pitch > this.liftPitch || dt === 0 ? pitch : this.liftPitch + (pitch - this.liftPitch) * smoothing(6, dt);
    if (this.liftPitch > pitch) {
      // Easing back down: only accept the eased pitch if it is still free at the current distance.
      const eased = sphereCast(this.colliders, castFrom, orbitDirection(this.yaw, this.liftPitch), this.zoomSmoothed, r.collision.radius);
      if (eased >= Math.min(free, this.distance)) {
        pitch = this.liftPitch;
        free = eased;
      } else this.liftPitch = pitch;
    }
    const dir = orbitDirection(this.yaw, pitch);
    this.distance = free < this.distance || dt === 0 ? free : Math.min(free, this.distance + r.collision.recoverSpeed * dt);

    const right = v3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const position = add(add(castFrom, scale(dir, this.distance)), scale(right, r.shoulderOffset));
    // Look-ahead fades out as walls pull the camera in, keeping the player framed.
    const aheadScale = clamp((this.distance - r.collision.minDistance) / 2, 0, 1);
    const lookAt = add(castFrom, scale(this.ahead, aheadScale));
    this.lastPose = { position, target: lookAt, fov: s.fov, roll: 0 };
    return this.lastPose;
  }
}

/**
 * The exploration rig as a director provider. It also implements the `ExplorationCamera` contract
 * the player controller relies on (only `yaw` is read), replacing the Phase-2 follow camera.
 * Camera input is read through `input()` and ignored while the director gates input.
 */
export class ExplorationProvider {
  readonly id = 'exploration';
  readonly mode = 'exploration' as const;
  readonly gatesInput = false;
  readonly letterbox = false;
  readonly done = false;
  private target: FollowTarget = { x: 0, y: 0, z: 0 };

  constructor(
    readonly rig: ExplorationRig,
    readonly priority: number,
    private readonly input: () => CameraInput,
  ) {}

  get yaw(): number {
    return this.rig.yaw;
  }

  /** `ExplorationCamera.update`: record the follow target (the director evaluates the pose). */
  follow(target: FollowTarget): void {
    this.target = target;
  }

  reset(target: FollowTarget, yaw: number): void {
    this.target = target;
    this.rig.reset(target, yaw);
  }

  update(dt: number): CameraPose {
    return this.rig.update(dt, this.target, dt > 0 ? this.input() : NO_CAMERA_INPUT);
  }
}
