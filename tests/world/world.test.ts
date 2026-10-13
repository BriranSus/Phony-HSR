import { describe, expect, it } from 'vitest';
import worldRulesJson from '@data/rules/world/default.json';
import locomotionJson from '@data/rules/locomotion/default.json';
import worldJson from '@data/worlds/astral-demo.json';
import groundsJson from '@data/levels/test-level.json';
import deckJson from '@data/levels/observation-deck.json';
import snowJson from '@data/levels/snowfield-camp.json';
import { LevelSchema, LocomotionRulesSchema, type Level } from '@models/locomotion';
import { WorldRulesSchema, WorldSchema, type World, type WorldObject } from '@models/world';
import {
  EnemyAI,
  WorldGraph,
  WorldGraphError,
  WorldRuntime,
  WorldState,
  WorldStateError,
  angleToEnemy,
  areaProgress,
  attackAdvantage,
  awareness,
  combineProgress,
  contactAdvantage,
  inAttackCone,
  initialState,
  isSpent,
  nextState,
  platesSatisfied,
  pressSequence,
  requirementMet,
  validateWorldGraph,
  type AIContext,
  type PlayerPose,
  type WorldEvents,
} from '@modules/world';

const rules = WorldRulesSchema.parse(worldRulesJson);
const loco = LocomotionRulesSchema.parse(locomotionJson);
const world = WorldSchema.parse(worldJson);
const grounds = LevelSchema.parse(groundsJson);
const deck = LevelSchema.parse(deckJson);
const snow = LevelSchema.parse(snowJson);
const levels = new Map<string, Level>([grounds, deck, snow].map((l) => [l.id, l]));

const GROUNDS = 'level.test-grounds';
const DECK = 'level.observation-deck';
const SNOW = 'level.snowfield-camp';

function make(opts: { state?: WorldState; worldDef?: World; levelMap?: Map<string, Level> } = {}) {
  const events: Array<{ name: string; payload: unknown }> = [];
  const rt = new WorldRuntime({
    world: opts.worldDef ?? world,
    levels: opts.levelMap ?? levels,
    rules,
    capsule: loco.capsule,
    emit: (name, payload) => events.push({ name, payload }),
    state: opts.state,
  });
  return { rt, events, count: (name: keyof WorldEvents) => events.filter((e) => e.name === name).length };
}
const at = (x: number, z: number, yaw = 0, y = 0): PlayerPose => ({ x, y, z, yaw });
const objectOf = <K extends WorldObject['kind']>(level: Level, id: string, kind: K): Extract<WorldObject, { kind: K }> => {
  const o = level.interactables.find((x) => x.id === id);
  if (o?.kind !== kind) throw new Error(`${id} is not a ${kind}`);
  return o as Extract<WorldObject, { kind: K }>;
};
const FAR = at(-16, 16);

