import type { GameModule, ModuleContext } from './GameModule';

export class ModuleGraphError extends Error {
  override readonly name = 'ModuleGraphError';
}

/** Kahn-style topological sort that reports missing dependencies and cycles. Stable w.r.t. input order. */
export function topologicalOrder(modules: readonly { id: string; dependsOn: readonly string[] }[]): string[] {
  const ids = new Set(modules.map((m) => m.id));
  if (ids.size !== modules.length) {
    const seen = new Set<string>();
    const dupes = modules.filter((m) => (seen.has(m.id) ? true : (seen.add(m.id), false))).map((m) => m.id);
    throw new ModuleGraphError(`Duplicate module ids: ${dupes.join(', ')}`);
  }
  for (const m of modules) {
    for (const d of m.dependsOn) {
      if (!ids.has(d)) throw new ModuleGraphError(`Module "${m.id}" depends on unknown module "${d}".`);
      if (d === m.id) throw new ModuleGraphError(`Module "${m.id}" depends on itself.`);
    }
  }
  const order: string[] = [];
  const done = new Set<string>();
  const remaining = [...modules];
  while (remaining.length > 0) {
    const idx = remaining.findIndex((m) => m.dependsOn.every((d) => done.has(d)));
    if (idx < 0) {
      throw new ModuleGraphError(`Dependency cycle among modules: ${remaining.map((m) => m.id).join(', ')}`);
    }
    const [m] = remaining.splice(idx, 1);
    if (m) {
      order.push(m.id);
      done.add(m.id);
    }
  }
  return order;
}

export class ModuleManager {
  private readonly modules = new Map<string, GameModule>();
  private initOrder: string[] = [];
  private initialised = false;

  register(module: GameModule): this {
    if (this.initialised) throw new ModuleGraphError(`Cannot register "${module.id}" after initialisation.`);
    if (this.modules.has(module.id)) throw new ModuleGraphError(`Module "${module.id}" is already registered.`);
    this.modules.set(module.id, module);
    return this;
  }

  registerAll(modules: readonly GameModule[]): this {
    for (const m of modules) this.register(m);
    return this;
  }

  get(id: string): GameModule | undefined {
    return this.modules.get(id);
  }

  list(): GameModule[] {
    return [...this.modules.values()];
  }

  get order(): readonly string[] {
    return this.initOrder;
  }

  async initAll(ctx: ModuleContext, onInit?: (m: GameModule) => void): Promise<void> {
    this.initOrder = topologicalOrder(this.list());
    for (const id of this.initOrder) {
      const m = this.modules.get(id) as GameModule;
      await m.init({ ...ctx, logger: ctx.logger.child(m.id) });
      onInit?.(m);
    }
    this.initialised = true;
  }

  update(dt: number): void {
    for (const id of this.initOrder) this.modules.get(id)?.update?.(dt);
  }

  disposeAll(): void {
    for (const id of [...this.initOrder].reverse()) this.modules.get(id)?.dispose?.();
    this.initialised = false;
  }
}
