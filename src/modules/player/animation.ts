import type { AnimationStateDef } from '@models/locomotion';
import type { Gait } from './movement';

/**
 * Data-driven locomotion animation state machine. States come from `rules/locomotion -> animation`
 * and are checked in order; the first whose `when` holds is the target. Switching cross-fades the
 * procedural pose over the target's `blendIn`. A real skeletal animation set can later play
 * `state.clip` with the same blend times (Phase 4/23) without changing the controller.
 */
export interface Pose {
  readonly bobAmplitude: number;
  readonly bobFrequency: number;
  readonly lean: number;
  readonly armSwing: number;
}

export interface AnimationFrame {
  readonly state: AnimationStateDef;
  /** 0..1 progress of the cross-fade into `state`. */
  readonly blend: number;
  /** Blended procedural pose. */
  readonly pose: Pose;
  /** Vertical bob offset (m) and arm swing angle (rad) for this frame. */
  readonly bob: number;
  readonly swing: number;
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function selectAnimationState(states: readonly AnimationStateDef[], speed: number, gait: Gait): AnimationStateDef {
  for (const s of states) {
    if (s.when.minSpeed !== undefined && speed < s.when.minSpeed) continue;
    if (s.when.gait !== undefined && s.when.gait !== gait) continue;
    return s;
  }
  return states[states.length - 1] as AnimationStateDef;
}

export class AnimationStateMachine {
  private current: AnimationStateDef;
  private fromPose: Pose;
  private blendT = 1;
  /** Cycle phase (radians) driven by distance while moving and time while idle. */
  private phase = 0;

  constructor(private readonly states: readonly AnimationStateDef[]) {
    this.current = states[states.length - 1] as AnimationStateDef;
    this.fromPose = this.current.pose;
  }

  get state(): AnimationStateDef {
    return this.current;
  }

  /** Advance with the horizontal speed (m/s), gait and distance travelled this step (m). */
  update(dt: number, speed: number, gait: Gait, distance: number): AnimationFrame {
    const target = selectAnimationState(this.states, speed, gait);
    if (target.id !== this.current.id) {
      this.fromPose = this.pose();
      this.current = target;
      this.blendT = target.blendIn > 0 ? 0 : 1;
    }
    if (this.blendT < 1) this.blendT = Math.min(1, this.blendT + dt / Math.max(1e-6, this.current.blendIn));
    const pose = this.pose();
    const cycles = distance > 0 ? distance * pose.bobFrequency : dt * pose.bobFrequency;
    this.phase = (this.phase + cycles * Math.PI * 2) % (Math.PI * 2);
    return {
      state: this.current,
      blend: this.blendT,
      pose,
      bob: Math.abs(Math.sin(this.phase)) * pose.bobAmplitude,
      swing: Math.sin(this.phase) * pose.armSwing,
    };
  }

  private pose(): Pose {
    const to = this.current.pose;
    const t = this.blendT;
    return {
      bobAmplitude: mix(this.fromPose.bobAmplitude, to.bobAmplitude, t),
      bobFrequency: mix(this.fromPose.bobFrequency, to.bobFrequency, t),
      lean: mix(this.fromPose.lean, to.lean, t),
      armSwing: mix(this.fromPose.armSwing, to.armSwing, t),
    };
  }
}