describe('interactable state machines', () => {
  const chest = objectOf(grounds, 'chest.platform', 'chest');
  const collect = objectOf(grounds, 'collect.shard-1', 'collectible');
  const crate = objectOf(grounds, 'breakable.crate', 'breakable');
  const press = objectOf(grounds, 'switch.ember', 'switch');
  const plate = objectOf(deck, 'plate.west', 'plate');
  const gate = objectOf(grounds, 'gate.puzzle', 'gate');
  const anchor = objectOf(grounds, 'anchor.calibration', 'anchor');

  it('starts every kind in its initial state', () => {
    expect([chest, collect, crate, press, plate, gate, anchor].map((d) => initialState(d))).toEqual(['closed', 'present', 'intact', 'off', 'idle', 'closed', 'dormant']);
    expect(initialState(objectOf(grounds, 'sign.welcome', 'sign'))).toBe('idle');
  });

  it('moves chests, collectibles, gates and anchors forward exactly once', () => {
    expect(nextState(chest, 'closed', 'interact')).toBe('opened');
    expect(nextState(chest, 'opened', 'interact')).toBeNull();
    expect(nextState(collect, 'present', 'interact')).toBe('collected');
    expect(nextState(collect, 'collected', 'interact')).toBeNull();
    expect(nextState(gate, 'closed', 'open')).toBe('open');
    expect(nextState(gate, 'open', 'open')).toBeNull();
    expect(nextState(anchor, 'dormant', 'interact')).toBe('active');
    expect(nextState(anchor, 'active', 'interact')).toBeNull();
  });

  it('breaks a breakable after its hit count, not before', () => {
    expect(crate.hits).toBe(2);
    expect(nextState(crate, 'intact', 'hit', 0)).toBe('intact');
    expect(nextState(crate, 'intact', 'hit', 1)).toBe('broken');
    expect(nextState(crate, 'broken', 'hit', 5)).toBeNull();
  });

  it('latches press switches, toggles toggle switches and releases plates', () => {
    expect(nextState(press, 'off', 'interact')).toBe('on');
    expect(nextState(press, 'on', 'interact')).toBeNull();
    expect(nextState(press, 'on', 'reset')).toBe('off');
    const toggle: WorldObject = { ...press, mode: 'toggle' };
    expect(nextState(toggle, 'on', 'interact')).toBe('off');
    expect(nextState(plate, 'idle', 'press')).toBe('pressed');
    expect(nextState(plate, 'pressed', 'release')).toBe('idle');
    expect(nextState(plate, 'idle', 'release')).toBeNull();
  });

  it('drops spent objects from the prompt list but keeps signs, anchors and portals', () => {
    expect(isSpent(chest, 'opened')).toBe(true);
    expect(isSpent(chest, 'closed')).toBe(false);
    expect(isSpent(anchor, 'active')).toBe(false);
    expect(isSpent(objectOf(grounds, 'sign.welcome', 'sign'), 'idle')).toBe(false);
    expect(isSpent(press, 'on')).toBe(true);
  });

  it('evaluates requirement clauses', () => {
    const ctx = { puzzleSolved: (id: string) => id === 'p', objectState: (id: string) => (id === 'o' ? 'open' : undefined), itemCount: (id: string) => (id === 'k' ? 2 : 0), hiddenDiscovered: (id: string) => id === 'h' };
    expect(requirementMet({ kind: 'puzzle', id: 'p' }, ctx)).toBe(true);
    expect(requirementMet({ kind: 'puzzle', id: 'q' }, ctx)).toBe(false);
    expect(requirementMet({ kind: 'object', id: 'o', state: 'open' }, ctx)).toBe(true);
    expect(requirementMet({ kind: 'item', id: 'k', count: 3, consume: false }, ctx)).toBe(false);
    expect(requirementMet({ kind: 'item', id: 'k', count: 2, consume: false }, ctx)).toBe(true);
    expect(requirementMet({ kind: 'hidden', id: 'h' }, ctx)).toBe(true);
  });
});

describe('puzzle logic', () => {
  const seq = grounds.puzzles[0]!;
  const plates = deck.puzzles[0]!;
  if (seq.type !== 'sequence' || plates.type !== 'plates') throw new Error('unexpected puzzle types');

  it('advances in order and solves on the last switch', () => {
    let p = pressSequence(seq, 0, 'switch.ember');
    expect(p).toEqual({ progress: 1, outcome: 'advance' });
    p = pressSequence(seq, p.progress, 'switch.frost');
    expect(p).toEqual({ progress: 2, outcome: 'advance' });
    expect(pressSequence(seq, p.progress, 'switch.gale')).toEqual({ progress: 3, outcome: 'solved' });
  });

  it('resets on a wrong or repeated switch', () => {
    expect(pressSequence(seq, 0, 'switch.gale')).toEqual({ progress: 0, outcome: 'failed' });
    expect(pressSequence(seq, 1, 'switch.ember')).toEqual({ progress: 0, outcome: 'failed' });
  });

  it('needs every plate held at once', () => {
    expect(platesSatisfied(plates, new Set(['plate.west']))).toBe(false);
    expect(platesSatisfied(plates, new Set(['plate.west', 'plate.east']))).toBe(true);
  });
});

