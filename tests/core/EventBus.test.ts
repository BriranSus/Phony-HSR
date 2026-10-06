import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/bus/EventBus';

interface TestEvents {
  ping: { n: number };
  done: void;
  other: string;
}

describe('EventBus', () => {
  it('delivers typed payloads to subscribers', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on('ping', fn);
    bus.emit('ping', { n: 1 });
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('supports void events without a payload', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on('done', fn);
    bus.emit('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes via the returned handle and via off()', () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = bus.on('ping', a);
    bus.on('ping', b);
    unsubA();
    bus.off('ping', b);
    bus.emit('ping', { n: 2 });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('runs once() listeners a single time', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.once('ping', fn);
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('orders listeners by priority, then subscription order', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    bus.on('ping', () => order.push('low'), -5);
    bus.on('ping', () => order.push('first-default'));
    bus.on('ping', () => order.push('high'), 10);
    bus.on('ping', () => order.push('second-default'));
    bus.emit('ping', { n: 0 });
    expect(order).toEqual(['high', 'first-default', 'second-default', 'low']);
  });

  it('isolates listener errors when an error handler is provided', () => {
    const onError = vi.fn();
    const bus = new EventBus<TestEvents>({ onListenerError: onError });
    const after = vi.fn();
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', after);
    expect(() => bus.emit('ping', { n: 1 })).not.toThrow();
    expect(after).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('ping', expect.any(Error));
  });

  it('rethrows listener errors after all listeners ran when no handler is set', () => {
    const bus = new EventBus<TestEvents>();
    const after = vi.fn();
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', after);
    expect(() => bus.emit('ping', { n: 1 })).toThrow('boom');
    expect(after).toHaveBeenCalled();
  });

  it('lets listeners unsubscribe during dispatch without skipping others', () => {
    const bus = new EventBus<TestEvents>();
    const calls: string[] = [];
    const unsub = bus.on('ping', () => {
      calls.push('a');
      unsub();
    });
    bus.on('ping', () => calls.push('b'));
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('notifies onAny observers and resolves waitFor()', async () => {
    const bus = new EventBus<TestEvents>();
    const seen: Array<[string, unknown]> = [];
    bus.onAny((e, p) => seen.push([String(e), p]));
    const pending = bus.waitFor('other');
    bus.emit('other', 'hello');
    await expect(pending).resolves.toBe('hello');
    expect(seen).toEqual([['other', 'hello']]);
  });
});
