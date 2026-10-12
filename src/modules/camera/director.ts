import type { Blend, CameraModeId, CameraRules, CameraShot } from '@models/camera';
import { add, ease, lerpPose, type CameraPose } from './math';
import { CameraShake } from './shake';
import { evaluateShot, type UnitResolver } from './shots';

/**
 * A camera mode instance on the director's stack. The director owns the single scene camera:
 * every frame it asks the top provider for a pose and applies blends, shake and letterbox.
 */
export interface CameraProvider {
  readonly id: string;
  readonly mode: CameraModeId;
  readonly priority: number;
  /** Scripted modes gate the player's movement input while they are active. */
  readonly gatesInput: boolean;
  readonly letterbox: boolean;
  readonly blendIn?: Blend;
  readonly blendOut?: Blend;
  /** Pose for this frame; `dt` is 0 while the provider is not on top. */
  update(dt: number): CameraPose;
  /** True when the provider has finished and should be popped. */
  readonly done: boolean;
}

interface Entry {
  readonly provider: CameraProvider;
  readonly order: number;
  readonly onDone?: () => void;
}

interface ActiveBlend {
  readonly from: CameraPose;
  readonly blend: Exclude<Blend, 'cut'>;
  elapsed: number;
}

/**
 * Stack / priority camera director.
 * - `push` adds a provider; the active one is the highest priority (latest wins ties).
 * - Changing the active provider blends from the last output pose with the new provider's
 *   `blendIn` (or the mode default from `camera/rules.blends`); popping the top uses its
 *   `blendOut` (or the default of the mode being returned to). `cut` switches instantly.
 * - Shake (trauma) and the letterbox amount are applied on top of the active pose.
 */
export class CameraDirector {
  private readonly stack: Entry[] = [];
  private order = 0;
  private active: CameraProvider | null = null;
  private blending: ActiveBlend | null = null;
  private output: CameraPose | null = null;
  private readonly shaker = new CameraShake();
  /** 0..1 letterbox amount (animated). */
  letterbox = 0;

  constructor(
    private readonly rules: CameraRules,
    private readonly shakeIntensity: () => number,
  ) {}

  get mode(): CameraModeId | null {
    return this.active?.mode ?? null;
  }

  get inputGated(): boolean {
    return this.active?.gatesInput ?? false;
  }

  get pose(): CameraPose | null {
    return this.output;
  }

  get trauma(): number {
    return this.shaker.trauma;
  }

  get isBlending(): boolean {
    return this.blending !== null;
  }

  providers(): readonly CameraProvider[] {
    return this.stack.map((e) => e.provider);
  }

  push(provider: CameraProvider, onDone?: () => void): void {
    this.stack.push({ provider, order: this.order++, onDone });
  }

  remove(provider: CameraProvider): void {
    const i = this.stack.findIndex((e) => e.provider === provider);
    if (i < 0) return;
    const [e] = this.stack.splice(i, 1);
    if (provider === this.active) this.pendingBlendOut = provider.blendOut;
    e?.onDone?.();
  }

  /** Play a data-defined shot; resolves when it ends (or is stopped). */
  playShot(shot: CameraShot, units: UnitResolver): Promise<void> {
    return new Promise((resolve) => this.push(new ShotProvider(shot, units, this.rules.priorities[shot.mode] ?? 0, (p) => this.shake(p)), resolve));
  }

  /** Remove every scripted shot (back to the base mode). */
  stopShots(): void {
    for (const e of [...this.stack]) if (e.provider instanceof ShotProvider) this.remove(e.provider);
  }

  shake(profileId: string): void {
    const p = this.rules.shakeProfiles[profileId];
    if (!p) throw new Error(`unknown shake profile "${profileId}"`);
    this.shaker.add(p);
  }

  private pendingBlendOut: Blend | undefined = undefined;

  update(dt: number): CameraPose | null {
    // Pop finished providers.
    for (const e of [...this.stack]) if (e.provider.done) this.remove(e.provider);
    const top = this.top();
    if (!top) return this.output;
    if (top !== this.active) {
      const blend = this.pendingBlendOut ?? top.blendIn ?? this.rules.blends[top.mode] ?? 'cut';
      this.pendingBlendOut = undefined;
      this.blending = this.output && blend !== 'cut' ? { from: this.output, blend, elapsed: 0 } : null;
      this.active = top;
    }
    for (const e of this.stack) if (e.provider !== top) e.provider.update(0);
    let pose = top.update(dt);
    if (this.blending) {
      this.blending.elapsed += dt;
      const t = this.blending.elapsed / this.blending.blend.duration;
      if (t >= 1) this.blending = null;
      else pose = lerpPose(this.blending.from, pose, ease(this.blending.blend.ease, t));
    }
    this.output = pose;
    this.shaker.update(dt);
    const goal = top.letterbox ? 1 : 0;
    this.letterbox += Math.sign(goal - this.letterbox) * Math.min(Math.abs(goal - this.letterbox), dt / 0.35);
    const s = this.shaker.sample(this.shakeIntensity());
    return s.roll === 0 && s.offset.x === 0 ? pose : { ...pose, position: add(pose.position, s.offset), roll: pose.roll + s.roll };
  }

  private top(): CameraProvider | null {
    let best: Entry | null = null;
    for (const e of this.stack) if (!best || e.provider.priority > best.provider.priority || (e.provider.priority === best.provider.priority && e.order > best.order)) best = e;
    return best?.provider ?? null;
  }
}

/** A data-defined shot as a director provider; fires its shake profile once at `shake.at`. */
export class ShotProvider implements CameraProvider {
  readonly id: string;
  readonly mode: CameraModeId;
  readonly gatesInput = true;
  readonly letterbox: boolean;
  readonly blendIn?: Blend;
  readonly blendOut?: Blend;
  time = 0;
  private shaken = false;

  constructor(
    readonly shot: CameraShot,
    private readonly units: UnitResolver,
    readonly priority: number,
    private readonly onShake: (profile: string) => void,
  ) {
    this.id = shot.id;
    this.mode = shot.mode;
    this.letterbox = shot.letterbox;
    this.blendIn = shot.blendIn;
    this.blendOut = shot.blendOut;
  }

  get done(): boolean {
    return this.time >= this.shot.duration;
  }

  update(dt: number): CameraPose {
    this.time += dt;
    if (this.shot.shake && !this.shaken && this.time >= this.shot.shake.at) {
      this.shaken = true;
      this.onShake(this.shot.shake.profile);
    }
    return evaluateShot(this.shot, Math.min(this.time, this.shot.duration), this.units);
  }
}
