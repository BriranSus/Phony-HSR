/**
 * Stack-based game-state (scene) manager.
 *
 * States are registered by id with a factory, so screens are created on demand and disposed when
 * they leave the stack. Operations (`push`, `pop`, `replace`, `reset`) are queued and executed
 * strictly in order, so overlapping requests (double clicks during a transition) are safe.
 *
 * Lifecycle: create -> enter(params) -> [pause/resume when covered/uncovered] -> exit -> dispose.
 * Overlay states (`isOverlay`) let the states below keep updating and rendering (pause menus,
 * the title menu over the animated title backdrop).
 */
export interface GameState<TParams = unknown> {
  readonly id: string;
  /** If true, the state below this one keeps updating and rendering. */
  readonly isOverlay?: boolean;
  enter(params: TParams): void | Promise<void>;
  exit(): void | Promise<void>;
  /** Lost input focus because another state was pushed on top. */
  pause?(): void;
  /** Regained input focus. */
  resume?(): void;
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  render?(alpha: number): void;
  dispose?(): void;
}

export type StateFactory<TParams = unknown> = () => GameState<TParams>;

export type StateAction = 'push' | 'pop' | 'replace' | 'reset';

export interface StateChange {
  readonly action: StateAction;
  readonly from: string | null;
  readonly to: string | null;
  readonly stack: readonly string[];
}

/** Optional visual transition (cover the screen, swap, reveal). Implemented by the UI module. */
export interface StateTransitioner {
  cover(): Promise<void>;
  reveal(): Promise<void>;
}

export interface TransitionOptions {
  /** Play the cover/reveal transition around the change. Default false. */
  transition?: boolean;
}

export interface StateManagerHooks {
  onChange?(change: StateChange): void;
  onError?(error: unknown, action: StateAction): void;
}

export class StateError extends Error {
  override readonly name = 'StateError';
}

export class StateManager {
  private readonly factories = new Map<string, StateFactory<never>>();
  private readonly stack: GameState<unknown>[] = [];
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private transitioner: StateTransitioner | null = null;

  constructor(private readonly hooks: StateManagerHooks = {}) {}

  register<TParams>(id: string, factory: StateFactory<TParams>): this {
    if (this.factories.has(id)) throw new StateError(`State "${id}" is already registered.`);
    this.factories.set(id, factory as StateFactory<never>);
    return this;
  }

  isRegistered(id: string): boolean {
    return this.factories.has(id);
  }

  setTransitioner(t: StateTransitioner | null): void {
    this.transitioner = t;
  }

  get current(): GameState<unknown> | undefined {
    return this.stack[this.stack.length - 1];
  }

  get stackIds(): string[] {
    return this.stack.map((s) => s.id);
  }

  /** True while queued operations are still running. */
  get busy(): boolean {
    return this.pending > 0;
  }

  push<TParams>(id: string, params?: TParams, options: TransitionOptions = {}): Promise<void> {
    return this.enqueue('push', options, async () => {
      const next = this.create(id);
      const prev = this.current;
      prev?.pause?.();
      this.stack.push(next);
      await next.enter(params);
      this.notify('push', prev?.id ?? null, id);
    });
  }

  pop(options: TransitionOptions = {}): Promise<void> {
    return this.enqueue('pop', options, async () => {
      const top = this.stack.pop();
      if (!top) throw new StateError('Cannot pop: the state stack is empty.');
      await this.teardown(top);
      const now = this.current;
      now?.resume?.();
      this.notify('pop', top.id, now?.id ?? null);
    });
  }

  replace<TParams>(id: string, params?: TParams, options: TransitionOptions = {}): Promise<void> {
    return this.enqueue('replace', options, async () => {
      const top = this.stack.pop();
      if (top) await this.teardown(top);
      const next = this.create(id);
      this.stack.push(next);
      await next.enter(params);
      this.notify('replace', top?.id ?? null, id);
    });
  }

  /** Clear the whole stack and start fresh from `id`. */
  reset<TParams>(id: string, params?: TParams, options: TransitionOptions = {}): Promise<void> {
    return this.enqueue('reset', options, async () => {
      const from = this.current?.id ?? null;
      while (this.stack.length > 0) {
        const s = this.stack.pop() as GameState<unknown>;
        await this.teardown(s);
      }
      const next = this.create(id);
      this.stack.push(next);
      await next.enter(params);
      this.notify('reset', from, id);
    });
  }

  /** Resolves when all queued operations have completed. */
  idle(): Promise<void> {
    return this.queue;
  }

  fixedUpdate(dt: number): void {
    for (const s of this.activeStates()) s.fixedUpdate?.(dt);
  }

  update(dt: number): void {
    for (const s of this.activeStates()) s.update?.(dt);
  }

  render(alpha: number): void {
    for (const s of this.activeStates()) s.render?.(alpha);
  }

  /**
   * States that are visible: the top-most non-overlay state and every overlay above it,
   * in bottom-to-top order.
   */
  activeStates(): GameState<unknown>[] {
    let start = this.stack.length - 1;
    while (start > 0 && (this.stack[start] as GameState<unknown>).isOverlay) start--;
    return start < 0 ? [] : this.stack.slice(start);
  }

  private create(id: string): GameState<unknown> {
    const factory = this.factories.get(id);
    if (!factory) throw new StateError(`State "${id}" is not registered.`);
    const state = factory() as GameState<unknown>;
    if (state.id !== id) throw new StateError(`Factory for "${id}" produced a state with id "${state.id}".`);
    return state;
  }

  private async teardown(state: GameState<unknown>): Promise<void> {
    await state.exit();
    state.dispose?.();
  }

  private enqueue(action: StateAction, options: TransitionOptions, op: () => Promise<void>): Promise<void> {
    this.pending++;
    const run = async (): Promise<void> => {
      const t = options.transition ? this.transitioner : null;
      try {
        if (t) await t.cover();
        await op();
      } catch (error) {
        this.hooks.onError?.(error, action);
        throw error;
      } finally {
        if (t) await t.reveal();
        this.pending--;
      }
    };
    const result = this.queue.then(run);
    // Keep the chain alive even if this operation fails.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private notify(action: StateAction, from: string | null, to: string | null): void {
    this.hooks.onChange?.({ action, from, to, stack: this.stackIds });
  }
}
