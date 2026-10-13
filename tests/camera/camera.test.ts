import { describe, expect, it } from 'vitest';
import rulesJson from '@data/camera/rules/default.json';
import shotsJson from '@data/camera/shots/gallery.json';
import levelJson from '@data/levels/test-level.json';
import * as THREE from 'three';
import { PlaceholderCharacter } from '@app/scenes/PlaceholderCharacter';
import { CameraRulesSchema, CameraShotSchema } from '@models/camera';
import { LevelSchema } from '@models/locomotion';
import {
  CameraDirector,
  CameraShake,
  ExplorationProvider,
  ExplorationRig,
  NO_CAMERA_INPUT,
  ease,
  evaluateShot,
  fovPunch,
  lerpPose,
  lineOfSightBlocked,
  orbitDirection,
  orbitPosition,
  sphereCast,
  v3,
  type CameraInput,
  type CameraPose,
  type CameraProvider,
} from '@modules/camera';

const rules = CameraRulesSchema.parse(rulesJson);
const shots = shotsJson.map((s) => CameraShotSchema.parse(s));
const level = LevelSchema.parse(levelJson);
const DT = 1 / 60;
const settings = { fov: 50, orbitSensitivity: 1, zoomSensitivity: 1, invertY: false, autoRecenter: true };
const rig = (yaw = 0, s = settings) => new ExplorationRig(rules.exploration, level.colliders, () => s, yaw);
const input = (o: Partial<CameraInput>): CameraInput => ({ ...NO_CAMERA_INPUT, ...o });
const pose = (x: number, fov = 50): CameraPose => ({ position: v3(x, 0, 0), target: v3(x, 0, 1), fov, roll: 0 });

describe('orbit math and clamps', () => {
  it('places the camera behind the yaw direction and above for positive pitch', () => {
    const p = orbitPosition(v3(0, 1, 0), 0, 0, 5);
    expect(p.z).toBeCloseTo(-5);
    expect(orbitDirection(Math.PI / 2, 0).x).toBeCloseTo(-1);
    expect(orbitDirection(0, 0.5).y).toBeGreaterThan(0);
  });

  it('clamps pitch and zoom to the data ranges and smooths zoom', () => {
    const r = rig();
    for (let i = 0; i < 120; i++) r.update(DT, { x: 0, y: 0, z: 0 }, input({ mouseDy: 400, wheel: 2000 }));
    expect(r.pitch).toBe(rules.exploration.pitch.max);
    expect(r.zoom).toBe(rules.exploration.distance.max);
    const before = r.zoomSmoothed;
    r.update(DT, { x: 0, y: 0, z: 0 }, input({ wheel: -100000 }));
    expect(r.zoom).toBe(rules.exploration.distance.min);
    expect(r.zoomSmoothed).toBeLessThan(before);
    expect(r.zoomSmoothed).toBeGreaterThan(rules.exploration.distance.min);
  });

  it('rotates with the mouse and keys, honours invert Y and sensitivity', () => {
    const r = rig();
    r.update(DT, { x: 0, y: 0, z: 0 }, input({ mouseDx: 100 }));
    expect(r.yaw).toBeCloseTo(-100 * rules.exploration.mouseRadiansPerPixel);
    const inv = rig(0, { ...settings, invertY: true, orbitSensitivity: 2 });
    const p0 = inv.pitch;
    inv.update(DT, { x: 0, y: 0, z: 0 }, input({ mouseDy: 10 }));
    expect(inv.pitch).toBeCloseTo(p0 - 10 * rules.exploration.mouseRadiansPerPixel * 2);
  });
});