describe('world graph validation', () => {
  it('accepts the shipped world: 2 regions, 3 areas, every portal resolves', () => {
    expect(world.regions).toHaveLength(2);
    expect(world.regions.flatMap((r) => r.areas)).toHaveLength(3);
    expect(validateWorldGraph(world, levels)).toEqual([]);
    const g = new WorldGraph(world, levels);
    expect(g.regionOf(SNOW).id).toBe('region.jarilo-vi');
    expect(g.regionOf(DECK).id).toBe('region.astral-express');
  });

  it('fails at load for an unknown area, a portal into another world and a missing arrival spawn', () => {
    const missingArea = WorldSchema.parse({ ...worldJson, regions: [{ id: 'region.a', name: 'A', areas: [GROUNDS, 'level.nowhere'] }] });
    expect(validateWorldGraph(missingArea, levels).join('\n')).toContain('unknown area "level.nowhere"');
    expect(() => new WorldGraph(missingArea, levels)).toThrow(WorldGraphError);

    const onlyGrounds = WorldSchema.parse({ ...worldJson, regions: [{ id: 'region.a', name: 'A', areas: [GROUNDS] }] });
    expect(validateWorldGraph(onlyGrounds, levels).join('\n')).toContain('not part of world');

    const badSpawn = LevelSchema.parse({
      ...groundsJson,
      interactables: groundsJson.interactables.map((o) => (o.id === 'portal.to-deck' ? { ...o, toSpawn: 'no-such-spawn' } : o)),
    });
    const problems = validateWorldGraph(world, new Map([...levels, [GROUNDS, badSpawn]]));
    expect(problems.join('\n')).toContain('arrival spawn "no-such-spawn"');

    const badStart = WorldSchema.parse({ ...worldJson, startSpawn: 'nope' });
    expect(validateWorldGraph(badStart, levels).join('\n')).toContain('startSpawn "nope"');
  });

  it('rejects broken local references in a level file', () => {
    const bad = (patch: Record<string, unknown>) => LevelSchema.safeParse({ ...groundsJson, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ puzzles: [{ ...groundsJson.puzzles[0], switches: ['switch.ember', 'switch.missing'] }] })).toBe(false);
    expect(bad({ hiddenAreas: [{ ...groundsJson.hiddenAreas[0], discover: { by: 'object', object: 'nothing' } }] })).toBe(false);
    expect(bad({ interactables: groundsJson.interactables.map((o) => (o.id === 'gate.puzzle' ? { ...o, collider: 'no-collider' } : o)) })).toBe(false);
    expect(bad({ interactables: groundsJson.interactables.map((o) => (o.id === 'gate.puzzle' ? { ...o, requires: [{ kind: 'puzzle', id: 'puzzle.missing' }] } : o)) })).toBe(false);
    expect(bad({ interactables: groundsJson.interactables.map((o) => (o.id === 'anchor.calibration' ? { ...o, spawn: 'no-spawn' } : o)) })).toBe(false);
    expect(bad({ interactables: [...groundsJson.interactables, groundsJson.interactables[0]] })).toBe(false);
  });
});

describe('exploration percentage', () => {
  it('counts chests, collectibles, puzzles and anchors, and rises as they are found', () => {
    const { rt } = make();
    rt.enterArea(GROUNDS);
    const before = rt.progress();
    expect(before.chests.total).toBe(3);
    expect(before.collectibles.total).toBe(4);
    expect(before.puzzles.total).toBe(1);
    expect(before.anchors.total).toBe(1);
    expect(before.total).toBe(9);
    expect(before.percent).toBe(0);
    rt.interact('chest.platform', at(13, 0, 0, 2));
    expect(rt.progress().found).toBe(1);
    expect(rt.progress().percent).toBe(Math.floor(100 / 9));
    rt.interact('anchor.calibration', at(-2, 0));
    expect(rt.progress().found).toBe(2);
    expect(rt.progress().percent).toBe(Math.floor(200 / 9));
  });

  it('treats an area with nothing to find as complete and aggregates by counts', () => {
    const { rt } = make();
    rt.enterArea(GROUNDS);
    const empty = LevelSchema.parse({ ...deckJson, interactables: [], puzzles: [], hiddenAreas: [] });
    expect(areaProgress('x', empty, rt.state).percent).toBe(100);
    const all = combineProgress([rt.progress(GROUNDS), rt.progress(DECK), rt.progress(SNOW)]);
    expect(all.total).toBe(rt.progress(GROUNDS).total + rt.progress(DECK).total + rt.progress(SNOW).total);
    expect(rt.worldProgress().total).toBe(all.total);
    expect(rt.regionProgress('region.jarilo-vi').total).toBe(rt.progress(SNOW).total);
  });
});

describe('world state', () => {
  it('round-trips through JSON with its schema version', () => {
    const { rt } = make();
    rt.enterArea(GROUNDS);
    rt.interact('chest.platform', at(13, 0, 0, 2));
    rt.interact('collect.shard-1', at(-16, 0));
    rt.update(0.5, at(-20, -21)); // discovers the alcove
    const json = JSON.parse(JSON.stringify(rt.toJSON()));
    expect(json.version).toBe(1);
    const restored = WorldState.fromJSON(json);
    expect(restored.toJSON()).toEqual(rt.toJSON());
    const { rt: rt2 } = make({ state: restored });
    rt2.enterArea(restored.data.area);
    expect(rt2.stateOf('chest.platform')).toBe('opened');
    expect(rt2.state.itemCount('credit')).toBe(1200);
    expect(rt2.hiddenAreas()[0]!.discovered).toBe(true);
    expect(rt2.prompts().some((p) => p.id === 'chest.platform')).toBe(false);
    expect(rt2.interact('chest.platform', at(13, 0, 0, 2)).type).toBe('none');
  });

  it('rejects unknown versions and malformed state', () => {
    const good = WorldState.fresh('world.astral-demo', GROUNDS).toJSON();
    expect(() => WorldState.fromJSON({ ...good, version: 99 })).toThrow(WorldStateError);
    expect(() => WorldState.fromJSON({ ...good, version: 0 })).toThrow(WorldStateError);
    expect(() => WorldState.fromJSON({ ...good, clock: -1 })).toThrow(WorldStateError);
    expect(() => WorldState.fromJSON({ ...good, items: { credit: 0 } })).toThrow(WorldStateError);
    expect(WorldState.fromJSON(JSON.stringify(good)).data.worldId).toBe('world.astral-demo');
  });

  it('takes items only when enough are held', () => {
    const s = WorldState.fresh('w', 'a');
    s.addItem('credit', 5);
    expect(s.takeItem('credit', 6)).toBe(false);
    expect(s.takeItem('credit', 5)).toBe(true);
    expect(s.itemCount('credit')).toBe(0);
  });
});

