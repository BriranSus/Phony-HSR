import { z } from 'zod';

/**
 * Engine/application configuration. Defaults live in `src/data/config/game.config.json` (data, not code);
 * the user's persisted settings (Phase 21) and URL query overrides are layered on top.
 */
export const GameConfigSchema = z.object({
  app: z.object({
    title: z.string().min(1),
    subtitle: z.string(),
    version: z.string(),
    buildLabel: z.string(),
  }),
  debug: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']),
    overlay: z.boolean(),
    /** Throw on any data validation issue instead of only logging it. */
    strictData: z.boolean(),
    exposeGlobal: z.boolean(),
    /** State entered after loading (QA shortcut, e.g. ?cfg.debug.startState=test-scene). */
    startState: z.string().min(1),
  }),
  loop: z.object({
    fixedHz: z.number().int().min(10).max(240),
    maxStepsPerFrame: z.number().int().min(1).max(30),
    maxFrameTime: z.number().positive().max(1),
  }),
  graphics: z.object({
    quality: z.enum(['low', 'medium', 'high']),
    pixelRatioCap: z.number().min(0.5).max(3),
    antialias: z.boolean(),
    bloom: z.boolean(),
    bloomStrength: z.number().min(0).max(3),
    starCount: z.number().int().min(0).max(50000),
    toneMappingExposure: z.number().positive(),
  }),
  ui: z.object({
    language: z.string(),
    /** Minimum time the loading screen stays visible so progress is readable (ms). */
    minLoadingMs: z.number().int().min(0),
    transitionMs: z.number().int().min(0),
    uiScale: z.number().min(0.5).max(2),
  }),
  audio: z.object({
    master: z.number().min(0).max(1),
    music: z.number().min(0).max(1),
    sfx: z.number().min(0).max(1),
    voice: z.number().min(0).max(1),
  }),
  /** Combat presentation (Phase 5). */
  combat: z.object({
    /** Multiplier on the battle animation speed (1 = normal; tests use more). */
    animationSpeed: z.number().min(0.25).max(20),
  }),
  /** Exploration (Phase 4): which world definition the exploration scene loads. */
  world: z.object({ startWorld: z.string().min(1) }),
  /**
   * Player camera settings (shared with the future settings screen). Tuning that is not a player
   * preference (distances, damping, collision) is data: `camera/rules`.
   */
  camera: z.object({
    fov: z.number().min(30).max(110),
    /** Mouse / stick look sensitivity multiplier (1 = default). */
    orbitSensitivity: z.number().positive(),
    /** Wheel zoom sensitivity multiplier. */
    zoomSensitivity: z.number().positive(),
    invertY: z.boolean(),
    /** Auto-recenter behind the player while moving. */
    autoRecenter: z.boolean(),
    /** Camera shake strength (accessibility; 0 disables shake). */
    shakeIntensity: z.number().min(0).max(1),
    /** Lock the pointer: the mouse rotates the camera without holding the right button. */
    pointerLock: z.boolean(),
  }),
});

export type GameConfig = z.infer<typeof GameConfigSchema>;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/**
 * Convert flat `section.key=value` pairs (e.g. from `?cfg.graphics.quality=low`) into a partial config,
 * coercing each value to the type of the existing default. Unknown keys are reported, not applied.
 */
export function parseOverrides(
  base: GameConfig,
  entries: Iterable<[string, string]>,
): { patch: DeepPartial<GameConfig>; unknown: string[] } {
  const patch: Record<string, Record<string, unknown>> = {};
  const unknown: string[] = [];
  for (const [rawKey, raw] of entries) {
    const key = rawKey.startsWith('cfg.') ? rawKey.slice(4) : rawKey;
    const [section, field, ...rest] = key.split('.');
    const sectionObj = section ? (base as unknown as Record<string, Record<string, unknown>>)[section] : undefined;
    if (!section || !field || rest.length > 0 || !sectionObj || !(field in sectionObj)) {
      unknown.push(rawKey);
      continue;
    }
    const current = sectionObj[field];
    let value: unknown = raw;
    if (typeof current === 'number') value = Number(raw);
    else if (typeof current === 'boolean') value = raw === '' || raw === '1' || raw === 'true';
    (patch[section] ??= {})[field] = value;
  }
  return { patch: patch as DeepPartial<GameConfig>, unknown };
}

export type ConfigListener = (config: GameConfig, previous: GameConfig) => void;

export class ConfigService {
  private value: GameConfig;
  private readonly listeners = new Set<ConfigListener>();

  constructor(defaults: unknown, overrides?: DeepPartial<GameConfig>) {
    const base = GameConfigSchema.parse(defaults);
    this.value = GameConfigSchema.parse(deepMerge(base, overrides));
  }

  get(): Readonly<GameConfig> {
    return this.value;
  }

  section<K extends keyof GameConfig>(key: K): Readonly<GameConfig[K]> {
    return this.value[key];
  }

  /** Apply a validated patch. Invalid patches throw and leave the config unchanged. */
  update(patch: DeepPartial<GameConfig>): void {
    const next = GameConfigSchema.parse(deepMerge(this.value, patch));
    const prev = this.value;
    this.value = next;
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