describe('collision against the real level', () => {
  it('sphere casts stop before the perimeter wall', () => {
    const free = sphereCast(level.colliders, v3(22, 1.35, 0), v3(1, 0, 0), 9, 0.3);
    expect(free).toBeLessThan(23.4 - 22 - 0.3 + 0.06);
    expect(free).toBeGreaterThan(0.9);
  });

  it('never places the camera behind or inside the perimeter wall, at any yaw, near walls and corners', () => {
    const spots = [
      { x: 22.9, z: 0 },
      { x: -22.9, z: 5 },
      { x: 3, z: 22.9 },
      { x: 0, z: -22.9 },
      { x: 22.9, z: 22.9 },
      { x: -22.9, z: -22.9 },
    ];
    for (const s of spots) {
      for (let yaw = -Math.PI; yaw < Math.PI; yaw += Math.PI / 8) {
        const r = rig(yaw);
        const target = { x: s.x, y: 0, z: s.z };
        r.reset(target, yaw);
        for (let i = 0; i < 30; i++) r.update(DT, target, NO_CAMERA_INPUT);
        const p = r.pose!.position;
        expect(Math.abs(p.x)).toBeLessThan(23.4);
        expect(Math.abs(p.z)).toBeLessThan(23.4);
        expect(lineOfSightBlocked(level.colliders, p, v3(s.x, 1.35, s.z))).toBe(false);
      }
    }
  });

  it('pulls in instantly and eases back out', () => {
    const r = rig(Math.PI / 2 + Math.PI); // looking -X: camera on the +X side, toward the east wall
    const target = { x: 21.5, y: 0, z: 0 };
    r.reset(target, -Math.PI / 2);
    expect(r.distance).toBeLessThan(2);
    // Walk away from the wall: the camera follows back out at the recover speed, not instantly.
    const far = { x: 18, y: 0, z: 10 };
    r.update(DT, far, NO_CAMERA_INPUT);
    expect(r.distance).toBeLessThan(2.2);
    for (let i = 0; i < 180; i++) r.update(DT, far, NO_CAMERA_INPUT);
    expect(r.distance).toBeCloseTo(rules.exploration.distance.default, 1);
  });
});

describe('auto-recenter timing', () => {
  it('waits for the idle delay, then turns behind the moving player', () => {
    const r = rig(1.2);
    const moving = { x: 0, y: 0, z: 0, yaw: 0, velocity: { x: 0, z: 5 } };
    r.update(DT, moving, input({ mouseDx: 1 }));
    const yaw0 = r.yaw;
    for (let t = 0; t < rules.exploration.recenter.delay - 0.1; t += DT) r.update(DT, moving, NO_CAMERA_INPUT);
    expect(r.yaw).toBeCloseTo(yaw0, 6);
    for (let t = 0; t < 2; t += DT) r.update(DT, moving, NO_CAMERA_INPUT);
    expect(Math.abs(r.yaw)).toBeLessThan(0.05);
  });

  it('does not recenter when the setting is off or the player stands still', () => {
    const off = rig(1.2, { ...settings, autoRecenter: false });
    const still = rig(1.2);
    for (let t = 0; t < 5; t += DT) {
      off.update(DT, { x: 0, y: 0, z: 0, yaw: 0, velocity: { x: 0, z: 5 } }, NO_CAMERA_INPUT);
      still.update(DT, { x: 0, y: 0, z: 0, yaw: 0, velocity: { x: 0, z: 0 } }, NO_CAMERA_INPUT);
    }
    expect(off.yaw).toBeCloseTo(1.2);
    expect(still.yaw).toBeCloseTo(1.2);
  });
});

describe('blends, shake and shots', () => {
  it('blend interpolation follows the easing curve', () => {
    expect(ease('linear', 0.25)).toBe(0.25);
    expect(ease('easeInOutCubic', 0.5)).toBeCloseTo(0.5);
    expect(ease('easeInOutCubic', 0.25)).toBeLessThan(0.25);
    expect(ease('easeOutCubic', 1.5)).toBe(1);
    expect(lerpPose(pose(0, 40), pose(10, 60), 0.5)).toMatchObject({ position: { x: 5 }, fov: 50 });
  });

  it('shake trauma decays linearly and scales with trauma^2 and intensity', () => {
    const s = new CameraShake();
    s.add(rules.shakeProfiles.ultimate!);
    const ult = rules.shakeProfiles.ultimate!;
    expect(s.trauma).toBeCloseTo(ult.trauma);
    s.update(0.25);
    expect(s.trauma).toBeCloseTo(ult.trauma - ult.decay * 0.25);
    expect(s.sample(0)).toEqual({ offset: v3(0, 0, 0), roll: 0 });
    s.update(5);
    expect(s.trauma).toBe(0);
    s.add(rules.shakeProfiles.hit!);
    s.add(rules.shakeProfiles.hit!);
    s.add(rules.shakeProfiles.hit!);
    expect(s.trauma).toBe(1);
  });

  it('evaluates keyframed shots with anchors, easing and the FOV punch', () => {
    const units = (id: string) => ({ player: { position: v3(0, 0, 0), yaw: 0 } })[id as 'player'] ?? { position: v3(0, 0, -10), yaw: 0 };
    const ult = shots.find((s) => s.id === 'shot.ultimate')!;
    const start = evaluateShot(ult, 0, units);
    expect(start.position).toMatchObject({ x: 0, y: 1.35, z: 2.6 });
    expect(start.fov).toBe(44);
    expect(fovPunch(ult, 0.9 + 0.06)).toBeCloseTo(14);
    expect(fovPunch(ult, 0.9 + 0.7)).toBe(0);
    const end = evaluateShot(ult, ult.duration, units);
    expect(end.fov).toBe(60);
    for (const s of shots) expect(() => evaluateShot(s, s.duration / 2, units)).not.toThrow();
  });
});

