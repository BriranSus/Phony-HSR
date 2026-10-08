import type { z } from 'zod';

/**
 * Data-driven content registry.
 *
 * Content (characters, enemies, light cones, relic sets, status effects, rules...) lives in JSON files
 * under `src/data/<collection dir>/`. Each collection is declared once with a zod schema; the registry
 * loads every file from a `DataSource`, validates it, indexes items by id, checks duplicate ids and
 * resolves cross-collection references (e.g. an ability that applies status "break.burn" must point
 * at an existing status effect).
 */
export interface DataRef {
  /** Target collection, or several collections where any one may contain the id. */
  readonly collection: string | readonly string[];
  readonly id: string;
  /** Where the reference was found, for error messages (e.g. "abilities.skill.effects[0].status"). */
  readonly at: string;
}

export interface CollectionDef<TSchema extends z.ZodType<{ id: string }> = z.ZodType<{ id: string }>> {
  /** Unique collection key, e.g. "characters". */
  readonly name: string;
  /** Folder under the data root that holds this collection's JSON files. */
  readonly dir: string;
  /** "item": each file is one object. "list": each file is an array of objects. */
  readonly format: 'item' | 'list';
  readonly schema: TSchema;
  // Method syntax (bivariant parameters) lets differently-typed collections share one list.
  /** Cross-collection references to verify after everything is loaded. */
  references?(item: z.infer<TSchema>): DataRef[];
  /** Extra semantic checks the schema cannot express. Return human-readable problems. */
  validate?(item: z.infer<TSchema>): string[];
}

export type ItemOf<D> = D extends CollectionDef<infer S> ? z.infer<S> : never;

export function defineCollection<TSchema extends z.ZodType<{ id: string }>>(def: CollectionDef<TSchema>): CollectionDef<TSchema> {
  return def;
}

/** Abstract file source: Vite glob in the browser, in-memory maps in tests, fs in tooling. */
export interface DataSource {
  /** Paths relative to the data root, using "/" separators, e.g. "characters/seele.json". */
  list(): string[];
  read(path: string): Promise<unknown>;
}

export class InMemoryDataSource implements DataSource {
  constructor(private readonly files: Record<string, unknown>) {}
  list(): string[] {
    return Object.keys(this.files).sort();
  }
  async read(path: string): Promise<unknown> {
    if (!(path in this.files)) throw new Error(`No such data file: ${path}`);
    return structuredClone(this.files[path]);
  }
}

export type IssueKind = 'schema' | 'duplicate-id' | 'missing-reference' | 'semantic' | 'read-error' | 'unassigned-file';

export interface DataIssue {
  readonly kind: IssueKind;
  readonly collection: string;
  readonly file: string;
  readonly id?: string;
  readonly message: string;
}

export class DataValidationError extends Error {
  override readonly name = 'DataValidationError';
  constructor(readonly issues: readonly DataIssue[]) {
    super(
      `Data validation failed with ${issues.length} issue(s):\n` +
        issues
          .slice(0, 20)
          .map((i) => `  [${i.kind}] ${i.file}${i.id ? ` (${i.id})` : ''}: ${i.message}`)
          .join('\n'),
    );
  }
}

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly file: string;
  readonly collection: string;
}

export interface LoadReport {
  readonly files: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly issues: readonly DataIssue[];
}

export interface LoadOptions {
  /** Throw DataValidationError if any issue was found (default true). */
  strict?: boolean;
  onProgress?: (p: LoadProgress) => void;
}

interface StoredItem {
  readonly item: { id: string };
  readonly file: string;
}

export class DataRegistry {
  private readonly defs = new Map<string, CollectionDef>();
  private readonly items = new Map<string, Map<string, StoredItem>>();

  register(def: CollectionDef): this {
    if (this.defs.has(def.name)) throw new Error(`Collection "${def.name}" is already registered.`);
    if ([...this.defs.values()].some((d) => d.dir === def.dir)) {
      throw new Error(`Collection directory "${def.dir}" is already used by another collection.`);
    }
    this.defs.set(def.name, def);
    this.items.set(def.name, new Map());
    return this;
  }

  registerAll(defs: readonly CollectionDef[]): this {
    for (const d of defs) this.register(d);
    return this;
  }

  collections(): string[] {
    return [...this.defs.keys()];
  }

  /** Map a data file path to its collection by longest matching directory prefix. */
  collectionForPath(path: string): CollectionDef | undefined {
    let best: CollectionDef | undefined;
    for (const d of this.defs.values()) {
      if (path.startsWith(`${d.dir}/`) && (!best || d.dir.length > best.dir.length)) best = d;
    }
    return best;
  }