describe('encounter advantage rules', () => {
  const er = rules.encounter;
  it('maps enemy awareness to the attack advantage', () => {
    expect(awareness('idle')).toBe('unaware');
    expect(awareness('patrol')).toBe('unaware');
    expect(awareness('return')).toBe('unaware');
    expect(awareness('alert')).toBe('aware');
    expect(awareness('chase')).toBe('aware');
    expect(awareness('stunned')).toBe('stunned');
    expect(attackAdvantage(er, 'patrol')).toBe('playerStrike');
    expect(attackAdvantage(er, 'chase')).toBe('neutral');
    expect(attackAdvantage(er, 'stunned')).toBe('playerStrike');
  });

  it('calls contact from behind an ambush and frontal contact neutral', () => {
    // Player at the origin facing +z (yaw 0).
    expect(angleToEnemy(0, 0, 0, 0, 3)).toBeCloseTo(0);
    expect(contactAdvantage(er, 0, 0, 0, 0, 3)).toBe('neutral');
    expect(contactAdvantage(er, 0, 0, 0, 0, -3)).toBe('ambush');
    expect(contactAdvantage(er, 0, 0, 0, 3, 0)).toBe('neutral'); // 90 degrees: still in front of the threshold
    expect(contactAdvantage(er, 0, 0, 0, 3, -1)).toBe('ambush'); // beyond 100 degrees
  });

  it('keeps attacks to a cone in front of the player', () => {
    expect(inAttackCone(0, 0, 0, 0, 2, er.attackRange, er.attackArcDeg)).toBe(true);
    expect(inAttackCone(0, 0, 0, 0, -2, er.attackRange, er.attackArcDeg)).toBe(false);
    expect(inAttackCone(0, 0, 0, 0, er.attackRange + 1, er.attackRange, er.attackArcDeg)).toBe(false);
  });
});

