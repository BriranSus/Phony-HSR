import type { Level } from '@models/locomotion';
import type { Region, World } from '@models/world';

/**
 * World graph: WorldDefinition -> Region -> Area, plus the cross-area checks a single file cannot
 * express (portal targets, arrival spawns). `validateWorldGraph` runs at load time, so a broken
 * reference fails when the data is loaded, never mid-game.
 */
export class WorldGraphError extends Error {
  override readonly name = 'WorldGraphError';
  constructor(readonly problems: readonly string[]) {
    super(`World graph is invalid:\n  - ${problems.join('\n  - ')}`);
  }
}

export function validateWorldGraph(world: World, levels: ReadonlyMap<string, Level>): string[] {
  const problems: string[] = [];
  const inWorld = new Set(world.regions.flatMap((r) => r.areas));
  for (const r of world.regions) for (const a of r.areas) if (!levels.has(a)) problems.push(`region "${r.id}" lists unknown area "${a}"`);
  const start = levels.get(world.startArea);
  if (start && world.startSpawn !== 'default' && !(world.startSpawn in start.spawns)) problems.push(`startSpawn "${world.startSpawn}" does not exist in "${world.startArea}"`);
  for (const a of inWorld) {
    const level = levels.get(a);
    if (!level) continue;
    for (const o of level.interactables) {
      if (o.kind !== 'portal') continue;
      const target = levels.get(o.toArea);
      if (!inWorld.has(o.toArea)) problems.push(`${a}/${o.id}: portal leads to "${o.toArea}", which is not part of world "${world.id}"`);
      else if (target && o.toSpawn !== 'default' && !(o.toSpawn in target.spawns)) problems.push(`${a}/${o.id}: portal arrival spawn "${o.toSpawn}" does not exist in "${o.toArea}"`);
    }
  }
  return problems;
}

export class WorldGraph {
  private readonly regionOfArea = new Map<string, Region>();

  constructor(
    readonly world: World,
    readonly levels: ReadonlyMap<string, Level>,
  ) {
    const problems = validateWorldGraph(world, levels);
    if (problems.length) throw new WorldGraphError(problems);
    for (const r of world.regions) for (const a of r.areas) this.regionOfArea.set(a, r);
  }

  areaIds(): string[] {
    return this.world.regions.flatMap((r) => r.areas);
  }

  level(areaId: string): Level {
    const l = this.levels.get(areaId);
    if (!l) throw new WorldGraphError([`unknown area "${areaId}"`]);
    return l;
  }

  regionOf(areaId: string): Region {
    const r = this.regionOfArea.get(areaId);
    if (!r) throw new WorldGraphError([`area "${areaId}" is not part of world "${this.world.id}"`]);
    return r;
  }
}
