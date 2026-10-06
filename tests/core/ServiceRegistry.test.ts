import { describe, expect, it, vi } from 'vitest';
import { ServiceError, ServiceRegistry, createToken } from '@core/di/ServiceRegistry';

const A = createToken<{ name: string }>('A');
const B = createToken<{ a: { name: string } }>('B');
const C = createToken<number>('C');

describe('ServiceRegistry', () => {
  it('resolves registered values and lazy singleton factories', () => {
    const s = new ServiceRegistry();
    const factory = vi.fn((r: ServiceRegistry) => ({ a: r.resolve(A) }));
    s.registerValue(A, { name: 'alpha' }).registerFactory(B, factory);
    expect(factory).not.toHaveBeenCalled();
    const b1 = s.resolve(B);
    const b2 = s.resolve(B);
    expect(b1.a.name).toBe('alpha');
    expect(b1).toBe(b2);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('creates a new instance per resolve for transient services', () => {
    const s = new ServiceRegistry();
    let n = 0;
    s.registerFactory(C, () => ++n, 'transient');
    expect(s.resolve(C)).toBe(1);
    expect(s.resolve(C)).toBe(2);
  });

  it('throws for unknown and duplicate registrations', () => {
    const s = new ServiceRegistry();
    expect(() => s.resolve(A)).toThrow(ServiceError);
    s.registerValue(A, { name: 'x' });
    expect(() => s.registerValue(A, { name: 'y' })).toThrow(/already registered/);
    expect(s.tryResolve(C)).toBeUndefined();
  });

  it('detects circular dependencies and reports the chain', () => {
    const s = new ServiceRegistry();
    const X = createToken<unknown>('X');
    const Y = createToken<unknown>('Y');
    s.registerFactory(X, (r) => r.resolve(Y));
    s.registerFactory(Y, (r) => r.resolve(X));
    expect(() => s.resolve(X)).toThrow('Circular service dependency: X -> Y -> X');
  });

  it('child scopes fall back to the parent and can add services', () => {
    const root = new ServiceRegistry().registerValue(A, { name: 'root' });
    const scope = root.createScope().registerValue(C, 7);
    expect(scope.resolve(A).name).toBe('root');
    expect(scope.resolve(C)).toBe(7);
    expect(root.has(C)).toBe(false);
  });
});
