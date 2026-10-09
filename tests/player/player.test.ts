import { describe, expect, it } from 'vitest';
import locomotionJson from '@data/rules/locomotion/default.json';
import levelJson from '@data/levels/test-level.json';
import partyJson from '@data/parties/default.json';
import { LevelSchema, LocomotionRulesSchema, PartySchema } from '@models/locomotion';
import {
  AnimationStateMachine,
  approachVelocity,
  CollisionWorld,
  moveDirection,
  NO_INPUT,
  OverworldController,
  PartyRoster,
  PromptList,
  interactablesInRange,
  selectAnimationState,
  selectGait,
  slopeDeg,
  surfaceHeight,
  turnToward,
  wrapAngle,
  type ControlInput,
  type ControllerEvent,
} from '@modules/player';

const rules = LocomotionRulesSchema.parse(locomotionJson);
const level = LevelSchema.parse(levelJson);
const party = PartySchema.parse(partyJson);
const DT = 1 / 60;

function makeController(spawn: [number, number, number] = [0, 0, 6], yaw = 0) {
  const events: ControllerEvent[] = [];
  const c = new OverworldController(rules, level.colliders, level.interactables, party.members, { position: spawn, yaw }, level.killHeight, (e) => events.push(e));
  return { c, events };
}
const hold = (c: OverworldController, input: Partial<ControlInput>, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) c.step(DT, { ...NO_INPUT, ...input });
};

describe('movement math', () => {
  it('moves camera-relative: forward follows the camera yaw, diagonals are normalised', () => {
    const f = moveDirection(0, 1, 0, 0.2);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(1);
    const turned = moveDirection(0, 1, Math.PI / 2, 0.2);
    expect(turned.x).toBeCloseTo(1);
    const right = moveDirection(1, 0, 0, 0.2);
    expect(right.x).toBeCloseTo(-1);
    const diag = moveDirection(1, 1, 0, 0.2);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1);
    expect(moveDirection(0.1, 0.1, 0, 0.2)).toEqual({ x: 0, z: 0 });
    // Partial stick tilt keeps its magnitude.
    expect(Math.hypot(moveDirection(0, 0.5, 0, 0.2).x, moveDirection(0, 0.5, 0, 0.2).z)).toBeCloseTo(0.5);
  });

  it('runs by default, walk is a toggle, sprint wins while held', () => {
    expect(selectGait(false, false, 'run')).toBe('run');
    expect(selectGait(true, false, 'run')).toBe('walk');
    expect(selectGait(true, true, 'run')).toBe('sprint');
  });

  it('accelerates and decelerates at the configured rates', () => {
    let v = { x: 0, z: 0 };
    v = approachVelocity(v, { x: 0, z: 5 }, 0.1, 28, 36);
    expect(v.z).toBeCloseTo(2.8);
    v = approachVelocity(v, { x: 0, z: 5 }, 1, 28, 36);
    expect(v.z).toBe(5);
    v = approachVelocity(v, { x: 0, z: 0 }, 0.1, 28, 36);
    expect(v.z).toBeCloseTo(1.4);
  });

  it('turns along the shortest arc at a limited rate', () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1);
    expect(turnToward(0, 0.05, 0.25)).toBeCloseTo(0.05);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
  });
});

describe('collision world', () => {
  const world = new CollisionWorld(level.colliders, rules.capsule);
  const ramp = level.colliders.find((c) => c.id === 'ramp-east')!;
  const steep = level.colliders.find((c) => c.id === 'ramp-steep')!;

  it('computes ramp surfaces and slopes', () => {
    expect(surfaceHeight(ramp, 4, -3)).toBeCloseTo(0);
    expect(surfaceHeight(ramp, 7, -3)).toBeCloseTo(1);
    expect(surfaceHeight(ramp, 10, -3)).toBeCloseTo(2);
    expect(slopeDeg(ramp)).toBeCloseTo(18.43, 1);
    expect(slopeDeg(steep)).toBeGreaterThan(rules.capsule.maxSlopeDeg);
  });

  it('pushes the capsule out of walls and keeps it off steep slopes', () => {
    const wall = world.resolveHorizontal(23.2, 0, 0);
    expect(wall.blocked).toBe(true);
    expect(wall.x).toBeCloseTo(23.4 - rules.capsule.radius);
    expect(world.groundAt(-17.5, 4, 0)?.collider.id).toBe('floor');
  });

  it('steps onto a 0.3 m step but not onto a 2 m platform', () => {
    expect(world.groundAt(-8, -4.3, 0)?.height).toBeCloseTo(0.3);
    expect(world.groundAt(12, -3, 0)?.height).toBe(0);
    expect(world.resolveHorizontal(9.8, 0.5, 0).blocked).toBe(true);
  });
});

