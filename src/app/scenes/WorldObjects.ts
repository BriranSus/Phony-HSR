import * as THREE from 'three';
import type { Collider } from '@models/locomotion';
import type { WorldObject } from '@models/world';
import type { EnemyView, HiddenView, ObjectView } from '@modules/world';

/**
 * Procedural stand-ins for the world layer (Phase 4): a mesh per interactable kind that follows
 * the runtime's state (chest lids, switch orbs, plates, anchors, gates, crates, portals),
 * overworld enemies with an awareness marker, and the veils over hidden areas that fade out when
 * they are discovered. Everything is built from primitives; no external assets.
 */

/** Props fade out when the camera is closer than this (m), so a close camera never sees a solid wall of mesh. */
const FADE_NEAR = 1.2;
const FADE_FAR = 3.2;
const FADE_MIN = 0.1;
const HIDDEN_PAD = 0.8;
const VEIL_HEIGHT = 3.3;

const matOf = (o: THREE.Object3D): THREE.Material => (o as THREE.Mesh).material as THREE.Material;

/** Shared materials and disposal for one set of props. */
export class PropKit {
  private readonly disposables: Array<{ dispose(): void }> = [];
  readonly gold = this.track(new THREE.MeshStandardMaterial({ color: '#d9b475', metalness: 0.7, roughness: 0.3, emissive: '#5a4012', flatShading: true }));
  readonly stone = this.track(new THREE.MeshStandardMaterial({ color: '#d8d1bf', metalness: 0.55, roughness: 0.3, flatShading: true }));
  readonly board = this.track(new THREE.MeshStandardMaterial({ color: '#2b3560', metalness: 0.35, roughness: 0.5, flatShading: true }));
  readonly wood = this.track(new THREE.MeshStandardMaterial({ color: '#6b4e2e', metalness: 0.1, roughness: 0.8, flatShading: true }));
  readonly dark = this.track(new THREE.MeshStandardMaterial({ color: '#2a1838', metalness: 0.4, roughness: 0.5, flatShading: true }));

  track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  glow(color: string | THREE.Color, intensity = 2): THREE.MeshBasicMaterial {
    return this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false }));
  }

  emissive(color: string | THREE.Color, intensity = 1): THREE.MeshStandardMaterial {
    const c = new THREE.Color(color);
    return this.track(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: intensity, roughness: 0.3, flatShading: true }));
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    return new THREE.Mesh(this.track(geo), mat);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

/** The Pom-Pom-style figure shared by NPC objects and the NPC camera dummy (faces +Z). */
export function createNpcFigure(kit: PropKit): THREE.Group {
  const g = new THREE.Group();
  const body = kit.mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 12), kit.stone);
  body.position.y = 0.6;
  const head = kit.mesh(new THREE.SphereGeometry(0.24, 16, 10), kit.stone);
  head.position.y = 1.3;
  const ear = kit.mesh(new THREE.ConeGeometry(0.08, 0.25, 6), kit.gold);
  ear.position.set(0.16, 1.52, 0);
  const ear2 = ear.clone();
  ear2.position.x = -0.16;
  const eyeMat = kit.track(new THREE.MeshBasicMaterial({ color: '#1b1430' }));
  const eye = kit.mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
  eye.position.set(0.085, 1.34, 0.215);
  const eye2 = eye.clone();
  eye2.position.x = -0.085;
  g.add(body, head, ear, ear2, eye, eye2);
  return g;
}

interface ObjectEntry {
  readonly def: WorldObject;
  readonly group: THREE.Group;
  /** Parts animated by state. */
  readonly parts: Record<string, THREE.Object3D>;
  /** Eased display position (crates glide when pushed). */
  x: number;
  z: number;
  /** Current camera-proximity alpha. */
  alpha: number;
}

interface EnemyEntry {
  alpha: number;
  readonly group: THREE.Group;
  readonly marker: THREE.Mesh;
  readonly ring: THREE.Mesh;
}

export interface WorldObjectsOptions {
  /** Display colour of an enemy (its first weakness element). */
  enemyColor(enemyId: string): string;
  /** World scale of the figure for an enemy (bosses / elites are larger). */
  enemyScale(enemyId: string): number;
}

