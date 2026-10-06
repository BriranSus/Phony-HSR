import type { DataSource } from '@core/data/DataRegistry';

/**
 * All JSON content under `src/data/` is bundled by Vite as lazily loaded chunks, so the loading
 * screen reports real per-file progress. Phase 24 can swap this for a streamed/remote source
 * without touching the registry.
 */
const loaders = import.meta.glob<unknown>(['../data/**/*.json', '!../data/config/**'], { import: 'default' });

export function createBundledDataSource(): DataSource {
  const files = new Map<string, () => Promise<unknown>>();
  for (const [key, loader] of Object.entries(loaders)) files.set(key.replace(/^\.\.\/data\//, ''), loader);
  return {
    list: () => [...files.keys()].sort(),
    read: async (path) => {
      const load = files.get(path);
      if (!load) throw new Error(`No bundled data file "${path}"`);
      return load();
    },
  };
}
