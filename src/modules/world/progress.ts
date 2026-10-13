import type { Level } from '@models/locomotion';
import { objectKey, type WorldState } from './state';

/**
 * Exploration progress: per area, how many chests, collectibles, puzzles and anchors have been
 * found, and the percentage that gives (every counted thing weighs the same). Regions and the
 * world aggregate by summing their areas' counts, so a big area counts for more than a small one.
 */
export interface Tally {
  found: number;
  total: number;
}

export interface AreaProgress {
  readonly chests: Tally;
  readonly collectibles: Tally;
  readonly puzzles: Tally;
  readonly anchors: Tally;
  readonly found: number;
  readonly total: number;
  /** Whole percent, floored so 100 means everything is found. An area with nothing to find is 100. */
  readonly percent: number;
}

const percentOf = (found: number, total: number): number => (total === 0 ? 100 : Math.floor((found * 100) / total));

export function summarise(chests: Tally, collectibles: Tally, puzzles: Tally, anchors: Tally): AreaProgress {
  const found = chests.found + collectibles.found + puzzles.found + anchors.found;
  const total = chests.total + collectibles.total + puzzles.total + anchors.total;
  return { chests, collectibles, puzzles, anchors, found, total, percent: percentOf(found, total) };
}

export function areaProgress(areaId: string, level: Level, state: WorldState): AreaProgress {
  const tally = (): Tally => ({ found: 0, total: 0 });
  const chests = tally();
  const collectibles = tally();
  const puzzles = tally();
  const anchors = tally();
  for (const o of level.interactables) {
    if (o.progress === false) continue;
    const s = state.data.objects[objectKey(areaId, o.id)]?.state;
    if (o.kind === 'chest') {
      chests.total++;
      if (s === 'opened') chests.found++;
    } else if (o.kind === 'collectible') {
      collectibles.total++;
      if (s === 'collected') collectibles.found++;
    } else if (o.kind === 'anchor') {
      anchors.total++;
      if (s === 'active') anchors.found++;
    }
  }
  for (const p of level.puzzles) {
    puzzles.total++;
    if (state.data.puzzles[objectKey(areaId, p.id)]?.solved) puzzles.found++;
  }
  return summarise(chests, collectibles, puzzles, anchors);
}

export function combineProgress(list: readonly AreaProgress[]): AreaProgress {
  const sum = (pick: (p: AreaProgress) => Tally): Tally => list.reduce((t, p) => ({ found: t.found + pick(p).found, total: t.total + pick(p).total }), { found: 0, total: 0 });
  return summarise(
    sum((p) => p.chests),
    sum((p) => p.collectibles),
    sum((p) => p.puzzles),
    sum((p) => p.anchors),
  );
}
