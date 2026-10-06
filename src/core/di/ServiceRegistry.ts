/**
 * Minimal dependency-injection container keyed by typed tokens.
 *
 *   const LoggerToken = createToken<Logger>('Logger');
 *   services.registerValue(LoggerToken, logger);
 *   services.registerFactory(DataToken, (s) => new DataRegistry(s.resolve(LoggerToken)));
 *   const data = services.resolve(DataToken);
 *
 * Factories are lazy singletons by default. Circular resolution is detected and reported with the chain.
 */
export interface ServiceToken<T> {
  readonly key: symbol;
  readonly name: string;
  /** Phantom field used only for type inference. */
  readonly __type?: T;
}

export function createToken<T>(name: string): ServiceToken<T> {
  return { key: Symbol(name), name };
}

export type Lifetime = 'singleton' | 'transient';
export type Factory<T> = (services: ServiceRegistry) => T;

interface Registration<T> {
  readonly token: ServiceToken<T>;
  readonly factory: Factory<T>;
  readonly lifetime: Lifetime;
  instance?: T;
  created: boolean;
}

export class ServiceError extends Error {
  override readonly name = 'ServiceError';
}

export class ServiceRegistry {
  private readonly registrations = new Map<symbol, Registration<unknown>>();
  private readonly resolving: string[] = [];

  constructor(private readonly parent?: ServiceRegistry) {}

  registerValue<T>(token: ServiceToken<T>, value: T): this {
    this.assertFree(token);
    this.registrations.set(token.key, { token, factory: () => value, lifetime: 'singleton', instance: value, created: true });
    return this;
  }

  registerFactory<T>(token: ServiceToken<T>, factory: Factory<T>, lifetime: Lifetime = 'singleton'): this {
    this.assertFree(token);
    this.registrations.set(token.key, { token, factory, lifetime, created: false });
    return this;
  }

  has(token: ServiceToken<unknown>): boolean {
    return this.registrations.has(token.key) || (this.parent?.has(token) ?? false);
  }

  resolve<T>(token: ServiceToken<T>): T {
    const reg = this.registrations.get(token.key) as Registration<T> | undefined;
    if (!reg) {
      if (this.parent) return this.parent.resolve(token);
      throw new ServiceError(`Service "${token.name}" is not registered.`);
    }
    if (reg.lifetime === 'singleton' && reg.created) return reg.instance as T;
    if (this.resolving.includes(token.name)) {
      throw new ServiceError(`Circular service dependency: ${[...this.resolving, token.name].join(' -> ')}`);
    }
    this.resolving.push(token.name);
    try {
      const instance = reg.factory(this);
      if (reg.lifetime === 'singleton') {
        reg.instance = instance;
        reg.created = true;
      }
      return instance;
    } finally {
      this.resolving.pop();
    }
  }

  tryResolve<T>(token: ServiceToken<T>): T | undefined {
    return this.has(token) ? this.resolve(token) : undefined;
  }

  /** Child scope (e.g. per battle) that can override or add services without touching the parent. */
  createScope(): ServiceRegistry {
    return new ServiceRegistry(this);
  }

  registeredNames(): string[] {
    return [...this.registrations.values()].map((r) => r.token.name);
  }

  private assertFree(token: ServiceToken<unknown>): void {
    if (this.registrations.has(token.key)) {
      throw new ServiceError(`Service "${token.name}" is already registered.`);
    }
  }
}
