/**
 * Pure locomotion math (no THREE, no DOM), shared by the controller and the unit tests.
 *
 * Conventions: Y is up. A yaw of 0 faces +Z; yaw increases toward +X. Facing vector for a yaw is
 * (sin yaw, 0, cos yaw). The camera looks along its yaw's facing vector, so its screen-right is
 * (-cos yaw, 0, sin yaw).
 */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export type Gait = 'walk' | 'run' | 'sprint';

export const facing = (yaw: number): Vec2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
export const yawOf = (v: Vec2): number => Math.atan2(v.x, v.z);
export const length = (v: Vec2): number => Math.hypot(v.x, v.z);

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r <= 0) r += Math.PI * 2;
  return r - Math.PI;
}

/**
 * Camera-relative move direction. `right` / `forward` are the raw input axes in [-1, 1] (keys or a
 * stick); the result has magnitude <= 1 (diagonals are normalised, partial stick tilt is kept),
 * or 0 inside the deadzone.
 */
export function moveDirection(right: number, forward: number, cameraYaw: number, deadzone: number): Vec2 {
  const mag = Math.hypot(right, forward);
  if (mag <= deadzone || mag === 0) return { x: 0, z: 0 };
  const scale = Math.min(1, mag) / mag;
  const f = facing(cameraYaw);
  const r = { x: -Math.cos(cameraYaw), z: Math.sin(cameraYaw) };
  return { x: (f.x * forward + r.x * right) * scale, z: (f.z * forward + r.z * right) * scale };
}

/** Gait from the walk toggle and the sprint button (sprint wins while held). */
export function selectGait(walkToggled: boolean, sprintHeld: boolean, defaultGait: 'walk' | 'run'): Gait {
  if (sprintHeld) return 'sprint';
  if (walkToggled) return defaultGait === 'run' ? 'walk' : 'run';
  return defaultGait;
}

/**
 * Moves the current horizontal velocity toward the target with a constant rate: `acceleration`
 * while speeding up, `deceleration` while slowing down or stopping.
 */
export function approachVelocity(current: Vec2, target: Vec2, dt: number, acceleration: number, deceleration: number): Vec2 {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return target;
  const rate = length(target) >= length(current) ? acceleration : deceleration;
  const step = rate * dt;
  if (dist <= step) return target;
  return { x: current.x + (dx / dist) * step, z: current.z + (dz / dist) * step };
}

/** Rotates `yaw` toward `target` by at most `maxStep` radians along the shortest arc. */
export function turnToward(yaw: number, target: number, maxStep: number): number {
  const delta = wrapAngle(target - yaw);
  if (Math.abs(delta) <= maxStep) return wrapAngle(target);
  return wrapAngle(yaw + Math.sign(delta) * maxStep);
}
