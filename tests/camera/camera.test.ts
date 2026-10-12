import { describe, expect, it } from 'vitest';
import rulesJson from '@data/camera/rules/default.json';
import shotsJson from '@data/camera/shots/gallery.json';
import levelJson from '@data/levels/test-level.json';
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
    expect(s.trauma).toBeCloseTo(0.9);
    s.update(0.25);
    expect(s.trauma).toBeCloseTo(0.9 - 1.4 * 0.25);
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