export class WorldObjectsView {
  readonly root = new THREE.Group();
  private readonly kit = new PropKit();
  private readonly entries = new Map<string, ObjectEntry>();
  private readonly enemies = new Map<string, EnemyEntry>();
  private readonly veils = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }>();
  private time = 0;

  constructor(private readonly opts: WorldObjectsOptions) {}

  /** Builds the meshes for a freshly loaded area. */
  build(objects: readonly ObjectView[], enemies: readonly EnemyView[], hidden: readonly HiddenView[], colliders: readonly Collider[]): void {
    for (const o of objects) this.addObject(o, colliders);
    for (const e of enemies) this.addEnemy(e);
    for (const h of hidden) this.addVeil(h);
  }

  private tint(def: WorldObject, fallback: string): string {
    return def.tint ?? fallback;
  }

  private addObject(view: ObjectView, colliders: readonly Collider[]): void {
    const def = view.def;
    const k = this.kit;
    const g = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};
    switch (def.kind) {
      case 'sign': {
        const post = k.mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 6), k.stone);
        post.position.y = 0.65;
        const board = k.mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), k.board);
        board.position.y = 1.25;
        const plate = k.mesh(new THREE.PlaneGeometry(0.75, 0.35), k.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fdcff').multiplyScalar(1.3), toneMapped: false, transparent: true, opacity: 0.75 })));
        plate.position.set(0, 1.25, 0.035);
        g.add(post, board, plate);
        break;
      }
      case 'npc': {
        g.add(createNpcFigure(k));
        break;
      }
      case 'chest': {
        const box = k.mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), k.wood);
        box.position.y = 0.25;
        const lidPivot = new THREE.Group();
        lidPivot.position.set(0, 0.5, -0.3);
        const lid = k.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8, 1, false, 0, Math.PI), k.wood);
        lid.rotation.z = Math.PI / 2;
        lid.position.set(0, 0, 0.3);
        lidPivot.add(lid);
        const band = k.mesh(new THREE.BoxGeometry(0.94, 0.08, 0.64), k.gold);
        band.position.y = 0.42;
        const lock = k.mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), k.gold);
        lock.position.set(0, 0.42, 0.32);
        const spark = k.mesh(new THREE.OctahedronGeometry(0.11), k.glow('#f4dfb0'));
        spark.position.y = 1.2;
        g.add(box, lidPivot, band, lock, spark);
        parts.lid = lidPivot;
        parts.marker = spark;
        break;
      }
      case 'collectible': {
        const gem = k.mesh(new THREE.OctahedronGeometry(0.22), k.glow(this.tint(def, '#ffe9a6'), 1.6));
        gem.position.y = 0.9;
        const base = k.mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 8), k.gold);
        base.position.y = 0.04;
        g.add(gem, base);
        parts.gem = gem;
        break;
      }
      case 'breakable': {
        if (def.collider) {
          // A crack on the wall it breaks: a jagged emissive strip in front of the collider.
          const c = colliders.find((x) => x.id === def.collider);
          const crack = k.mesh(new THREE.PlaneGeometry(0.2, 2.2), k.glow('#ffb36b', 1.2));
          crack.position.set(0, 1.5, 0);
          if (c) crack.rotation.y = c.max[0] - c.min[0] < c.max[2] - c.min[2] ? -Math.PI / 2 : 0;
          g.add(crack);
        } else {
          const box = k.mesh(new THREE.BoxGeometry(1, 0.9, 1), k.wood);
          box.position.y = 0.45;
          const strap = k.mesh(new THREE.BoxGeometry(1.04, 0.12, 1.04), k.gold);
          strap.position.y = 0.45;
          g.add(box, strap);
          parts.body = box;
        }
        break;
      }
      case 'switch': {
        const post = k.mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.9, 8), k.stone);
        post.position.y = 0.45;
        const mat = k.emissive(this.tint(def, '#9fdcff'), 0.3);
        const orb = k.mesh(new THREE.SphereGeometry(0.22, 12, 8), mat);
        orb.position.y = 1.15;
        g.add(post, orb);
        parts.orb = orb;
        break;
      }
      case 'plate': {
        const mat = k.emissive(this.tint(def, '#7fd8ff'), 0.25);
        const disc = k.mesh(new THREE.CylinderGeometry(def.radius * 0.85, def.radius * 0.9, 0.08, 20), mat);
        disc.position.y = 0.04;
        const rim = k.mesh(new THREE.TorusGeometry(def.radius * 0.9, 0.035, 6, 24), k.gold);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.09;
        g.add(disc, rim);
        parts.disc = disc;
        break;
      }
      case 'crate': {
        const box = k.mesh(new THREE.BoxGeometry(def.size, 1, def.size), k.wood);
        box.position.y = 0.5;
        const band = k.mesh(new THREE.BoxGeometry(def.size + 0.04, 0.14, def.size + 0.04), k.gold);
        band.position.y = 0.5;
        g.add(box, band);
        break;
      }
      case 'gate': {
        // A shimmering seal over the gate's collider; the collider mesh itself is part of the area.
        const c = colliders.find((x) => x.id === def.collider);
        if (c) {
          const w = c.max[0] - c.min[0];
          const d = c.max[2] - c.min[2];
          const h = c.max[1] - c.min[1];
          const mat = k.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(this.tint(def, '#9fdcff')).multiplyScalar(1.4), transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false }));
          const seal = k.mesh(new THREE.BoxGeometry(w + 0.04, h * 0.98, d + 0.04), mat);
          seal.position.set((c.min[0] + c.max[0]) / 2 - def.position[0], h / 2 - def.position[1], (c.min[2] + c.max[2]) / 2 - def.position[2]);
          g.add(seal);
          parts.seal = seal;
        }
        break;
      }
      case 'anchor': {
        const base = k.mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.22, 10), k.stone);
        base.position.y = 0.11;
        const pillar = k.mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.3, 8), k.stone);
        pillar.position.y = 0.85;
        const mat = k.emissive(this.tint(def, '#7fe8ff'), 0.15);
        const crystal = k.mesh(new THREE.OctahedronGeometry(0.34), mat);
        crystal.position.y = 1.9;
        const ring = k.mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 28), k.glow(this.tint(def, '#7fe8ff'), 1.4));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 1.2;
        g.add(base, pillar, crystal, ring);
        parts.crystal = crystal;
        parts.ring = ring;
        break;
      }
      case 'portal': {
        const ring = k.mesh(new THREE.TorusGeometry(1.0, 0.07, 8, 36), k.glow(this.tint(def, '#c9a8ff'), 1.5));
        ring.scale.set(0.7, 1.2, 1);
        ring.position.y = 1.35;
        const sheet = k.mesh(
          new THREE.CircleGeometry(1.0, 28),
          k.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(this.tint(def, '#c9a8ff')).multiplyScalar(0.6), transparent: true, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false, depthWrite: false })),
        );
        sheet.scale.set(0.7, 1.2, 1);
        sheet.position.y = 1.35;
        g.add(ring, sheet);
        parts.sheet = sheet;
        break;
      }
    }
    g.position.set(view.x, view.y, view.z);
    if (def.kind === 'sign' || def.kind === 'npc' || def.kind === 'chest') g.rotation.y = Math.atan2(-view.x, 6 - view.z) * 0.5;
    if (def.kind === 'portal') g.rotation.y = Math.atan2(-view.x, -view.z);
    this.root.add(g);
    this.own(g);
    this.entries.set(def.id, { def, group: g, parts, x: view.x, z: view.z, alpha: 1 });
  }

  private addEnemy(e: EnemyView): void {
    const k = this.kit;
    const g = new THREE.Group();
    const members = e.enemies;
    members.forEach((id, i) => {
      const color = new THREE.Color(this.opts.enemyColor(id));
      const body = k.mesh(new THREE.CylinderGeometry(0.22, 0.4, 1.2, 6), k.dark);
      body.position.y = 0.6;
      const head = k.mesh(new THREE.OctahedronGeometry(0.28, 0), k.emissive(color, 1.1));
      head.position.y = 1.5;
      const shoulders = k.mesh(new THREE.BoxGeometry(0.9, 0.16, 0.3), k.dark);
      shoulders.position.y = 1.15;
      const figure = new THREE.Group();
      figure.add(body, head, shoulders);
      const s = this.opts.enemyScale(id);
      figure.scale.setScalar(s);
      if (members.length > 1) {
        const a = (i / members.length) * Math.PI * 2;
        figure.position.set(Math.sin(a) * 0.95, 0, Math.cos(a) * 0.95);
      }
      g.add(figure);
    });
    const marker = k.mesh(new THREE.ConeGeometry(0.16, 0.5, 4), k.track(new THREE.MeshBasicMaterial({ color: '#ff4466', toneMapped: false })));
    marker.rotation.x = Math.PI;
    marker.position.y = 2.6;
    const ring = k.mesh(new THREE.TorusGeometry(0.6, 0.04, 6, 20), k.glow('#8fc8ff', 1.4));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.2;
    g.add(marker, ring);
    this.root.add(g);
    this.own(g);
    this.enemies.set(e.spawnId, { group: g, marker, ring, alpha: 1 });
  }

  private addVeil(h: HiddenView): void {
    const b = h.def.bounds;
    const w = b.max[0] - b.min[0] + HIDDEN_PAD * 2;
    const d = b.max[1] - b.min[1] + HIDDEN_PAD * 2;
    const mat = this.kit.track(new THREE.MeshBasicMaterial({ color: '#04060f', transparent: true, opacity: h.discovered ? 0 : 1, depthWrite: false }));
    const mesh = this.kit.mesh(new THREE.BoxGeometry(w, VEIL_HEIGHT, d), mat);
    mesh.position.set((b.min[0] + b.max[0]) / 2, VEIL_HEIGHT / 2, (b.min[1] + b.max[1]) / 2);
    mesh.visible = !h.discovered || h.reveal < 1;
    mesh.renderOrder = 5;
    this.root.add(mesh);
    this.veils.set(h.def.id, { mesh, mat });
  }

  update(dt: number, objects: readonly ObjectView[], enemies: readonly EnemyView[], hidden: readonly HiddenView[], camera: { x: number; y: number; z: number }): void {
    this.time += dt;
    const t = this.time;
    const ease = 1 - Math.exp(-14 * dt);
    for (const v of objects) {
      const e = this.entries.get(v.def.id);
      if (!e) continue;
      e.group.visible = v.visible && this.shown(v);
      e.x += (v.x - e.x) * ease;
      e.z += (v.z - e.z) * ease;
      e.group.position.x = e.x;
      e.group.position.z = e.z;
      e.alpha = this.fade(e.group, e.alpha, camera);
      switch (e.def.kind) {
        case 'chest': {
          const open = v.state === 'opened';
          const lid = e.parts.lid!;
          lid.rotation.x += ((open ? -1.9 : 0) - lid.rotation.x) * ease;
          const spark = e.parts.marker!;
          spark.visible = !open;
          spark.rotation.y = t * 2;
          spark.position.y = 1.2 + Math.sin(t * 3) * 0.08;
          break;
        }
        case 'collectible': {
          const gem = e.parts.gem!;
          gem.rotation.y = t * 2.4;
          gem.position.y = 0.9 + Math.sin(t * 2.6 + e.x) * 0.1;
          break;
        }
        case 'switch': {
          const mat = matOf(e.parts.orb!) as THREE.MeshStandardMaterial;
          const on = v.state === 'on';
          mat.emissiveIntensity += ((on ? 1.8 : 0.3) - mat.emissiveIntensity) * ease;
          e.parts.orb!.position.y = 1.15 + (on ? Math.sin(t * 4) * 0.04 : 0);
          break;
        }
        case 'plate': {
          const mat = matOf(e.parts.disc!) as THREE.MeshStandardMaterial;
          const pressed = v.state === 'pressed';
          mat.emissiveIntensity += ((pressed ? 1.7 : 0.25) - mat.emissiveIntensity) * ease;
          e.parts.disc!.position.y += ((pressed ? 0.01 : 0.04) - e.parts.disc!.position.y) * ease;
          break;
        }
        case 'gate': {
          const seal = e.parts.seal;
          if (seal) seal.visible = v.state !== 'open';
          if (seal) {
            const m = matOf(seal);
            m.userData.baseOpacity = 0.28 + Math.sin(t * 2.2) * 0.08;
            m.opacity = (m.userData.baseOpacity as number) * e.alpha;
          }
          break;
        }
        case 'anchor': {
          const active = v.state === 'active';
          const mat = matOf(e.parts.crystal!) as THREE.MeshStandardMaterial;
          mat.emissiveIntensity += ((active ? 2.2 : 0.15) - mat.emissiveIntensity) * ease;
          e.parts.crystal!.rotation.y = t * (active ? 1.6 : 0.4);
          e.parts.crystal!.position.y = 1.9 + Math.sin(t * 2) * (active ? 0.1 : 0.03);
          e.parts.ring!.rotation.z = t * (active ? 1.2 : 0.2);
          break;
        }
        case 'portal': {
          e.parts.sheet!.rotation.z = t * 0.6;
          break;
        }
        case 'breakable': {
          const broken = v.state === 'broken';
          e.group.visible = e.group.visible && !broken;
          break;
        }
        default:
          break;
      }
    }
    for (const en of enemies) {
      const e = this.enemies.get(en.spawnId);
      if (!e) continue;
      e.group.visible = true;
      e.group.position.set(en.x, en.y, en.z);
      e.group.rotation.y = en.yaw;
      e.alpha = this.fade(e.group, e.alpha, camera);
      const aware = en.state === 'alert' || en.state === 'chase';
      e.marker.visible = aware;
      e.marker.position.y = 2.6 + Math.sin(t * 9) * 0.1;
      (e.marker.material as THREE.MeshBasicMaterial).color.set(en.state === 'alert' ? '#ffd24a' : '#ff4466');
      e.ring.visible = en.state === 'stunned';
      e.ring.rotation.z = t * 5;
    }
    // Enemies that are gone (defeated) disappear until they respawn.
    const live = new Set(enemies.map((e) => e.spawnId));
    for (const [id, e] of this.enemies) if (!live.has(id)) e.group.visible = false;
    for (const h of hidden) {
      const v = this.veils.get(h.def.id);
      if (!v) continue;
      v.mat.opacity = 1 - h.reveal;
      v.mesh.visible = h.reveal < 1;
    }
  }

  /** Gives every mesh of a prop its own material copies, so fading one prop never fades another. */
  private own(group: THREE.Group): void {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      mesh.material = this.kit.track(mesh.material.clone());
    });
  }

  /** Fades a prop group by camera distance (materials are remembered with their authored opacity). */
  private fade(group: THREE.Group, current: number, camera: { x: number; y: number; z: number }): number {
    const d = Math.hypot(camera.x - group.position.x, camera.y - (group.position.y + 1), camera.z - group.position.z);
    const alpha = Math.min(1, Math.max(FADE_MIN, (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
    if (Math.abs(alpha - current) < 0.02 && !(alpha === 1 && current !== 1)) return current;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const base = (m.userData.baseOpacity ??= m.opacity) as number;
        const wasTransparent = (m.userData.baseTransparent ??= m.transparent) as boolean;
        const target = base * alpha;
        const transparent = wasTransparent || alpha < 1;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.opacity = target;
      }
    });
    return alpha;
  }

  /** Spawns that were defeated and later respawned need a mesh: build any that are missing. */
  ensureEnemies(enemies: readonly EnemyView[]): void {
    for (const e of enemies) if (!this.enemies.has(e.spawnId)) this.addEnemy(e);
  }

  private shown(v: ObjectView): boolean {
    switch (v.def.kind) {
      case 'chest':
      case 'gate':
        return true;
      case 'collectible':
        return v.state !== 'collected';
      default:
        return true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.kit.dispose();
    this.entries.clear();
    this.enemies.clear();
    this.veils.clear();
  }
}
