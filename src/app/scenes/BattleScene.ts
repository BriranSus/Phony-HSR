import * as THREE from 'three';
import type { BattleStage } from '@models/battle';
import type { AnimationStateDef } from '@models/locomotion';
import { v3, type CameraPose, type UnitResolver, type Vec3 } from '@modules/camera';
import { Nebula, Starfield } from '@modules/vfx';
import { BattleActor, type ActorSpec } from './BattleActor';

/**
 * The battle stage (procedural): a lit arena disc under the Phase-1 sky, the party on one side and
 * the enemy wave on the other. It owns the actors, answers the camera director's unit anchors
 * (`actor`, `target`, `allies`, `enemies`, or any unit uid) and projects heads for the HUD.
 */
export class BattleScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 5000);
  readonly actors = new Map<string, BattleActor>();
  private readonly nebula = new Nebula(1800);
  private readonly starfield: Starfield;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private time = 0;
  private shotActor: string | null = null;
  private shotTarget: string | null = null;

  constructor(
    private readonly stage: BattleStage,
    private readonly animation: readonly AnimationStateDef[],
    starCount: number,
    fov: number,
  ) {
    this.camera.fov = fov;
    this.starfield = new Starfield({ count: starCount, innerRadius: 800, outerRadius: 1600 });
    this.scene.add(this.nebula.object, this.starfield.object);
    this.scene.fog = new THREE.FogExp2(0x060914, 0.01);
    this.scene.add(new THREE.HemisphereLight(0x9db7ff, 0x1a1030, 1.1));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
    key.position.set(6, 14, 10);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb8ff, 1.2);
    rim.position.set(-8, 6, -10);
    this.scene.add(rim);
    // Arena floor: a dark disc with a gold rim and a faint grid.
    const floor = new THREE.Mesh(this.track(new THREE.CircleGeometry(16, 64)), this.track(new THREE.MeshStandardMaterial({ color: 0x141a36, metalness: 0.5, roughness: 0.6 })));
    floor.rotation.x = -Math.PI / 2;
    const rimMesh = new THREE.Mesh(this.track(new THREE.RingGeometry(15.6, 16, 64)), this.track(new THREE.MeshBasicMaterial({ color: 0xd9b475, transparent: true, opacity: 0.55, side: THREE.DoubleSide })));
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.y = 0.01;
    const grid = new THREE.GridHelper(32, 16, 0x3a4a80, 0x3a4a80);
    for (const m of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      m.transparent = true;
      m.opacity = 0.22;
    }
    grid.position.y = 0.012;
    this.track(grid.geometry);
    this.scene.add(floor, rimMesh, grid);
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  /** Places the party (left to right) facing the enemies. */
  setAllies(specs: readonly ActorSpec[]): void {
    specs.forEach((s, i) => this.addActor(s, new THREE.Vector3(this.stage.allies.x + i * this.stage.allies.spacing, 0, this.stage.allies.z)));
  }

  /** Replaces the enemy row (a new wave). */
  setEnemies(specs: readonly ActorSpec[]): void {
    for (const [uid, a] of this.actors) {
      if (a.spec.side === 'enemy') {
        a.dispose();
        this.actors.delete(uid);
      }
    }
    const span = (specs.length - 1) * this.stage.enemies.spacing;
    specs.forEach((s, i) => this.addActor(s, new THREE.Vector3(-span / 2 + i * this.stage.enemies.spacing, 0, this.stage.enemies.z)));
  }

  private addActor(spec: ActorSpec, home: THREE.Vector3): void {
    const a = new BattleActor(spec, home, this.animation);
    this.actors.set(spec.uid, a);
    this.scene.add(a.group);
  }

  actor(uid: string): BattleActor {
    const a = this.actors.get(uid);
    if (!a) throw new Error(`no actor ${uid}`);
    return a;
  }

  side(side: 'ally' | 'enemy'): BattleActor[] {
    return [...this.actors.values()].filter((a) => a.spec.side === side);
  }

  /** The actor and target a shot is about (anchors `actor` / `target`). */
  setShot(actor: string | null, target: string | null): void {
    this.shotActor = actor;
    this.shotTarget = target;
  }

  /** Anchor resolver for camera shots. */
  readonly units: UnitResolver = (id) => {
    const at = (a: BattleActor): { position: Vec3; yaw: number } => ({ position: v3(a.home.x, a.home.y, a.home.z), yaw: a.yaw });
    const centroid = (list: BattleActor[], yaw: number): { position: Vec3; yaw: number } | undefined => {
      const live = list.filter((a) => !a.down);
      const pool = live.length ? live : list;
      if (pool.length === 0) return undefined;
      const sum = pool.reduce((s, a) => ({ x: s.x + a.home.x, z: s.z + a.home.z }), { x: 0, z: 0 });
      return { position: v3(sum.x / pool.length, 0, sum.z / pool.length), yaw };
    };
    if (id === 'actor') return this.shotActor ? at(this.actor(this.shotActor)) : undefined;
    if (id === 'target') return this.shotTarget ? at(this.actor(this.shotTarget)) : undefined;
    if (id === 'allies') return centroid(this.side('ally'), Math.PI);
    if (id === 'enemies') return centroid(this.side('enemy'), 0);
    const a = this.actors.get(id);
    return a ? at(a) : undefined;
  };

  /** The idle overview pose (mode `combat`): behind the party, looking across the field. */
  overview(): CameraPose {
    const c = this.stage.camera;
    const sway = Math.sin(this.time * 0.35) * c.sway;
    return {
      position: v3(sway, c.height, this.stage.allies.z + c.distance),
      target: v3(0, c.lookHeight, (this.stage.allies.z + this.stage.enemies.z) / 2),
      fov: c.fov,
      roll: 0,
    };
  }

  update(dt: number): void {
    this.time += dt;
    this.starfield.update(this.time);
    this.nebula.update(this.time);
    for (const a of this.actors.values()) a.update(dt);
  }

  dispose(): void {
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
    this.starfield.dispose();
    this.nebula.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
