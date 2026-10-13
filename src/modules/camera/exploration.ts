import type { CameraRules } from '@models/camera';
import type { Collider } from '@models/locomotion';
import { turnToward, wrapAngle } from '@modules/player';
import { add, clamp, len, orbitDirection, scale, smoothing, v3, type CameraPose, type Vec3 } from './math';
import { lineOfSightBlocked, sphereCast } from './occlusion';

/** Max pivot lag behind the head (m). */
const PIVOT_MAX_LAG = 0.12;
/** Easing rate of the collision yaw / lift offsets (1/s). */
const AVOID_SMOOTHING = 7;

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
  /** Collision avoidance currently applied: yaw offset (rad) and pitch lift (rad). */
  yawOffset = 0;
  liftOffset = 0;

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
    this.yawOffset = 0;
    this.liftOffset = 0;
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

    // Pivot: the player's head with a small damped lag (smooths stairs and landings). The lag is
    // capped so the pivot never strays from the point that must stay visible.
    const head = v3(target.x, target.y + r.focusHeight, target.z);
    this.focus = this.focus === null || dt === 0 ? head : add(this.focus, scale(add(head, scale(this.focus, -1)), smoothing(r.followSmoothing, dt)));
    const lag = add(this.focus, scale(head, -1));
    if (len(lag) > PIVOT_MAX_LAG) this.focus = add(head, scale(lag, PIVOT_MAX_LAG / len(lag)));
    const aheadGoal = v3(vel.x * r.lookAhead, 0, vel.z * r.lookAhead);
    this.ahead = dt === 0 ? aheadGoal : add(this.ahead, scale(add(aheadGoal, scale(this.ahead, -1)), smoothing(r.lookAheadSmoothing, dt)));

    // Collision. Cast from the pivot toward the requested direction; if less than a comfortable
    // distance is free (wall hug, corner), search yaw offsets (15 deg steps, small ones preferred)
    // and a capped pitch lift for the freest direction, like the reference game's camera sliding
    // along walls. The effective offset eases in and out so the view never snaps.
    const c = r.collision;
    const pivot = this.focus;
    const comfort = Math.min(this.zoomSmoothed, c.comfortDistance);
    const maxPitch = Math.max(this.pitch, c.maxLiftPitch);
    const cast = (yawOff: number, lift: number, reach = this.zoomSmoothed, step = 0.05): number =>
      sphereCast(this.colliders, pivot, orbitDirection(this.yaw + yawOff, Math.min(maxPitch, this.pitch + lift)), reach, c.radius, step);
    let goal = { off: 0, lift: 0, free: cast(0, 0) };
    if (goal.free < comfort) {
      let bestScore = goal.free;
      const step = (15 * Math.PI) / 180;
      const limit = (c.yawSearchDeg * Math.PI) / 180;
      for (let k = 1; k * step <= limit + 1e-9; k++) {
        for (const sign of [1, -1]) {
          for (const lift of [0, 0.2, 0.4]) {
            const off = sign * k * step;
            // Probe only up to the comfort distance (coarser steps) to keep the search cheap.
            const free = cast(off, lift, comfort, 0.1);
            const score = Math.min(free, comfort) - 0.25 * Math.abs(off) - 0.3 * lift;
            if (score > bestScore + 1e-6) {
              bestScore = score;
              goal = { off, lift, free };
            }
          }
        }
      }
    }
    if (goal.off !== 0 || goal.lift !== 0) goal = { ...goal, free: cast(goal.off, goal.lift) };
    if (dt === 0) {
      this.yawOffset = goal.off;
      this.liftOffset = goal.lift;
    } else {
      const k = smoothing(AVOID_SMOOTHING, dt);
      this.yawOffset += wrapAngle(goal.off - this.yawOffset) * k;
      this.liftOffset += (goal.lift - this.liftOffset) * k;
    }
    let free = cast(this.yawOffset, this.liftOffset);
    if (free < Math.min(goal.free, c.minDistance) - 1e-6) {
      // The eased direction is still squeezed below the minimum: jump to the free one.
      this.yawOffset = goal.off;
      this.liftOffset = goal.lift;
      free = goal.free;
    }
    const dir = orbitDirection(this.yaw + this.yawOffset, Math.min(maxPitch, this.pitch + this.liftOffset));
    this.distance = free < this.distance || dt === 0 ? free : Math.min(free, this.distance + c.recoverSpeed * dt);

    const right = v3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    let position = add(add(pivot, scale(dir, this.distance)), scale(right, r.shoulderOffset));
    // Final guard: the line from the camera to the player's actual head must be clear.
    if (lineOfSightBlocked(this.colliders, position, head)) {
      const toCam = add(position, scale(head, -1));
      const l = len(toCam);
      const clear = sphereCast(this.colliders, head, scale(toCam, 1 / l), l, 0.05);
      position = add(head, scale(toCam, Math.max(0.3, clear) / l));
      this.distance = Math.min(this.distance, len(add(position, scale(pivot, -1))));
    }
    // Look-ahead fades out as walls pull the camera in, keeping the player framed.
    const aheadScale = clamp((this.distance - c.minDistance) / 2, 0, 1);
    const lookAt = add(pivot, scale(this.ahead, aheadScale));
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