describe('enemy AI states', () => {
  const free = (x: number, z: number, tx: number, tz: number, step: number) => {
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return { x, z };
    const s = Math.min(step, d);
    return { x: x + (dx / d) * s, z: z + (dz / d) * s };
  };
  const ctx = (px: number, pz: number, canSee = true): AIContext => ({ px, pz, canSee, move: free });
  const run = (ai: EnemyAI, seconds: number, c: AIContext, dt = 1 / 30) => {
    for (let t = 0; t < seconds; t += dt) ai.step(dt, c);
  };

  it('idles until it senses the player in its view cone, then alerts, chases and makes contact', () => {
    const ai = new EnemyAI({ x: 0, z: 0 }, 0, [], rules.enemy); // faces +z
    ai.step(0.1, ctx(0, -6)); // behind, beyond the close radius
    expect(ai.state).toBe('idle');
    ai.step(0.1, ctx(0, 20)); // too far
    expect(ai.state).toBe('idle');
    ai.step(0.1, ctx(0, 6, false)); // line of sight blocked
    expect(ai.state).toBe('idle');
    const r = ai.step(0.1, ctx(0, 6));
    expect(ai.state).toBe('alert');
    expect(r.detected).toBe(true);
    run(ai, rules.enemy.alertSeconds + 0.2, ctx(0, 6));
    expect(ai.state).toBe('chase');
    let contact = false;
    for (let t = 0; t < 5 && !contact; t += 1 / 30) contact = ai.step(1 / 30, ctx(0, 6)).contact;
    expect(contact).toBe(true);
    expect(Math.hypot(ai.x, ai.z - 6)).toBeLessThanOrEqual(rules.enemy.contactRadius + 0.2);
  });

  it('notices a close player even from behind', () => {
    const ai = new EnemyAI({ x: 0, z: 0 }, 0, [], rules.enemy);
    ai.step(0.1, ctx(0, -rules.enemy.closeRadius + 0.5));
    expect(ai.state).toBe('alert');
  });

  it('loses a distant player, returns home and rests', () => {
    const ai = new EnemyAI({ x: 0, z: 0 }, 0, [], rules.enemy);
    ai.step(0.1, ctx(0, 5));
    run(ai, rules.enemy.alertSeconds + 0.1, ctx(0, 5));
    expect(ai.state).toBe('chase');
    const far = ctx(0, rules.enemy.loseRadius + 40);
    run(ai, rules.enemy.loseSeconds + 0.5, far);
    expect(ai.state).toBe('return');
    run(ai, 60, far);
    expect(ai.state).toBe('idle');
    expect(Math.hypot(ai.x, ai.z)).toBeLessThan(0.5);
  });

  it('patrols its waypoints with a pause at each one', () => {
    const ai = new EnemyAI({ x: 0, z: 0 }, 0, [[0, 0], [4, 0]], rules.enemy);
    expect(ai.state).toBe('patrol');
    const none = ctx(0, 500);
    run(ai, 4, none);
    expect(ai.x).toBeGreaterThan(3);
    run(ai, 12, none);
    expect(ai.x).toBeLessThan(4.5);
    expect(ai.state).toBe('patrol');
  });

  it('is stunned by the Technique, cannot make contact, then recovers', () => {
    const ai = new EnemyAI({ x: 0, z: 0 }, 0, [], rules.enemy);
    ai.step(0.1, ctx(0, 5));
    ai.stun();
    expect(ai.state).toBe('stunned');
    const r = ai.step(0.1, ctx(0, 0.2));
    expect(r.contact).toBe(false);
    const seen = new Set<string>();
    for (let t = 0; t < rules.enemy.stunSeconds + 0.5; t += 1 / 30) {
      ai.step(1 / 30, ctx(0, 500));
      seen.add(ai.state);
    }
    expect(seen.has('return')).toBe(true);
    expect(ai.state).toBe('idle');
  });
});

