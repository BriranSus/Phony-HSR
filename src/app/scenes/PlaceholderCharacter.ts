import * as THREE from 'three';
import type { AnimationFrame } from '@modules/player';

/**
 * Procedural low-poly stand-in for an exploration model (no art assets): a stylised figure with
 * an element-tinted coat trim, hair cap and glow ring. It is posed each frame from the data-driven
 * animation state machine (bob, lean, arm / leg swing); a skinned model can later play
 * `frame.state.clip` instead. Switching characters re-tints it with a short pop.
 */
export class PlaceholderCharacter {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly accent: THREE.MeshStandardMaterial;
  private readonly hair: THREE.MeshStandardMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private pop = 0;

  constructor(height: number) {
    const s = height / 1.7;
    const coat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a5688, roughness: 0.55, metalness: 0.2, flatShading: true }));
    const skin = this.track(new THREE.MeshStandardMaterial({ color: 0xf1d9c6, roughness: 0.8, flatShading: true }));
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x2c3354, roughness: 0.65, flatShading: true }));
    this.accent = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.4, flatShading: true }));
    this.hair = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, flatShading: true }));

    const mesh = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
      this.track(g);
      const o = new THREE.Mesh(g, m);
      o.castShadow = true;
      return o;
    };
    // Legs (pivot at the hips).
    for (const [leg, x] of [[this.legL, -0.11], [this.legR, 0.11]] as const) {
      leg.position.set(x * s, 0.82 * s, 0);
      const l = mesh(new THREE.CylinderGeometry(0.075 * s, 0.06 * s, 0.78 * s, 6), dark);
      l.position.y = -0.39 * s;
      const boot = mesh(new THREE.BoxGeometry(0.13 * s, 0.1 * s, 0.22 * s), coat);
      boot.position.set(0, -0.77 * s, 0.04 * s);
      leg.add(l, boot);
      this.body.add(leg);
    }
    // Torso: tapered coat with an element trim band, head and hair cap.
    this.torso.position.y = 0.82 * s;
    const chest = mesh(new THREE.CylinderGeometry(0.2 * s, 0.24 * s, 0.6 * s, 7), coat);
    chest.position.y = 0.3 * s;
    const skirt = mesh(new THREE.ConeGeometry(0.3 * s, 0.32 * s, 7, 1, true), coat);
    skirt.position.y = 0.02 * s;
    const trim = mesh(new THREE.CylinderGeometry(0.245 * s, 0.245 * s, 0.05 * s, 7), this.accent);
    trim.position.y = 0.1 * s;
    const collar = mesh(new THREE.TorusGeometry(0.13 * s, 0.025 * s, 4, 10), this.accent);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.6 * s;
    const head = mesh(new THREE.IcosahedronGeometry(0.15 * s, 1), skin);
    head.position.y = 0.78 * s;
    const hairCap = mesh(new THREE.SphereGeometry(0.165 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), this.hair);
    hairCap.position.set(0, 0.8 * s, -0.012 * s);
    this.torso.add(chest, skirt, trim, collar, head, hairCap);
    // Arms (pivot at the shoulders).
    for (const [arm, x] of [[this.armL, -0.27], [this.armR, 0.27]] as const) {
      arm.position.set(x * s, 0.55 * s, 0);
      const a = mesh(new THREE.CylinderGeometry(0.055 * s, 0.045 * s, 0.55 * s, 6), coat);
      a.position.y = -0.27 * s;
      const hand = mesh(new THREE.IcosahedronGeometry(0.05 * s, 0), skin);
      hand.position.y = -0.57 * s;
      arm.add(a, hand);
      this.torso.add(arm);
    }
    this.body.add(this.torso);
    this.root.add(this.body);

    this.ringMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ring = new THREE.Mesh(this.track(new THREE.RingGeometry(0.42 * s, 0.5 * s, 32)), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    const shadow = new THREE.Mesh(
      this.track(new THREE.CircleGeometry(0.42 * s, 24)),
      this.track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    this.root.add(shadow, this.ring);
  }

  /** Re-tint for the active character (element colour) and play the switch pop. */
  setCharacter(elementColor: string): void {
    const c = new THREE.Color(elementColor);
    this.accent.color.copy(c);
    this.accent.emissive.copy(c);
    this.hair.color.copy(c).lerp(new THREE.Color(0xffffff), 0.35);
    this.ringMat.color.copy(c);
    this.pop = 1;
  }

  apply(frame: AnimationFrame, x: number, y: number, z: number, yaw: number, dt: number): void {
    this.root.position.set(x, y, z);
    this.body.rotation.y = yaw;
    this.body.position.y = frame.bob;
    this.torso.rotation.x = frame.pose.lean;
    this.armL.rotation.x = frame.swing;
    this.armR.rotation.x = -frame.swing;
    this.legL.rotation.x = -frame.swing * 0.8;
    this.legR.rotation.x = frame.swing * 0.8;
    this.pop = Math.max(0, this.pop - dt * 3);
    const k = 1 + Math.sin(this.pop * Math.PI) * 0.12;
    this.body.scale.setScalar(k);
    this.ring.scale.setScalar(1 + this.pop * 1.6);
    this.ringMat.opacity = 0.35 + this.pop * 0.5;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }
}
