import type { ShakeProfile } from '@models/camera';
import { v3, type Vec3 } from './math';

/**
 * Trauma-based camera shake: profiles add trauma (capped at 1), which decays linearly; the visible
 * shake is proportional to trauma^2 so small hits stay subtle. Offsets use smooth deterministic
 * noise (summed sines), scaled by the player's shake-intensity setting (0 disables shake).
 */
export class CameraShake {
  trauma = 0;
  private decay = 1;
  private maxOffset = 0;
  private maxRoll = 0;
  private frequency = 10;
  private time = 0;

  add(profile: ShakeProfile): void {
    // While shaking, the strongest active profile defines the feel.
    const active = this.trauma > 0;
    this.maxOffset = active ? Math.max(this.maxOffset, profile.maxOffset) : profile.maxOffset;
    this.maxRoll = active ? Math.max(this.maxRoll, profile.maxRoll) : profile.maxRoll;
    this.decay = active ? Math.min(this.decay, profile.decay) : profile.decay;
    this.frequency = profile.frequency;
    this.trauma = Math.min(1, this.trauma + profile.trauma);
  }

  update(dt: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
  }

  /** Current positional offset and roll, scaled by `intensity` (0..1). */
  sample(intensity: number): { offset: Vec3; roll: number } {
    const k = this.trauma * this.trauma * intensity;
    if (k === 0) return { offset: v3(0, 0, 0), roll: 0 };
    const t = this.time * this.frequency;
    const n = (a: number, b: number): number => (Math.sin(t * a + b) + Math.sin(t * a * 1.7 + b * 2.3) * 0.5) / 1.5;
    return { offset: v3(n(1.0, 0.3) * this.maxOffset * k, n(1.3, 1.9) * this.maxOffset * k, n(0.9, 4.1) * this.maxOffset * k), roll: n(1.1, 2.7) * this.maxRoll * k };
  }
}
