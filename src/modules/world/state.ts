import { WORLD_STATE_VERSION, WorldStateSchema, type WorldStateData } from '@models/world';

/**
 * Serialisable world progress (opened chests, collected items, solved puzzles, activated anchors,
 * discovered hidden areas, defeated enemies, the items granted, the world clock). Everything is
 * keyed by ids from data, never by runtime handles, so a save can be restored against any build
 * that still has those ids. `toJSON` / `fromJSON` round-trip it with a schema version so the
 * Phase 21 save system can migrate older saves.
 */
export type WorldMigration = (old: Record<string, unknown>) => Record<string, unknown>;

/** Migrations from version N to N + 1 (none yet; the table exists so version 2 has a home). */
const MIGRATIONS: Readonly<Record<number, WorldMigration>> = {};

export class WorldStateError extends Error {
  override readonly name = 'WorldStateError';
}

export const objectKey = (areaId: string, id: string): string => `${areaId}/${id}`;

export class WorldState {
  constructor(readonly data: WorldStateData) {}

  static fresh(worldId: string, startArea: string): WorldState {
    return new WorldState({ version: WORLD_STATE_VERSION, worldId, area: startArea, visited: [], objects: {}, puzzles: {}, discovered: [], defeated: {}, items: {}, clock: 0 });
  }

  toJSON(): WorldStateData {
    return structuredClone(this.data);
  }

  static fromJSON(json: unknown): WorldState {
    let raw = (typeof json === 'string' ? JSON.parse(json) : structuredClone(json)) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') throw new WorldStateError('world state must be an object');
    let version = Number(raw.version);
    if (!Number.isInteger(version) || version < 1) throw new WorldStateError('world state has no valid version');
    if (version > WORLD_STATE_VERSION) throw new WorldStateError(`world state version ${version} is newer than supported (${WORLD_STATE_VERSION})`);
    while (version < WORLD_STATE_VERSION) {
      const migrate = MIGRATIONS[version];
      if (!migrate) throw new WorldStateError(`no migration from world state version ${version}`);
      raw = { ...migrate(raw), version: ++version };
    }
    const parsed = WorldStateSchema.safeParse(raw);
    if (!parsed.success) throw new WorldStateError(`invalid world state: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return new WorldState(parsed.data);
  }

  itemCount(id: string): number {
    return this.data.items[id] ?? 0;
  }

  addItem(id: string, count: number): void {
    this.data.items[id] = this.itemCount(id) + count;
  }

  /** Takes `count`; returns false (and takes nothing) if there are not enough. */
  takeItem(id: string, count: number): boolean {
    const have = this.itemCount(id);
    if (have < count) return false;
    if (have === count) delete this.data.items[id];
    else this.data.items[id] = have - count;
    return true;
  }

  isDiscovered(areaId: string, hiddenId: string): boolean {
    return this.data.discovered.includes(objectKey(areaId, hiddenId));
  }
}
