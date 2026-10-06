import type { ServiceRegistry } from '../di/ServiceRegistry';
import type { Logger } from '../log/Logger';

/**
 * Every gameplay system (combat, relics, gacha, ...) is a GameModule. The ModuleManager initialises
 * modules in dependency order, so the dependency graph documented in docs/ROADMAP.md is also
 * enforced in code (missing dependencies and cycles fail at boot and in unit tests).
 */
export type ModuleStatus = 'stub' | 'partial' | 'active';

export interface ModuleContext {
  readonly services: ServiceRegistry;
  readonly logger: Logger;
}

export interface GameModule {
  /** Unique id, e.g. "combat". */
  readonly id: string;
  /** Human-readable name for debug tooling. */
  readonly name: string;
  /** Roadmap phase (docs/ROADMAP.md) that fully implements this module. */
  readonly phase: number;
  readonly status: ModuleStatus;
  /** Ids of modules that must be initialised first. */
  readonly dependsOn: readonly string[];
  init(ctx: ModuleContext): void | Promise<void>;
  /** Optional per-frame tick for modules with continuous behaviour. */
  update?(dt: number): void;
  dispose?(): void;
}

export interface ModuleDescriptor {
  readonly id: string;
  readonly name: string;
  readonly phase: number;
  readonly dependsOn: readonly string[];
}

/** Helper for Phase-1 stubs: declares the contract and dependencies without behaviour. */
export function defineStubModule(descriptor: ModuleDescriptor): GameModule {
  return {
    ...descriptor,
    status: 'stub',
    init(ctx: ModuleContext): void {
      ctx.logger.debug(`stub module "${descriptor.id}" registered (implemented in phase ${descriptor.phase})`);
    },
  };
}