describe('animation state machine (data-driven)', () => {
  it('selects states from the data thresholds and cross-fades', () => {
    expect(selectAnimationState(rules.animation, 0, 'run').id).toBe('idle');
    expect(selectAnimationState(rules.animation, 1.5, 'walk').id).toBe('walk');
    expect(selectAnimationState(rules.animation, 5, 'run').id).toBe('run');
    expect(selectAnimationState(rules.animation, 7.5, 'sprint').id).toBe('sprint');
    expect(selectAnimationState(rules.animation, 4, 'sprint').id).toBe('run');
    const sm = new AnimationStateMachine(rules.animation);
    const f1 = sm.update(DT, 5, 'run', 5 * DT);
    expect(f1.state.id).toBe('run');
    expect(f1.blend).toBeLessThan(1);
    let f = f1;
    for (let i = 0; i < 30; i++) f = sm.update(DT, 5, 'run', 5 * DT);
    expect(f.blend).toBe(1);
    expect(f.pose.lean).toBeCloseTo(0.14);
  });
});

describe('party and interaction list', () => {
  it('switches slots 1..4 and rejects empty / current slots', () => {
    const p = new PartyRoster(party.members);
    expect(p.leader).toBe('char.march-7th');
    expect(p.switchTo(2)).toBe(true);
    expect(p.leader).toBe('char.himeko');
    expect(p.switchTo(2)).toBe(false);
    expect(p.switchTo(7)).toBe(false);
    expect(new PartyRoster(['a']).switchTo(1)).toBe(false);
  });

  it('lists nearby interactables nearest first and scrolls the selection', () => {
    const near = interactablesInRange(level.interactables, 3.7, 0, 7, 2.6);
    expect(near.map((e) => e.interactable.id)).toEqual(['sign.corridor']);
    const list = new PromptList();
    list.update(interactablesInRange([...level.interactables, { ...level.interactables[0]!, id: 'sign.copy', position: [-1, 0, 3.5] }], -1.4, 0, 3.4, 2.6));
    expect(list.items).toHaveLength(2);
    const first = list.selected!.id;
    expect(list.scroll(1)).toBe(true);
    expect(list.selected!.id).not.toBe(first);
    expect(list.scroll(1)).toBe(false);
  });
});