describe('world runtime: interactables, puzzles and areas', () => {
  it('opens a chest once, grants its rewards and removes the prompt', () => {
    const { rt, count } = make();
    rt.enterArea(GROUNDS);
    expect(rt.prompts().some((p) => p.id === 'chest.platform')).toBe(true);
    const r = rt.interact('chest.platform', at(13, 0, 0, 2));
    expect(r.type).toBe('message');
    if (r.type === 'message') expect(r.rewards).toEqual([{ item: 'credit', count: 1200 }, { item: 'ancient-part', count: 3 }]);
    expect(rt.state.itemCount('credit')).toBe(1200);
    expect(rt.state.itemCount('ancient-part')).toBe(3);
    expect(count('world:chestOpened')).toBe(1);
    expect(count('world:itemCollected')).toBe(2);
    expect(rt.interact('chest.platform', at(13, 0, 0, 2)).type).toBe('none');
    expect(rt.state.itemCount('credit')).toBe(1200);
    expect(rt.prompts().some((p) => p.id === 'chest.platform')).toBe(false);
  });

  it('collects pickups and counts them', () => {
    const { rt, count } = make();
    rt.enterArea(GROUNDS);
    expect(rt.interact('collect.shard-1', at(-16, 0)).type).toBe('none');
    expect(rt.state.itemCount('ancient-part')).toBe(1);
    expect(rt.interact('collect.shard-1', at(-16, 0)).type).toBe('none');
    expect(count('world:itemCollected')).toBe(1);
    expect(rt.progress().collectibles.found).toBe(1);
  });

  it('solves the order puzzle, opens its gate and unlocks the chest and the camp portal', () => {
    const { rt, events, count } = make();
    rt.enterArea(GROUNDS);
    const p = at(14, 0, 0);
    expect(rt.interact('gate.puzzle', p).type).toBe('locked');
    expect(rt.interact('portal.to-snowfield', p).type).toBe('locked');
    rt.interact('switch.frost', p); // wrong first press
    expect(count('world:puzzleFailed')).toBe(1);
    expect(rt.stateOf('switch.frost')).toBe('off');
    rt.interact('switch.ember', p);
    rt.interact('switch.frost', p);
    expect(rt.stateOf('gate.puzzle')).toBe('closed');
    rt.interact('switch.gale', p);
    expect(count('world:puzzleSolved')).toBe(1);
    expect(rt.stateOf('gate.puzzle')).toBe('open');
    expect(rt.colliders.some((c) => c.id === 'gate-puzzle')).toBe(false);
    expect(rt.state.itemCount('ancient-spindle')).toBe(2); // puzzle reward
    expect(rt.progress().puzzles.found).toBe(1);
    expect(events.some((e) => e.name === 'world:objectChanged' && (e.payload as { objectId: string }).objectId === 'gate.puzzle')).toBe(true);
    rt.interact('chest.puzzle', p);
    expect(rt.state.itemCount('quest.camp-pass')).toBe(1);
    const t = rt.interact('portal.to-snowfield', p);
    expect(t).toEqual({ type: 'transition', area: SNOW, spawn: 'from-grounds', via: 'portal.to-snowfield' });
  });

  it('only lets the one-way shortcut open from its own side', () => {
    const { rt } = make();
    rt.enterArea(GROUNDS);
    expect(rt.interact('gate.shortcut', at(6, 16)).type).toBe('locked');
    expect(rt.colliders.some((c) => c.id === 'gate-shortcut')).toBe(true);
    expect(rt.interact('gate.shortcut', at(10, 16)).type).toBe('toast');
    expect(rt.colliders.some((c) => c.id === 'gate-shortcut')).toBe(false);
  });

  it('discovers a hidden area by entering it, revealing its objects and fading the veil in', () => {
    const { rt, count } = make();
    rt.enterArea(GROUNDS);
    expect(rt.prompts().some((p) => p.id === 'collect.hidden-1')).toBe(false);
    expect(rt.interact('collect.hidden-1', at(-20, -21)).type).toBe('none');
    rt.update(0.1, at(0, 6));
    expect(count('world:hiddenAreaDiscovered')).toBe(0);
    rt.update(0.1, at(-20, -21));
    expect(count('world:hiddenAreaDiscovered')).toBe(1);
    expect(rt.prompts().some((p) => p.id === 'collect.hidden-1')).toBe(true);
    const r0 = rt.hiddenAreas()[0]!.reveal;
    rt.update(rules.hiddenFadeSeconds, at(-20, -21));
    expect(rt.hiddenAreas()[0]!.reveal).toBeGreaterThan(r0);
    expect(rt.hiddenAreas()[0]!.reveal).toBe(1);
    rt.update(0.1, at(-20, -21));
    expect(count('world:hiddenAreaDiscovered')).toBe(1);
  });

  it('breaks a cracked wall with attacks to reveal a hidden nook', () => {
    const { rt, count } = make();
    rt.enterArea(DECK);
    const p = at(8.4, 0, Math.PI / 2);
    expect(rt.colliders.some((c) => c.id === 'cracked-wall')).toBe(true);
    for (let i = 0; i < 2; i++) expect(rt.attack(p)).toMatchObject({ type: 'breakable', broken: false });
    expect(rt.attack(p)).toMatchObject({ type: 'breakable', broken: true, hits: 3, needed: 3 });
    expect(rt.colliders.some((c) => c.id === 'cracked-wall')).toBe(false);
    expect(count('world:hiddenAreaDiscovered')).toBe(1);
    expect(rt.prompts().some((o) => o.id === 'collect.deck-secret')).toBe(true);
    expect(rt.attack(p).type).toBe('miss');
  });

  it('solves the plate and crate puzzle: a pushed crate and the player hold both plates', () => {
    const { rt, count } = make();
    rt.enterArea(DECK);
    const pusher = at(-5, 5, Math.PI);
    for (let i = 0; i < 3; i++) rt.interact('crate.weight', pusher);
    rt.update(0.05, at(0, 5));
    expect(rt.stateOf('plate.west')).toBe('pressed');
    expect(rt.stateOf('plate.east')).toBe('idle');
    expect(count('world:puzzleSolved')).toBe(0);
    expect(rt.interact('gate.vault', at(0, -5)).type).toBe('locked');
    rt.update(0.05, at(5, -3));
    expect(rt.stateOf('plate.east')).toBe('pressed');
    expect(count('world:puzzleSolved')).toBe(1);
    expect(rt.stateOf('gate.vault')).toBe('open');
    expect(rt.colliders.some((c) => c.id === 'gate-vault')).toBe(false);
    // The solution latches even after the player steps off.
    rt.update(0.05, at(0, 5));
    expect(rt.stateOf('gate.vault')).toBe('open');
  });

  it('stops a crate at walls and other colliders', () => {
    const { rt } = make();
    rt.enterArea(DECK);
    // Push the crate west into the wall: it moves until the wall blocks it.
    const east = at(-1, 3, -Math.PI / 2);
    let moved = 0;
    for (let i = 0; i < 6; i++) {
      const r = rt.interact('crate.weight', east);
      if (r.type === 'toast') break;
      moved++;
    }
    expect(moved).toBeLessThan(4);
    expect(rt.interact('crate.weight', east)).toMatchObject({ type: 'toast' });
  });

  it('activates anchors and teleports between them across areas', () => {
    const { rt, count } = make();
    rt.enterArea(GROUNDS);
    expect(rt.anchors()).toHaveLength(0);
    expect(rt.interact('anchor.calibration', at(-2, 13))).toEqual({ type: 'anchorMenu', anchorId: 'anchor.calibration' });
    expect(count('world:anchorActivated')).toBe(1);
    rt.interact('anchor.calibration', at(-2, 13));
    expect(count('world:anchorActivated')).toBe(1);
    const arrive = rt.enterArea(DECK, 'from-grounds');
    expect(arrive.position).toEqual([0, 0, 7]);
    rt.interact('anchor.deck', at(7, 5));
    const list = rt.anchors();
    expect(list.map((a) => a.areaId).sort()).toEqual([GROUNDS, DECK].sort());
    expect(list.find((a) => a.areaId === DECK)!.current).toBe(true);
    const there = rt.teleportToAnchor(list.find((a) => a.areaId === GROUNDS)!.key)!;
    expect(there.areaId).toBe(GROUNDS);
    expect(there.position).toEqual([-2, 0, 12.4]);
    expect(rt.areaId).toBe(GROUNDS);
    expect(count('world:teleported')).toBe(1);
    expect(rt.teleportToAnchor('level.nowhere/anchor.x')).toBeNull();
  });

  it('keeps state across area transitions and reloads live colliders per area', () => {
    const { rt, count } = make();
    rt.enterArea(GROUNDS);
    const groundsCount = rt.colliders.length;
    rt.interact('chest.platform', at(13, 0, 0, 2));
    rt.enterArea(DECK);
    expect(rt.colliders.length).toBe(deck.colliders.length + 1); // + the crate
    expect(rt.areaId).toBe(DECK);
    expect(count('world:areaEntered')).toBe(2);
    expect(rt.state.itemCount('credit')).toBe(1200);
    rt.enterArea(GROUNDS);
    expect(rt.colliders.length).toBe(groundsCount);
    expect(rt.stateOf('chest.platform')).toBe('opened');
    expect(rt.state.data.visited).toEqual([GROUNDS, DECK]);
  });

  it('emits the talked-to-NPC event for the conductor', () => {
    const { rt, events } = make();
    rt.enterArea(GROUNDS);
    const r = rt.interact('npc.conductor', at(-8.5, 0, 0, 1.8));
    expect(r).toMatchObject({ type: 'message', speaker: 'Pom-Pom' });
    expect(events.find((e) => e.name === 'world:npcTalked')?.payload).toEqual({ npcId: 'npc.conductor', areaId: GROUNDS });
  });
});