describe('director stack and priority', () => {
  class Fixed implements CameraProvider {
    done = false;
    constructor(
      readonly id: string,
      readonly mode: CameraProvider['mode'],
      readonly priority: number,
      readonly x: number,
      readonly gatesInput = true,
      readonly letterbox = false,
      readonly blendIn: CameraProvider['blendIn'] = undefined,
    ) {}
    update(): CameraPose {
      return pose(this.x);
    }
  }

  it('runs the highest priority provider, latest wins ties, and pops finished ones', () => {
    const d = new CameraDirector(rules, () => 1);
    const base = new Fixed('base', 'exploration', 0, 0, false);
    d.push(base);
    d.update(DT);
    expect(d.mode).toBe('exploration');
    expect(d.inputGated).toBe(false);
    const combat = new Fixed('combat', 'combat', 10, 10, true, false, 'cut');
    const dialogue = new Fixed('dlg', 'dialogue', 20, 20, true, false, 'cut');
    d.push(dialogue);
    d.push(combat);
    expect(d.update(DT)?.position.x).toBe(20);
    expect(d.inputGated).toBe(true);
    const combat2 = new Fixed('combat2', 'combat', 20, 30, true, false, 'cut');
    d.push(combat2);
    expect(d.update(DT)?.position.x).toBe(30);
    combat2.done = true;
    dialogue.done = true;
    d.update(DT);
    expect(d.mode).toBe('combat');
  });

  it('blends between providers over the configured duration; cuts are instant', () => {
    const d = new CameraDirector(rules, () => 1);
    d.push(new Fixed('base', 'exploration', 0, 0, false));
    d.update(DT);
    const combat = new Fixed('combat', 'combat', 10, 10);
    d.push(combat);
    const blend = rules.blends.combat as { duration: number };
    let p = d.update(blend.duration / 2)!;
    expect(p.position.x).toBeCloseTo(10 * ease('easeInOutCubic', 0.5), 5);
    p = d.update(blend.duration)!;
    expect(p.position.x).toBe(10);
    d.push(new Fixed('ult', 'ultimate', 40, 99, true, true));
    expect(d.update(DT)?.position.x).toBe(99);
    expect(d.letterbox).toBeGreaterThan(0);
  });

  it('plays data shots that gate input and return to exploration when they end', async () => {
    const d = new CameraDirector(rules, () => 1);
    const ex = new ExplorationProvider(rig(), 0, () => NO_CAMERA_INPUT);
    ex.reset({ x: 0, y: 0, z: 0 }, 0);
    d.push(ex);
    d.update(DT);
    const skill = shots.find((s) => s.mode === 'skill')!;
    let finished = false;
    void d.playShot(skill, () => ({ position: v3(0, 0, 0), yaw: 0 })).then(() => (finished = true));
    d.update(DT);
    expect(d.mode).toBe('skill');
    expect(d.inputGated).toBe(true);
    for (let t = 0; t < skill.duration + 0.1; t += DT) d.update(DT);
    await Promise.resolve();
    expect(finished).toBe(true);
    expect(d.mode).toBe('exploration');
    expect(d.inputGated).toBe(false);
  });

  it('fires shot shake profiles and respects the shake intensity setting', () => {
    const d = new CameraDirector(rules, () => 0);
    const ult = shots.find((s) => s.id === 'shot.ultimate')!;
    void d.playShot(ult, () => ({ position: v3(0, 0, 0), yaw: 0 }));
    let maxRoll = 0;
    for (let t = 0; t < 1.2; t += DT) maxRoll = Math.max(maxRoll, Math.abs(d.update(DT)!.roll));
    expect(d.trauma).toBeGreaterThan(0);
    expect(maxRoll).toBe(0);
  });
});

