import type { Collider } from '@models/locomotion';

/**
 * Static collision world for the overworld controller.
 *
 * The character is a vertical capsule; against axis-aligned level geometry its horizontal
 * footprint is a circle (radius) and its vertical extent is [feet, feet + height]. Ground comes
 * from the walkable top surfaces (boxes and ramps up to `maxSlopeDeg`); anything rising more than
 * `stepHeight` above the feet (or any too-steep slope) blocks like a wall and the circle is pushed
 * out of it. Ground snapping keeps the feet on downward slopes and steps within `snapDistance`.
 */
export interface CapsuleSpec {
  readonly radius: number;
  readonly height: number;
  readonly stepHeight: number;
  readonly maxSlopeDeg: number;
  readonly snapDistance: number;
}

export interface GroundHit {
  readonly height: number;
  readonly slopeDeg: number;
  readonly collider: Collider;
}

const EPS = 1e-6;
/** Steep surfaces block once they rise this much above the feet. */
const STEEP_TOLERANCE = 0.02;

/** Top height of a collider at (x, z), or null if (x, z) is outside its footprint. */
export function surfaceHeight(c: Collider, x: number, z: number): number | null {
  const [x0, , z0] = c.min;
  const [x1, y1, z1] = c.max;
  if (x < x0 - EPS || x > x1 + EPS || z < z0 - EPS || z > z1 + EPS) return null;
  if (c.shape === 'box') return y1;
  const t =
    c.rise === '+x' ? (x - x0) / (x1 - x0) : c.rise === '-x' ? (x1 - x) / (x1 - x0) : c.rise === '+z' ? (z - z0) / (z1 - z0) : (z1 - z) / (z1 - z0);
  const k = Math.min(1, Math.max(0, t));
  return c.lowHeight + (y1 - c.lowHeight) * k;
}

/** Slope of a collider's top in degrees (boxes are flat). */
export function slopeDeg(c: Collider): number {
  if (c.shape === 'box') return 0;
  const run = c.rise === '+x' || c.rise === '-x' ? c.max[0] - c.min[0] : c.max[2] - c.min[2];
  return (Math.atan2(c.max[1] - c.lowHeight, run) * 180) / Math.PI;
}

export class CollisionWorld {
  constructor(
    readonly colliders: readonly Collider[],
    readonly capsule: CapsuleSpec,
  ) {}

  private walkable(c: Collider): boolean {
    return slopeDeg(c) <= this.capsule.maxSlopeDeg + EPS;
  }

  /**
   * Highest walkable surface under (x, z) that the feet can stand on: at most `stepHeight` above
   * `feetY` (so the controller steps up small ledges and never pops onto walls).
   */
  groundAt(x: number, z: number, feetY: number): GroundHit | null {
    let best: GroundHit | null = null;
    for (const c of this.colliders) {
      if (!this.walkable(c)) continue;
      const h = surfaceHeight(c, x, z);
      if (h === null || h > feetY + this.capsule.stepHeight + EPS) continue;
      if (!best || h > best.height) best = { height: h, slopeDeg: slopeDeg(c), collider: c };
    }
    return best;
  }

  /** True if the collider blocks a capsule standing with its feet at `feetY` near (x, z). */
  private blocks(c: Collider, px: number, pz: number, feetY: number): boolean {
    if (c.min[1] >= feetY + this.capsule.height) return false; // entirely above the head
    const qx = Math.min(c.max[0], Math.max(c.min[0], px));
    const qz = Math.min(c.max[2], Math.max(c.min[2], pz));
    const top = surfaceHeight(c, qx, qz) ?? c.max[1];
    if (!this.walkable(c)) return top > feetY + STEEP_TOLERANCE;
    return top > feetY + this.capsule.stepHeight + EPS;
  }

  /**
   * Pushes the footprint circle at (x, z) out of every blocking collider (a few iterations resolve
   * corners). Returns the corrected position.
   */
  resolveHorizontal(x: number, z: number, feetY: number): { x: number; z: number; blocked: boolean } {
    const r = this.capsule.radius;
    let px = x;
    let pz = z;
    let blocked = false;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const c of this.colliders) {
        const [x0, , z0] = c.min;
        const [x1, , z1] = c.max;
        if (px < x0 - r || px > x1 + r || pz < z0 - r || pz > z1 + r) continue;
        if (!this.blocks(c, px, pz, feetY)) continue;
        const qx = Math.min(x1, Math.max(x0, px));
        const qz = Math.min(z1, Math.max(z0, pz));
        const dx = px - qx;
        const dz = pz - qz;
        const d = Math.hypot(dx, dz);
        if (d >= r - EPS) continue;
        if (d > EPS) {
          px = qx + (dx / d) * r;
          pz = qz + (dz / d) * r;
        } else {
          // Centre inside the footprint: leave through the nearest face.
          const exits = [
            { d: px - x0, x: x0 - r, z: pz },
            { d: x1 - px, x: x1 + r, z: pz },
            { d: pz - z0, x: px, z: z0 - r },
            { d: z1 - pz, x: px, z: z1 + r },
          ].sort((a, b) => a.d - b.d);
          const e = exits[0]!;
          px = e.x;
          pz = e.z;
        }
        moved = true;
        blocked = true;
      }
      if (!moved) break;
    }
    return { x: px, z: pz, blocked };
  }
}
