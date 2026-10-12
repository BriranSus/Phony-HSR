import type { Anchor, CameraShot } from '@models/camera';
import { yawOf } from '@modules/player';
import { catmullRom, ease, lerp, lerpV, localToWorld, v3, type CameraPose, type Vec3 } from './math';

/** Resolves a named unit ("player", a marker / enemy / NPC id) to its position and facing. */
export type UnitResolver = (unit: string) => { readonly position: Vec3; readonly yaw: number } | undefined;

export function resolveAnchor(a: Anchor, units: UnitResolver): Vec3 {
  if ('point' in a) return v3(...a.point);
  const get = (id: string) => {
    const u = units(id);
    if (!u) throw new Error(`camera anchor "${id}" is not in the scene`);
    return u;
  };
  if ('centroid' in a) {
    const ps = a.centroid.map((id) => get(id).position);
    const c = v3(ps.reduce((s, p) => s + p.x, 0) / ps.length, ps.reduce((s, p) => s + p.y, 0) / ps.length, ps.reduce((s, p) => s + p.z, 0) / ps.length);
    return localToWorld(c, 0, a.offset);
  }
  const u = get(a.unit);
  if ('toward' in a) {
    const t = get(a.toward).position;
    return localToWorld(u.position, yawOf({ x: t.x - u.position.x, z: t.z - u.position.z }), a.offset);
  }
  return localToWorld(u.position, u.yaw, a.offset);
}

/**
 * Evaluates a data-defined shot at time `t` (s): keyframes give position / look target / FOV,
 * interpolated with each key's easing (Catmull-Rom through the positions for `spline` shots), plus
 * the FOV punch envelope. Anchors are resolved every frame, so shots track moving units.
 */
export function evaluateShot(shot: CameraShot, t: number, units: UnitResolver): CameraPose {
  const keys = shot.keys;
  const pos = keys.map((k) => resolveAnchor(k.position, units));
  const look = keys.map((k) => resolveAnchor(k.lookAt, units));
  let i = keys.length - 1;
  for (let k = 0; k < keys.length - 1; k++) {
    if (t < (keys[k + 1]?.t ?? 0)) {
      i = k;
      break;
    }
  }
  let position: Vec3;
  let target: Vec3;
  let fov: number;
  if (i >= keys.length - 1 || t <= (keys[0]?.t ?? 0)) {
    const k = t <= (keys[0]?.t ?? 0) ? 0 : keys.length - 1;
    position = pos[k]!;
    target = look[k]!;
    fov = keys[k]!.fov;
  } else {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const u = ease(b.ease, (t - a.t) / (b.t - a.t));
    position = shot.spline ? catmullRom(pos[Math.max(0, i - 1)]!, pos[i]!, pos[i + 1]!, pos[Math.min(pos.length - 1, i + 2)]!, u) : lerpV(pos[i]!, pos[i + 1]!, u);
    target = lerpV(look[i]!, look[i + 1]!, u);
    fov = lerp(a.fov, b.fov, u);
  }
  return { position, target, fov: fov + fovPunch(shot, t), roll: 0 };
}

/** FOV punch: a fast 60 ms attack to `degrees`, then a quadratic release over `duration`. */
export function fovPunch(shot: Pick<CameraShot, 'fovPunch'>, t: number): number {
  const p = shot.fovPunch;
  if (!p) return 0;
  const x = t - p.at;
  if (x < 0 || x > p.duration) return 0;
  const attack = 0.06;
  if (x < attack) return p.degrees * (x / attack);
  const r = (x - attack) / (p.duration - attack);
  return p.degrees * (1 - r) * (1 - r);
}
