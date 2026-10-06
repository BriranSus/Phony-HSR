import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DataRegistry, DataValidationError, InMemoryDataSource, defineCollection } from '@core/data/DataRegistry';

const Weapons = defineCollection({
  name: 'weapons',
  dir: 'weapons',
  format: 'item',
  schema: z.object({ id: z.string(), damage: z.number().positive(), appliesStatus: z.string().optional() }).strict(),
  references: (w) => (w.appliesStatus ? [{ collection: 'statuses', id: w.appliesStatus, at: 'appliesStatus' }] : []),
  validate: (w) => (w.damage > 9000 ? ['damage is over 9000'] : []),
});

const Statuses = defineCollection({
  name: 'statuses',
  dir: 'statuses',
  format: 'list',
  schema: z.object({ id: z.string(), turns: z.number().int() }).strict(),
});

function registry(): DataRegistry {
  return new DataRegistry().registerAll([Weapons, Statuses]);
}

describe('DataRegistry', () => {
  it('loads item and list collections, indexes them by id and reports progress', async () => {
    const r = registry();
    const progress = vi.fn();
    const report = await r.load(
      new InMemoryDataSource({
        'weapons/sword.json': { id: 'sword', damage: 10, appliesStatus: 'bleed' },
        'weapons/bow.json': { id: 'bow', damage: 7 },
        'statuses/all.json': [
          { id: 'bleed', turns: 2 },
          { id: 'burn', turns: 2 },
        ],
      }),
      { onProgress: progress },
    );
    expect(report.issues).toEqual([]);
    expect(report.counts).toEqual({ weapons: 2, statuses: 2 });
    expect(r.get(Weapons, 'sword').damage).toBe(10);
    expect(r.all(Statuses).map((s) => s.id)).toEqual(['bleed', 'burn']);
    expect(r.find(Weapons, 'axe')).toBeUndefined();
    expect(() => r.get(Weapons, 'axe')).toThrow(/No "weapons" item/);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ loaded: 3, total: 3 });
  });

  it('collects schema errors with file and field paths', async () => {
    const r = registry();
    const report = await r.load(new InMemoryDataSource({ 'weapons/bad.json': { id: 'bad', damage: -1, extra: true } }), { strict: false });
    expect(report.issues.map((i) => i.kind)).toEqual(['schema', 'schema']);
    expect(report.issues[0]?.file).toBe('weapons/bad.json');
    expect(report.issues.map((i) => i.message).join('\n')).toMatch(/damage/);
  });

  it('detects duplicate ids across files', async () => {
    const report = await registry().load(
      new InMemoryDataSource({ 'weapons/a.json': { id: 'same', damage: 1 }, 'weapons/b.json': { id: 'same', damage: 2 } }),
      { strict: false },
    );
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ kind: 'duplicate-id', id: 'same', file: 'weapons/b.json' });
  });

  it('reports dangling cross-collection references and semantic problems', async () => {
    const report = await registry().load(
      new InMemoryDataSource({ 'weapons/a.json': { id: 'a', damage: 9001, appliesStatus: 'poison' }, 'statuses/s.json': [] }),
      { strict: false },
    );
    expect(report.issues.map((i) => i.kind).sort()).toEqual(['missing-reference', 'semantic']);
    expect(report.issues.find((i) => i.kind === 'missing-reference')?.message).toMatch(/statuses "poison"/);
  });

  it('throws a DataValidationError in strict mode', async () => {
    await expect(registry().load(new InMemoryDataSource({ 'weapons/a.json': { id: 'a' } }))).rejects.toBeInstanceOf(DataValidationError);
  });

  it('flags files outside any collection and non-array list files', async () => {
    const report = await registry().load(new InMemoryDataSource({ 'misc/x.json': {}, 'statuses/oops.json': { id: 'x', turns: 1 } }), { strict: false });
    expect(report.issues.map((i) => i.kind).sort()).toEqual(['schema', 'unassigned-file']);
  });

  it('refuses duplicate collection names or directories', () => {
    const r = registry();
    expect(() => r.register(Weapons)).toThrow(/already registered/);
    expect(() => r.register({ ...Statuses, name: 'statuses2' })).toThrow(/directory/);
  });

  it('maps file paths to collections by the longest directory prefix', () => {
    const r = new DataRegistry().registerAll([
      { ...Statuses, name: 'relics', dir: 'relics' },
      { ...Statuses, name: 'relicSets', dir: 'relics/sets' },
    ]);
    expect(r.collectionForPath('relics/sets/a.json')?.name).toBe('relicSets');
    expect(r.collectionForPath('relics/b.json')?.name).toBe('relics');
  });
});
