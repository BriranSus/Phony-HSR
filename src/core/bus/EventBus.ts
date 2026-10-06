/**
 * Strongly typed publish/subscribe bus.
 *
 * `TEvents` maps event names to payload types, so `bus.emit('state:changed', payload)` is type-checked.
 * Listener errors are isolated (reported to `onListenerError`) so one faulty subscriber cannot break
 * the emitter or the other subscribers.
 */
export type EventMapBase = object;
export type Listener<P> = (payload: P) => void;
export type Unsubscribe = () => void;

interface Entry<P> {
  readonly fn: Listener<P>;
  readonly once: boolean;
  readonly priority: number;
}

export interface EventBusOptions {
  /** If omitted, listener errors are re-thrown after all listeners ran. */
  onListenerError?: (event: string, error: unknown) => void;
}

type EmitArgs<P> = [P] extends [void] ? [] : [payload: P];

export class EventBus<TEvents extends EventMapBase> {
  private readonly listeners = new Map<keyof TEvents, Entry<never>[]>();
  private readonly anyListeners: Array<(event: keyof TEvents, payload: unknown) => void> = [];

  constructor(private readonly options: EventBusOptions = {}) {}

  /** Subscribe. Higher `priority` listeners run first; equal priority runs in subscription order. */
  on<K extends keyof TEvents>(event: K, fn: Listener<TEvents[K]>, priority = 0): Unsubscribe {
    return this.add(event, { fn, once: false, priority });
  }

  once<K extends keyof TEvents>(event: K, fn: Listener<TEvents[K]>, priority = 0): Unsubscribe {
    return this.add(event, { fn, once: true, priority });
  }

  off<K extends keyof TEvents>(event: K, fn: Listener<TEvents[K]>): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const i = list.findIndex((e) => (e.fn as unknown) === fn);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.listeners.delete(event);
  }

  /** Observe every event (debug overlay, analytics, replay recording). */
  onAny(fn: (event: keyof TEvents, payload: unknown) => void): Unsubscribe {
    this.anyListeners.push(fn);
    return () => {
      const i = this.anyListeners.indexOf(fn);
      if (i >= 0) this.anyListeners.splice(i, 1);
    };
  }

  emit<K extends keyof TEvents>(event: K, ...args: EmitArgs<TEvents[K]>): void {
    const payload = args[0] as TEvents[K];
    const errors: unknown[] = [];
    const list = this.listeners.get(event);
    if (list) {
      // Snapshot so listeners may (un)subscribe during dispatch.
      for (const entry of [...list] as Entry<TEvents[K]>[]) {
        if (entry.once) this.off(event, entry.fn);
        this.safeCall(String(event), () => entry.fn(payload), errors);
      }
    }
    for (const fn of [...this.anyListeners]) this.safeCall(String(event), () => fn(event, payload), errors);
    if (errors.length > 0) throw errors[0];
  }

  /** Resolves on the next emission of `event`. */
  waitFor<K extends keyof TEvents>(event: K): Promise<TEvents[K]> {
    return new Promise((resolve) => {
      this.once(event, resolve);
    });
  }

  listenerCount(event?: keyof TEvents): number {
    if (event !== undefined) return this.listeners.get(event)?.length ?? 0;
    let n = 0;
    for (const l of this.listeners.values()) n += l.length;
    return n;
  }

  clear(): void {
    this.listeners.clear();
    this.anyListeners.length = 0;
  }

  private add<K extends keyof TEvents>(event: K, entry: Entry<TEvents[K]>): Unsubscribe {
    const list = (this.listeners.get(event) ?? []) as Entry<TEvents[K]>[];
    let i = list.length;
    while (i > 0 && (list[i - 1] as Entry<TEvents[K]>).priority < entry.priority) i--;
    list.splice(i, 0, entry);
    this.listeners.set(event, list as Entry<never>[]);
    return () => this.off(event, entry.fn);
  }

  private safeCall(event: string, fn: () => void, errors: unknown[]): void {
    try {
      fn();
    } catch (error) {
      if (this.options.onListenerError) this.options.onListenerError(event, error);
      else errors.push(error);
    }
  }
}