/** Player head inside the view frustum (aspect 16:9, near 0.1) for a pose. */
function inFrustum(p: CameraPose, head: { x: number; y: number; z: number }, aspect = 16 / 9): boolean {
  const f = { x: p.target.x - p.position.x, y: p.target.y - p.position.y, z: p.target.z - p.position.z };
  const fl = Math.hypot(f.x, f.y, f.z);
  const fw = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
  const rx = fw.z, rz = -fw.x;
  const rl = Math.hypot(rx, rz) || 1;
  const right = { x: rx / rl, y: 0, z: rz / rl };
  const up = { x: right.y * fw.z - right.z * fw.y, y: right.z * fw.x - right.x * fw.z, z: right.x * fw.y - right.y * fw.x };
  const d = { x: head.x - p.position.x, y: head.y - p.position.y, z: head.z - p.position.z };
  const depth = d.x * fw.x + d.y * fw.y + d.z * fw.z;
  if (depth < 0.25) return false;
  const t = Math.tan(((p.fov / 2) * Math.PI) / 180);
  const sx = (d.x * right.x + d.z * right.z) / depth;
  const sy = (d.x * up.x + d.y * up.y + d.z * up.z) / depth;
  return Math.abs(sy) <= t && Math.abs(sx) <= t * aspect;
}

describe('Revision 1: readable wall-hug / corner camera (regressions from validation)', () => {
  const spots: Array<[number, number, string]> = [
    // Wall midpoints and all four corners (hugging: 0.35 m capsule against the wall).
    [23.05, 0, 'east wall'],
    [-23.05, 0, 'west wall'],
    [0, 23.05, 'south wall'],
    [0, -23.05, 'north wall'],
    [23.05, 23.05, 'SE corner'],
    [23.05, -23.05, 'NE corner'],
    [-23.05, 23.05, 'SW corner'],
    [-23.05, -23.05, 'NW corner'],
    // Validator failures (p3-BAD-1..5).
    [23.05, 17.79, 'BAD-1'],
    [23.05, 1.59, 'BAD-2'],
    [-23.03, -12.95, 'BAD-3'],
    [-22.95, 1.21, 'BAD-4'],
    [-19.14, 6.41, 'BAD-5 steep ramp'],
  ];
  it.each(spots)('player at %f, %f (%s) stays framed and unoccluded through a full 360 spin', (x, z) => {
    const r = rig(0);
    const target = { x, y: 0, z };
    const head = v3(x, rules.exploration.focusHeight, z);
    r.reset(target, 0);
    const frames = Math.ceil((2 * Math.PI) / rules.exploration.rotateSpeed / DT) + 30;
    for (let i = 0; i < frames; i++) {
      const p = r.update(DT, target, input({ yawAxis: 1 }));
      const tag = `${x},${z} frame ${i} yaw ${r.yaw.toFixed(2)}`;
      expect(inFrustum(p, head), tag).toBe(true);
      expect(lineOfSightBlocked(level.colliders, p.position, head), tag).toBe(false);
      expect(Math.abs(p.position.x) < 23.4 && Math.abs(p.position.z) < 23.4, tag).toBe(true);
      expect(Math.hypot(p.position.x - head.x, p.position.y - head.y, p.position.z - head.z), tag).toBeGreaterThanOrEqual(rules.exploration.collision.minDistance - 0.15);
    }
  });

  it('keeps a usable distance (>= 1.2 m) when hugging walls, by sliding the yaw', () => {
    const r = rig(-Math.PI / 2); // camera wants to sit inside the east wall
    const target = { x: 23.05, y: 0, z: 0 };
    r.reset(target, -Math.PI / 2);
    for (let i = 0; i < 60; i++) r.update(DT, target, NO_CAMERA_INPUT);
    expect(r.distance).toBeGreaterThanOrEqual(1.2);
    expect(Math.abs(r.yawOffset)).toBeGreaterThan(0.2);
    expect(r.pitch + r.liftOffset).toBeLessThanOrEqual(rules.exploration.collision.maxLiftPitch + 1e-9);
  });

  it('never loses line of sight beside the west landing at full zoom (validator case)', () => {
    const r = rig(0.726);
    const target = { x: -4.9, y: 0, z: -7.25 };
    const head = v3(-4.9, rules.exploration.focusHeight, -7.25);
    r.zoom = r.zoomSmoothed = rules.exploration.distance.max;
    r.reset(target, 0.726);
    r.pitch = 0.538;
    for (let i = 0; i < 90; i++) {
      // Also walk along the landing's edge so the damped pivot lags.
      const t = { x: -4.9 + Math.sin(i / 10) * 0.4, y: 0, z: -7.25 + Math.abs(Math.sin(i / 7)) * 0.4 };
      const p = r.update(DT, t, NO_CAMERA_INPUT);
      expect(lineOfSightBlocked(level.colliders, p.position, v3(t.x, head.y, t.z))).toBe(false);
    }
  });

  it('makes the Ultimate shake observable for most of its follow-through', () => {
    const d = new CameraDirector(rules, () => 1);
    const ult = shots.find((s) => s.id === 'shot.ultimate')!;
    void d.playShot(ult, () => ({ position: v3(0, 0, 0), yaw: 0 }));
    let shaking = 0;
    let frames = 0;
    let maxRoll = 0;
    for (let t = 0; t < ult.duration; t += DT) {
      const p = d.update(DT)!;
      if (t >= ult.shake!.at) {
        frames++;
        if (d.trauma > 0.05) shaking++;
        maxRoll = Math.max(maxRoll, Math.abs(p.roll));
      }
    }
    expect(shaking / frames).toBeGreaterThan(0.6);
    expect(maxRoll).toBeGreaterThan(0.005);
  });
});

