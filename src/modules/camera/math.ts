import type { EasingId } from '@models/camera';

/**
 * Camera math shared by the exploration rig, shots and the director. Pure functions on plain
 * vectors so everything is unit-testable without WebGL. Yaw convention matches the player: yaw 0
 * looks along +Z, and a unit facing `yaw` has its right-hand side at (-cos yaw, 0, sin yaw).
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What the director outputs each frame; the app applies it to the THREE camera. */
export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
  /** Roll around the view axis (rad), used by shake. */
  readonly roll: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Frame-rate independent exponential smoothing factor for a rate in 1/s. */
export const smoothing = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export const EASE: Readonly<Record<EasingId, (t: number) => number>> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

export const ease = (id: EasingId, t: number): number => EASE[id](clamp(t, 0, 1));

/** Direction from the orbit focus to the camera for a yaw / pitch (pitch > 0 = camera above). */
export function orbitDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return v3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

/** Camera position orbiting `focus` at `distance`. */
export const orbitPosition = (focus: Vec3, yaw: number, pitch: number, distance: number): Vec3 => add(focus, scale(orbitDirection(yaw, pitch), distance));

/** Unit-local offset (x right, y up, z forward) to world space for a unit facing `yaw`. */
export function localToWorld(origin: Vec3, yaw: number, offset: readonly [number, number, number]): Vec3 {
  const [x, y, z] = offset;
  return v3(origin.x - Math.cos(yaw) * x + Math.sin(yaw) * z, origin.y + y, origin.z + Math.sin(yaw) * x + Math.cos(yaw) * z);
}

/** Centripetal-free uniform Catmull-Rom between p1 and p2 (p0 / p3 are neighbours). */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return v3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return { position: lerpV(a.position, b.position, t), target: lerpV(a.target, b.target, t), fov: lerp(a.fov, b.fov, t), roll: lerp(a.roll, b.roll, t) };
}