  async load(source: DataSource, options: LoadOptions = {}): Promise<LoadReport> {
    const strict = options.strict ?? true;
    const issues: DataIssue[] = [];
    const files = source.list().filter((p) => p.endsWith('.json'));
    const assigned: Array<{ file: string; def: CollectionDef }> = [];
    for (const file of files) {
      const def = this.collectionForPath(file);
      if (def) assigned.push({ file, def });
      else if (!file.startsWith('config/')) {
        issues.push({ kind: 'unassigned-file', collection: '-', file, message: 'File does not belong to any registered collection.' });
      }
    }

    // Load in collection registration order (so e.g. loading tips can be shown first), then by path.
    const rank = new Map([...this.defs.keys()].map((k, i) => [k, i]));
    assigned.sort((a, b) => (rank.get(a.def.name) ?? 0) - (rank.get(b.def.name) ?? 0) || a.file.localeCompare(b.file));

    let loaded = 0;
    for (const { file, def } of assigned) {
      try {
        this.ingest(def, file, await source.read(file), issues);
      } catch (e) {
        issues.push({ kind: 'read-error', collection: def.name, file, message: String(e) });
      }
      loaded++;
      options.onProgress?.({ loaded, total: assigned.length, file, collection: def.name });
    }

    issues.push(...this.checkReferences());
    const report: LoadReport = { files: assigned.length, counts: this.counts(), issues };
    if (strict && issues.length > 0) throw new DataValidationError(issues);
    return report;
  }

  get<D extends CollectionDef>(def: D, id: string): ItemOf<D> {
    const v = this.find(def, id);
    if (v === undefined) throw new Error(`No "${def.name}" item with id "${id}".`);
    return v;
  }

  find<D extends CollectionDef>(def: D, id: string): ItemOf<D> | undefined {
    return this.bucket(def.name).get(id)?.item as ItemOf<D> | undefined;
  }

  has(collection: string, id: string): boolean {
    return this.items.get(collection)?.has(id) ?? false;
  }

  all<D extends CollectionDef>(def: D): ItemOf<D>[] {
    return [...this.bucket(def.name).values()].map((s) => s.item as ItemOf<D>);
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, m] of this.items) out[k] = m.size;
    return out;
  }

  clear(): void {
    for (const m of this.items.values()) m.clear();
  }

  private bucket(name: string): Map<string, StoredItem> {
    const b = this.items.get(name);
    if (!b) throw new Error(`Collection "${name}" is not registered.`);
    return b;
  }

  private ingest(def: CollectionDef, file: string, raw: unknown, issues: DataIssue[]): void {
    const entries = def.format === 'list' ? raw : [raw];
    if (!Array.isArray(entries)) {
      issues.push({ kind: 'schema', collection: def.name, file, message: 'Expected a JSON array for a "list" collection.' });
      return;
    }
    const bucket = this.bucket(def.name);
    entries.forEach((entry, index) => {
      const parsed = def.schema.safeParse(entry);
      const label = def.format === 'list' ? `[${index}]` : '';
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({
            kind: 'schema',
            collection: def.name,
            file,
            id: (entry as { id?: string } | null)?.id,
            message: `${label}${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`,
          });
        }
        return;
      }
      const item = parsed.data;
      const existing = bucket.get(item.id);
      if (existing) {
        issues.push({ kind: 'duplicate-id', collection: def.name, file, id: item.id, message: `Duplicate id, already defined in ${existing.file}.` });
        return;
      }
      for (const problem of def.validate?.(item) ?? []) {
        issues.push({ kind: 'semantic', collection: def.name, file, id: item.id, message: problem });
      }
      bucket.set(item.id, { item, file });
    });
  }

  private checkReferences(): DataIssue[] {
    const issues: DataIssue[] = [];
    for (const def of this.defs.values()) {
      if (!def.references) continue;
      for (const { item, file } of this.bucket(def.name).values()) {
        for (const ref of def.references(item)) {
          const targets = typeof ref.collection === 'string' ? [ref.collection] : [...ref.collection];
          const unknown = targets.filter((t) => !this.defs.has(t));
          if (unknown.length > 0) {
            issues.push({ kind: 'missing-reference', collection: def.name, file, id: item.id, message: `${ref.at}: unknown collection "${unknown.join('|')}".` });
          } else if (!targets.some((t) => this.has(t, ref.id))) {
            issues.push({
              kind: 'missing-reference',
              collection: def.name,
              file,
              id: item.id,
              message: `${ref.at}: references missing ${targets.join('|')} "${ref.id}".`,
            });
          }
        }
      }
    }
    return issues;
  }
}
