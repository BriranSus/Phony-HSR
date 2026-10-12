import type { Collider } from '@models/locomotion';
import { surfaceHeight } from '@modules/player';
import { add, len, scale, sub, type Vec3 } from './math';

/**
 * Sphere cast against the static level colliders (boxes and ramps), by marching the sphere along
 * the ray. Returns the free distance from `from` toward `dir` (unit) before a sphere of `radius`
 * would touch solid geometry, capped at `maxDistance`. The exploration camera uses it from the
 * player's head to its desired position, so the camera is pulled in front of any wall and the
 * player can never be hidden by level geometry.
 */
export function solidAt(colliders: readonly Collider[], p: Vec3, radius: number): boolean {
  for (const c of colliders) {
    const [x0, y0, z0] = c.min;
    const [x1, , z1] = c.max;
    if (p.x < x0 - radius || p.x > x1 + radius || p.z < z0 - radius || p.z > z1 + radius) continue;
    if (p.y < y0 - radius) continue;
    const qx = Math.min(x1, Math.max(x0, p.x));
    const qz = Math.min(z1, Math.max(z0, p.z));
    const top = surfaceHeight(c, qx, qz) ?? c.max[1];
    // Inside the footprint the sphere hits the top surface; outside it, the nearest side face.
    const horizontal = Math.hypot(p.x - qx, p.z - qz);
    if (horizontal === 0 ? p.y < top + radius : p.y < top && horizontal < radius) return true;
    if (horizontal > 0 && p.y >= top && Math.hypot(horizontal, p.y - top) < radius) return true;
  }
  return false;
}

export function sphereCast(colliders: readonly Collider[], from: Vec3, dir: Vec3, maxDistance: number, radius: number, step = 0.05): number {
  if (solidAt(colliders, from, radius)) return 0;
  let free = 0;
  for (let t = step; t <= maxDistance + 1e-9; t += step) {
    if (solidAt(colliders, add(from, scale(dir, t)), radius)) return free;
    free = t;
  }
  return maxDistance;
}

/** True if the straight segment a -> b passes through solid geometry (radius 0 line of sight). */
export function lineOfSightBlocked(colliders: readonly Collider[], a: Vec3, b: Vec3, step = 0.05): boolean {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) return false;
  const dir = scale(d, 1 / l);
  return sphereCast(colliders, a, dir, l, 0.001, step) < l - step;
}
