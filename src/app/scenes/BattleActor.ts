import * as THREE from 'three';
import type { AnimationStateDef } from '@models/locomotion';
import { AnimationStateMachine, type AnimationFrame } from '@modules/player';
import { PlaceholderCharacter } from './PlaceholderCharacter';
import { PropKit, createEnemyFigure } from './WorldObjects';

/**
 * One unit on the battle stage: a procedural figure with small scripted animations (lunge, hit
 * flash, shake, knock-down). Everything is a tween on an offset; the figure's own idle pose comes
 * from the data-driven locomotion animation (allies) or a gentle bob (enemies). No art assets.
 */
export interface ActorSpec {
  readonly uid: string;
  readonly side: 'ally' | 'enemy';
  readonly name: string;
  /** Element colour of the character, or of the enemy's first Weakness. */
  readonly color: string;
  readonly scale: number;
}

interface Tween {
  t: number;
  readonly dur: number;
  readonly fn: (p: number) => void;
  readonly done: () => void;
}

const easeOut = (p: number): number => 1 - (1 - p) ** 3;

export class BattleActor {
  readonly group = new THREE.Group();
  /** Where the unit stands. */
  readonly home = new THREE.Vector3();
  /** World yaw it faces (allies face -z, enemies +z). */
  readonly yaw: number;
  /** Currently knocked down / defeated. */
  down = false;
  private readonly model: PlaceholderCharacter | null;
  private readonly figure: THREE.Group | null;
  private readonly kit = new PropKit();
  private readonly offset = new THREE.Vector3();
  private readonly materials: Array<{ m: THREE.MeshStandardMaterial; color: THREE.Color; intensity: number }> = [];
  private readonly tweens: Tween[] = [];
  private readonly anim: AnimationStateMachine;
  private flash = 0;
  private flashColor = new THREE.Color('#ffffff');
  private lunge = 0;
  private fall = 0;
  private time = Math.random() * 10;

  constructor(
    readonly spec: ActorSpec,
    home: THREE.Vector3,
    animation: readonly AnimationStateDef[],
  ) {
    this.home.copy(home);
    this.yaw = spec.side === 'ally' ? Math.PI : 0;
    this.group.position.copy(home);
    this.anim = new AnimationStateMachine(animation);
    if (spec.side === 'ally') {
      this.model = new PlaceholderCharacter(1.7);
      this.model.setCharacter(spec.color);
      this.group.add(this.model.root);
      this.figure = null;
    } else {
      this.model = null;
      this.figure = createEnemyFigure(this.kit, spec.color, spec.scale);
      this.group.add(this.figure);
      const ring = this.kit.mesh(new THREE.RingGeometry(0.5 * spec.scale, 0.6 * spec.scale, 32), this.kit.track(new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      this.group.add(ring);
    }
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.materials.push({ m: m as THREE.MeshStandardMaterial, color: (m as THREE.MeshStandardMaterial).emissive.clone(), intensity: (m as THREE.MeshStandardMaterial).emissiveIntensity });
    });
  }

  /** World position of the top of the figure (damage numbers, plates). */
  head(): THREE.Vector3 {
    const h = this.spec.side === 'ally' ? 2.1 : 2.4 * this.spec.scale;
    return this.group.position.clone().add(new THREE.Vector3(0, h, 0));
  }

  /** World position of the chest (hit effects, shot anchors). */
  chest(): THREE.Vector3 {
    return this.group.position.clone().add(new THREE.Vector3(0, 1.1 * (this.spec.side === 'ally' ? 1 : this.spec.scale), 0));
  }

  private play(dur: number, fn: (p: number) => void): Promise<void> {
    return new Promise((resolve) => this.tweens.push({ t: 0, dur: Math.max(1e-3, dur), fn, done: resolve }));
  }

  /** Steps toward `target`, strikes and returns (the attack beat). */
  async attack(target: THREE.Vector3, dur: number): Promise<void> {
    const dir = target.clone().sub(this.home).setY(0);
    const dist = Math.max(0, dir.length() - 1.6);
    dir.normalize();
    await this.play(dur, (p) => {
      // Out in the first 40%, a held strike, back in the last 35%.
      const out = p < 0.4 ? easeOut(p / 0.4) : p < 0.65 ? 1 : 1 - easeOut((p - 0.65) / 0.35);
      this.offset.copy(dir).multiplyScalar(dist * out);
      this.lunge = p > 0.3 && p < 0.7 ? Math.sin(((p - 0.3) / 0.4) * Math.PI) : 0;
    });
    this.offset.set(0, 0, 0);
    this.lunge = 0;
  }

  /** A hit lands: element flash and a short shake (plus a small recoil). */
  hit(color: string, heavy = false): void {
    this.flash = 1;
    this.flashColor.set(color);
    const base = this.offset.clone();
    const amp = heavy ? 0.22 : 0.12;
    void this.play(heavy ? 0.4 : 0.25, (p) => {
      const k = (1 - p) * amp;
      this.offset.set(base.x + Math.sin(p * 60) * k, base.y, base.z + (this.spec.side === 'ally' ? 1 : -1) * 0.5 * k);
    }).then(() => this.offset.copy(base));
  }

  /** Falls: allies lie down, enemies sink away. */
  async defeat(dur: number): Promise<void> {
    this.down = true;
    await this.play(dur, (p) => {
      this.fall = easeOut(p);
    });
    if (this.spec.side === 'enemy') this.group.visible = false;
  }

  revive(): void {
    this.down = false;
    this.fall = 0;
    this.group.visible = true;
  }

  /** The turn highlight: a ring pop on allies. */
  pulse(): void {
    this.model?.pulse();
  }

  update(dt: number): void {
    this.time += dt;
    for (const tw of [...this.tweens]) {
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      tw.fn(p);
      if (p >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done();
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    for (const e of this.materials) {
      if (this.flash > 0) {
        e.m.emissive.copy(e.color).lerp(this.flashColor, Math.min(1, this.flash * 1.3));
        e.m.emissiveIntensity = e.intensity + this.flash * 1.8;
      } else {
        e.m.emissive.copy(e.color);
        e.m.emissiveIntensity = e.intensity;
      }
    }
    const sink = this.spec.side === 'enemy' ? this.fall : 0;
    if (this.model) {
      const idle = this.anim.update(dt, 0, 'run', 0);
      const frame: AnimationFrame = { ...idle, swing: this.lunge * 1.7, pose: { ...idle.pose, lean: idle.pose.lean + this.lunge * 0.5 } };
      this.model.apply(frame, this.offset.x, this.offset.y - this.fall * 0.9, this.offset.z, this.yaw, dt);
      this.model.root.rotation.x = -this.fall * (Math.PI / 2.2);
    } else if (this.figure) {
      this.figure.position.set(this.offset.x, this.offset.y + Math.sin(this.time * 2) * 0.05 - sink * 1.2, this.offset.z);
      this.figure.rotation.y = this.lunge * 0.3;
      this.figure.scale.setScalar(this.spec.scale * (1 - sink * 0.6));
    }
  }

  dispose(): void {
    this.model?.dispose();
    this.kit.dispose();
    this.group.removeFromParent();
  }
}