describe('world runtime: enemies and encounters', () => {
  const FROST = { x: 10, z: -12 };
  /** Snowfield with only the idle Frostspawn (which faces -z), so other patrols cannot interfere. */
  const frostOnly = new Map<string, Level>([...levels, [SNOW, { ...snow, enemySpawns: snow.enemySpawns.filter((s) => s.id === 'spawn.frost') }]]);

  it('loads the overworld enemies from data with their patrol and rest states', () => {
    const { rt } = make();
    rt.enterArea(SNOW, 'from-grounds');
    const e = rt.enemies();
    expect(e.map((x) => x.spawnId).sort()).toEqual(['spawn.beetle', 'spawn.frost', 'spawn.patrol']);
    expect(e.find((x) => x.spawnId === 'spawn.patrol')!.enemies).toEqual(['enemy.silvermane-soldier', 'enemy.silvermane-soldier']);
    expect(e.find((x) => x.spawnId === 'spawn.frost')!.state).toBe('idle');
    expect(e.find((x) => x.spawnId === 'spawn.patrol')!.state).toBe('patrol');
  });

  it('gives the player a strike on an unaware enemy and returns to exploration afterwards', () => {
    const { rt, events, count } = make();
    rt.enterArea(SNOW);
    const r = rt.attack(at(FROST.x, FROST.z + 1.6, Math.PI));
    expect(r).toEqual({ type: 'enemy', spawnId: 'spawn.frost', advantage: 'playerStrike' });
    expect(rt.encounter?.advantage).toBe('playerStrike');
    expect(rt.encounter?.enemies).toEqual(['enemy.frostspawn']);
    expect(count('world:encounterStarted')).toBe(1);
    // The world is paused while the encounter is pending.
    rt.update(5, FAR);
    rt.endEncounter();
    expect(rt.encounter).toBeNull();
    expect(count('world:enemyDefeated')).toBe(1);
    expect(events.find((e) => e.name === 'world:encounterEnded')?.payload).toMatchObject({ result: 'placeholder-victory' });
    expect(rt.enemies().some((x) => x.spawnId === 'spawn.frost')).toBe(false);
  });

  it('gets detected, then a frontal contact is neutral and one from behind is an ambush', () => {
    for (const [yaw, expected] of [[0, 'neutral'], [Math.PI, 'ambush']] as const) {
      const { rt, count } = make({ levelMap: frostOnly });
      rt.enterArea(SNOW);
      // The Frostspawn faces -z, so the player stands in front of it (at z - 5).
      const player = at(FROST.x, FROST.z - 5, yaw);
      let t = 0;
      while (!rt.encounter && t < 20) {
        rt.update(1 / 30, player);
        t += 1 / 30;
      }
      expect(count('world:enemyDetected')).toBeGreaterThan(0);
      expect(rt.encounter?.trigger).toBe('contact');
      // The enemy is at +z of the player: yaw 0 faces it, yaw pi has it behind.
      expect(rt.encounter?.advantage, `yaw ${yaw}`).toBe(expected);
    }
  });

  it('attacking an enemy that already noticed the player is neutral; stunning it first is a strike', () => {
    const { rt } = make({ levelMap: frostOnly });
    rt.enterArea(SNOW);
    const p = at(FROST.x, FROST.z - 4, 0);
    for (let t = 0; t < 0.4; t += 0.05) rt.update(0.05, p);
    expect(rt.enemies().find((e) => e.spawnId === 'spawn.frost')!.state).toBe('alert');
    expect(rt.technique(p)).toBeGreaterThanOrEqual(1);
    expect(rt.enemies().find((e) => e.spawnId === 'spawn.frost')!.state).toBe('stunned');
    const close = at(FROST.x, FROST.z - 1.5, 0);
    expect(rt.attack(close)).toMatchObject({ type: 'enemy', advantage: 'playerStrike' });
  });

  it('respawns defeated enemies by rule: on re-entry, after a timer, or never', () => {
    const { rt } = make();
    rt.enterArea(SNOW);
    const defeat = (id: string, pos: [number, number], yaw: number) => {
      rt.attack(at(pos[0], pos[1] + 1.5, yaw));
      expect(rt.encounter?.spawnId).toBe(id);
      rt.endEncounter();
    };
    defeat('spawn.frost', [FROST.x, FROST.z], Math.PI);
    expect(rt.enemies().some((e) => e.spawnId === 'spawn.frost')).toBe(false);
    // 'reenter': back after the area is entered again, not by waiting.
    for (let t = 0; t < 120; t++) rt.update(1, FAR);
    expect(rt.enemies().some((e) => e.spawnId === 'spawn.frost')).toBe(false);
    rt.enterArea(DECK);
    rt.enterArea(SNOW);
    expect(rt.enemies().some((e) => e.spawnId === 'spawn.frost')).toBe(true);

    // 'timer' (40 s): the soldiers come back by themselves.
    const patrol = rt.enemies().find((e) => e.spawnId === 'spawn.patrol')!;
    rt.attack(at(patrol.x, patrol.z + 1.5, Math.PI));
    expect(rt.encounter?.spawnId).toBe('spawn.patrol');
    rt.endEncounter();
    expect(rt.enemies().some((e) => e.spawnId === 'spawn.patrol')).toBe(false);
    for (let t = 0; t < 30; t++) rt.update(1, FAR);
    expect(rt.enemies().some((e) => e.spawnId === 'spawn.patrol')).toBe(false);
    for (let t = 0; t < 20; t++) rt.update(1, FAR);
    expect(rt.enemies().some((e) => e.spawnId === 'spawn.patrol')).toBe(true);
  });

  it('never respawns a group whose rule is "never"', () => {
    const never: Level = { ...snow, enemySpawns: snow.enemySpawns.map((s) => (s.id === 'spawn.frost' ? { ...s, respawn: { mode: 'never' as const } } : s)) };
    const { rt } = make({ levelMap: new Map([...levels, [SNOW, never]]) });
    rt.enterArea(SNOW);
    rt.attack(at(FROST.x, FROST.z + 1.5, Math.PI));
    rt.endEncounter();
    rt.enterArea(DECK);
    rt.enterArea(SNOW);
    for (let t = 0; t < 400; t++) rt.update(1, FAR);
    expect(rt.enemies().some((e) => e.spawnId === 'spawn.frost')).toBe(false);
  });
});