describe('overworld controller on the test level', () => {
  it('runs at 5 m/s by default, sprints at 7.5 m/s, walks at 2 m/s', () => {
    const { c } = makeController();
    hold(c, { forward: 1 }, 1);
    expect(c.speed).toBeCloseTo(5);
    expect(c.frame.state.id).toBe('run');
    hold(c, { forward: 1, sprint: true }, 0.5);
    expect(c.speed).toBeCloseTo(7.5);
    expect(c.frame.state.id).toBe('sprint');
    c.step(DT, { ...NO_INPUT, forward: 1, walkTogglePressed: true });
    hold(c, { forward: 1 }, 0.5);
    expect(c.speed).toBeCloseTo(2);
    hold(c, {}, 0.5);
    expect(c.speed).toBe(0);
    expect(c.frame.state.id).toBe('idle');
  });

  it('turns toward the move direction', () => {
    const { c } = makeController([0, 0, 0], 0);
    hold(c, { right: 1 }, 0.5);
    expect(c.yaw).toBeCloseTo(-Math.PI / 2, 2);
  });

  it('climbs the ramp onto the platform', () => {
    const { c } = makeController([2, 0, -3], Math.PI / 2);
    hold(c, { forward: 1, cameraYaw: Math.PI / 2 }, 2.2);
    expect(c.x).toBeGreaterThan(10);
    expect(c.y).toBeCloseTo(2);
  });

  it('climbs the stairs step by step', () => {
    const { c } = makeController([-8, 0, -2], Math.PI);
    hold(c, { forward: 1, cameraYaw: Math.PI }, 2);
    expect(c.y).toBeCloseTo(1.8);
    expect(c.z).toBeLessThan(-7.6);
  });

  it('is blocked by the steep slope and by walls', () => {
    const { c } = makeController([-14, 0, 4], -Math.PI / 2);
    hold(c, { forward: 1, cameraYaw: -Math.PI / 2 }, 2);
    expect(c.x).toBeGreaterThan(-16 - 0.01);
    expect(c.y).toBeLessThan(0.05);
    const w = makeController([20, 0, 0], Math.PI / 2).c;
    hold(w, { forward: 1, cameraYaw: Math.PI / 2 }, 2);
    expect(w.x).toBeCloseTo(23.4 - rules.capsule.radius, 3);
  });

  it('fits through the narrow corridor', () => {
    const { c } = makeController([3.7, 0, 8], 0);
    hold(c, { forward: 1 }, 2.5);
    expect(c.z).toBeGreaterThan(19);
    expect(c.x).toBeGreaterThan(3 + rules.capsule.radius - 1e-6);
    expect(c.x).toBeLessThan(4.4 - rules.capsule.radius + 1e-6);
  });

  it('walks off the platform edge, falls and lands', () => {
    const { c } = makeController([15, 2, -3], Math.PI / 2);
    hold(c, { forward: 1, cameraYaw: Math.PI / 2 }, 0.4);
    hold(c, {}, 1);
    expect(c.grounded).toBe(true);
    expect(c.y).toBe(0);
  });

  it('emits alternating footsteps with the surface material', () => {
    const { c, events } = makeController();
    hold(c, { forward: 1 }, 1);
    const steps = events.filter((e) => e.type === 'footstep');
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps[0]).toMatchObject({ foot: 'left', material: 'floor', characterId: 'char.march-7th' });
    expect(steps[1]).toMatchObject({ foot: 'right' });
  });

  it('switches characters on 1-4 without moving', () => {
    const { c, events } = makeController();
    hold(c, { forward: 1 }, 0.5);
    const before = [c.x, c.z];
    c.step(DT, { ...NO_INPUT, slotPressed: 3 });
    expect(c.leader).toBe('char.welt');
    expect(events.find((e) => e.type === 'leaderChanged')).toMatchObject({ characterId: 'char.welt', slot: 3, previous: 'char.march-7th' });
    expect(Math.hypot(c.x - before[0]!, c.z - before[1]!)).toBeLessThan(0.2);
  });

  it('shows the sign prompt in range and interacts with F; E/Q fire the hooks with a cooldown', () => {
    const { c, events } = makeController([-1.6, 0, 4.5]);
    const prompts = events.filter((e) => e.type === 'prompts').at(-1);
    expect(prompts).toMatchObject({ prompts: [{ id: 'sign.welcome' }] });
    c.step(DT, { ...NO_INPUT, interactPressed: true });
    expect(events.at(-1)).toMatchObject({ type: 'interact', interactable: { id: 'sign.welcome' } });
    c.step(DT, { ...NO_INPUT, techniquePressed: true });
    c.step(DT, { ...NO_INPUT, attackPressed: true });
    expect(events.filter((e) => e.type === 'technique')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'overworldAttack')).toHaveLength(0);
    hold(c, {}, rules.actionCooldown + 0.05);
    c.step(DT, { ...NO_INPUT, attackPressed: true });
    expect(events.filter((e) => e.type === 'overworldAttack')).toHaveLength(1);
  });
});
