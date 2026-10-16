import { DataRegistry } from '@core/data/DataRegistry';
import { createBundledDataSource } from '@app/dataSource';
import { ALL_COLLECTIONS } from '@models/collections';
import { Battle, combatDataFrom, type BattleConfig, type CombatData, type PartyMemberSpec } from '@modules/combat';

let cached: Promise<{ registry: DataRegistry; data: CombatData }> | null = null;

/** The bundled game data, loaded once per test file. */
export function loadCombatData(): Promise<{ registry: DataRegistry; data: CombatData }> {
  cached ??= (async () => {
    const registry = new DataRegistry().registerAll(ALL_COLLECTIONS);
    await registry.load(createBundledDataSource(), { strict: true });
    return { registry, data: combatDataFrom(registry) };
  })();
  return cached;
}

export const STARTERS = ['char.march-7th', 'char.dan-heng', 'char.himeko', 'char.welt'];

export const party = (ids: readonly string[] = STARTERS, level = 80, ascension = 6): PartyMemberSpec[] => ids.map((characterId) => ({ characterId, level, ascension }));

export function makeBattle(data: CombatData, o: Partial<BattleConfig> & { enemies?: string[] } = {}): Battle {
  const { enemies, ...rest } = o;
  return new Battle({ data, party: party(), waves: [enemies ?? ['enemy.silvermane-soldier']], enemyLevel: 50, seed: 1, ...rest });
}

/** A simple auto-player: Ultimate when ready, Skill when SP allows, else Basic ATK on the first valid target. */
export function autoPlay(b: Battle, maxTurns = 400): void {
  b.start();
  for (let guard = 0; guard < maxTurns * 10 && b.outcome === 'ongoing'; guard++) {
    for (const u of b.units) {
      if (u.side === 'ally' && u.presence === 'active' && b.canUltimate(u)) {
        const t = b.selectableTargets(u.uid, 'ultimate')[0];
        b.queueUltimate(u.uid, t?.uid ?? u.uid);
      }
    }
    const r = b.step();
    if (r.kind === 'awaiting') {
      const uid = r.uid;
      const skill = b.canUse(uid, 'skill').ok;
      const slot = skill ? 'skill' : 'basic';
      const targets = b.selectableTargets(uid, slot);
      b.submit({ type: slot, actor: uid, target: targets[0]?.uid ?? uid });
    }
    if (b.turns > maxTurns) break;
  }
}

/**
 * Test fixtures layered over the real data: harmless, very tough training dummies, so tests can pin
 * exact numbers without allies dying or enemies being killed by the first break. The real enemies
 * are used wherever their data is the point of the test.
 *
 *   test.dummy    normal rank, Lv-scaled HP 100000 base, 20 toughness, weak to Wind, one tiny attack
 *   test.elite    the same with rank "elite" (Wind Shear gets 3 stacks, Bleed uses the elite ratio)
 *   test.charger  an enemy whose only ability needs one charge turn
 */
export function withFixtures(data: CombatData): CombatData {
  const soldier = data.enemy('enemy.silvermane-soldier');
  const attack = soldier.abilities[0]!;
  const dummy = (id: string, rank: 'normal' | 'elite', extra: Partial<typeof soldier> = {}): typeof soldier => ({
    ...soldier,
    id,
    name: id === 'test.elite' ? 'Training Elite' : 'Training Dummy',
    rank,
    baseStats: { hp: 100000, atk: 0.0001, spd: 83, effectHitRate: 0, effectRes: 0.1 },
    toughness: 20,
    weaknesses: ['Wind'],
    resistances: {},
    abilities: [{ ...attack, id: `${id}.poke`, effects: [{ kind: 'damage', target: 'primary', stat: 'atk', multiplier: 3, source: 'self', element: 'Physical', toughness: 0 }] }],
    lootTable: undefined,
    ...extra,
  });
  const fixtures = new Map([
    ['test.dummy', dummy('test.dummy', 'normal')],
    ['test.elite', dummy('test.elite', 'elite')],
    ['test.charger', dummy('test.charger', 'normal', { abilities: [{ ...attack, id: 'test.charger.slam', chargeTurns: 1, effects: [{ kind: 'damage', target: 'primary', stat: 'atk', multiplier: 3, source: 'self', element: 'Physical', toughness: 0 }] }] })],
  ]);
  const protectedStatus = { ...data.status('enemy.weakness-protected'), id: 'test.protected', toughnessProtection: 'always' as const };
  return { ...data, enemy: (id) => fixtures.get(id) ?? data.enemy(id), status: (id) => (id === 'test.protected' ? protectedStatus : data.status(id)) };
}

/** Steps until `uid`'s turn; other allies act with a plain Basic ATK on the first enemy. */
export function until(b: Battle, uid: string, max = 300): boolean {
  for (let i = 0; i < max; i++) {
    const r = b.step();
    if (r.kind === 'awaiting' && r.uid === uid) return true;
    if (r.kind === 'ended') return false;
    if (r.kind === 'awaiting') b.submit({ type: 'basic', actor: r.uid, target: b.selectableTargets(r.uid, 'basic')[0]?.uid ?? r.uid });
  }
  return false;
}