/**
 * Visible horizontal coverage (fraction of the frame width, 0..1) of the real placeholder figure
 * for a pose: every mesh vertex is projected with a THREE camera and the ones inside the visible
 * frame (below the letterbox bars) give the left and right edge. Also returns the NDC x of a world point (the speaker's face).
 */
function frameMetrics(p: CameraPose, figure: { x: number; z: number; yaw: number }, face: { x: number; y: number; z: number }): { coverage: number; faceX: number } {
  const cam = new THREE.PerspectiveCamera(p.fov, 16 / 9, 0.1, 100);
  cam.position.set(p.position.x, p.position.y, p.position.z);
  cam.lookAt(p.target.x, p.target.y, p.target.z);
  cam.updateMatrixWorld(true);
  const model = new PlaceholderCharacter(1.7);
  model.root.position.set(figure.x, 0, figure.z);
  model.root.rotation.y = figure.yaw;
  model.root.updateMatrixWorld(true);
  let lo = Infinity;
  let hi = -Infinity;
  const v = new THREE.Vector3();
  model.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(cam);
      // The letterbox bars (a fraction of the height each) hide the top and bottom of the frame.
      if (v.z > 1 || Math.abs(v.y) > 1 - 2 * rules.letterboxHeight) continue;
      lo = Math.min(lo, v.x);
      hi = Math.max(hi, v.x);
    }
  });
  const f = new THREE.Vector3(face.x, face.y, face.z).project(cam);
  return { coverage: hi < lo ? 0 : Math.max(0, Math.min(1, hi) - Math.max(-1, lo)) / 2, faceX: f.x };
}

describe('Phase 4 fixes: dialogue two-shot framing', () => {
  const stage = level.galleryStage!;
  const npc = level.markers.find((m) => m.id === 'dummy.npc')!;
  const units = (id: string) => {
    if (id === 'player') return { position: v3(...stage.position), yaw: stage.yaw };
    if (id === 'dummy.npc') return { position: v3(...npc.position), yaw: npc.yaw };
    return undefined;
  };

  it("keeps the listener's shoulder to a thin 15-20% edge of the frame and the speaker's face centred", () => {
    const shot = shots.find((s) => s.id === 'shot.dialogue-two-shot')!;
    for (const t of [0, 1, 2, 3, 4]) {
      const p = evaluateShot(shot, t, units);
      const m = frameMetrics(p, { x: stage.position[0], z: stage.position[2], yaw: stage.yaw }, { x: npc.position[0], y: npc.position[1] + 1.3, z: npc.position[2] });
      expect(m.coverage, `t=${t} coverage`).toBeGreaterThanOrEqual(0.15);
      expect(m.coverage, `t=${t} coverage`).toBeLessThanOrEqual(0.2);
      // The speaker's face (head height above the dummy) sits in the middle of the frame.
      expect(Math.abs(m.faceX), `t=${t} face`).toBeLessThan(0.35);
    }
  });
});
