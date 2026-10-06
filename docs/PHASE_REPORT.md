# Phase 1 Report: Project Architecture

**Project:** Astral Rail, an original fan project inspired by the gameplay structure of *Honkai: Star Rail*
**Scope:** spec §39 "FIRST ACTION" (analysis, engine, stack, architecture, folders, data models, dependencies, roadmap) and **Phase 1** of §37
**Status:** complete, awaiting validation. No Phase 2+ gameplay was implemented (interfaces and stubs only).

---

## 1. What was done

### 1.1 Planning documents
| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Spec analysis, engine selection (Three.js + TypeScript + Vite) with alternatives, tech stack, layered architecture, core services, module design, folder structure, data pipeline, §38 compliance, performance and testing strategy |
| [DATA_MODELS.md](DATA_MODELS.md) | Every core data model with TypeScript shapes and JSON examples. Covers mechanics: AV = 10000/SPD, party SP (start 3 / max 5), energy (20/30/5, ERR), damage zones (base, CRIT, DMG%, weaken, DEF, RES, vulnerability, mitigation, broken 0.9/1.0), toughness and the 7 break effects, Paths with aggro, Traces, Eidolons E1–E6, Light Cones with Path rule and S1–S5, 4 Cavern + 2 Planar relic slots with main/sub stats and set bonuses, gacha pity |
| [ROADMAP.md](ROADMAP.md) | All 26 phases with goals, dependencies and exit criteria, plus the enforced module dependency graph |

### 1.2 Runnable foundation
- **Tooling:** Vite 8, TypeScript 5.9 (`strict` + `noUncheckedIndexedAccess`), ESLint 10 + typescript-eslint, Vitest 4, and a Playwright 1.63 end-to-end/screenshot script.
- **Engine core (`src/core`):** fixed-timestep `GameLoop`; stack-based `StateManager` with queued operations, overlays and transition hooks; typed `EventBus` (extensible through declaration merging); `ServiceRegistry` DI with cycle detection; `DataRegistry` (Zod validation, duplicate-id, semantic and cross-reference checks, progress); `ConfigService` (data defaults + URL overrides); `Logger`; action-mapped `InputManager` (keyboard, mouse, wheel, gamepad); `RenderService` (one WebGL renderer, per-state views with bloom); `ModuleManager` (topological init).
- **Data models (`src/models`):** 15 schema files, a collection catalog, and pure formulas for AV and turn order, damage zones, toughness and break (incl. Bleed cap, Wind Shear stacks, Entanglement, Super Break), SP, energy, effect-hit chance and stat growth. All constants are read from data.
- **Sample content (`src/data`, 28 files / 101 records / 19 collections, all original):**
  - 4 characters with full kits, traces and E1–E6: *Ignatius* (Fire, Destruction, 5★), *Lyra* (Lightning, Remembrance, 5★, with memosprite *Aria*), *Brann* (Physical, Preservation, 4★), *Seraphine* (Wind, Harmony, 4★)
  - 3 enemies (normal, elite, and a 2-phase boss with summons and a charge-up)
  - 3 Light Cones (5★/4★/3★), 2 Cavern + 2 Planar relic sets, 5★ relic stat tables
  - the 7 break statuses plus kit statuses, items, cost tables, a banner, a quest + branching dialogue, input bindings, loading tips and combat/progression/scaling rules
- **Modules (`src/modules`):** 28 `GameModule`s covering every system in spec §36 (and more), each with a public interface, a DI token, a roadmap phase and declared dependencies. Two are partial: **ui** (layers, transitions, theme, SVG icon set, screens) and **vfx** (procedural starfield, nebula, ringed planet).
- **Boot flow (in the browser):**
  1. **Loading:** emblem with rotating rings, a gameplay tip loaded from data, and a gold progress rail tracking real per-file validation and module initialisation.
  2. **Title:** a procedural express rides a rail of light through a nebula past a ringed gas giant (tracking shot, bloom), with the "ASTRAL RAIL" wordmark, a pulsing "CLICK TO START" and side shortcuts.
  3. **Main menu:** a "Departure Board" overlay sliding in over the live backdrop. Future systems appear with phase badges.
  4. **Data Archive:** a registry browser with character cards (rarity, element/Path icons, Lv80 stats computed by the shared formulas, base AV, kit), Light Cones (S1/S5 values), enemies (weakness icons, toughness), and a combat-rules / break-effects table.
  5. **Test Scene:** a calibration platform with one crystal per element (colours from data), a placeholder mannequin and a light-rail arch. A debug orbit camera responds to WASD/Q/E/drag/wheel, a live input monitor shows held actions, and the F3 debug overlay shows FPS, draw calls, state stack, registry and modules.
  6. Diagonal shutter transitions (navy panels, gold seam, emblem) between Loading → Title and Menu ↔ Test Scene. Esc returns to the menu.

## 2. How to run and verify

```bash
npm install            # once
npm run dev            # dev server → http://localhost:5173
npm run build          # typecheck (tsc --noEmit) + production build to dist/
npm run preview        # serve dist/ → http://localhost:4173
npm test               # Vitest unit tests (core, formulas, schemas, all shipped data)
npm run lint           # ESLint
npm run screenshots    # build + preview + Playwright walk-through → docs/screenshots/*.png
npm run screenshots -- --dev          # same against the dev server
npm run screenshots -- --swiftshader  # force software WebGL
```

**Controls:** click or Enter to start. W/S + Enter or mouse in menus, Esc to go back, Q/E to switch archive tabs. In the Test Scene: WASD to pan, Shift for faster, drag to orbit, wheel or +/− to zoom, Q/E to rotate, F3 or ` for the debug overlay.

**QA URL overrides** (config system): `?cfg.debug.startState=test-scene`, `?cfg.graphics.quality=low`, `?cfg.graphics.bloom=false`, `?cfg.ui.minLoadingMs=0`, `?cfg.debug.logLevel=debug`.

## 3. Test and build results

| Check | Result |
|---|---|
| `npm run build` (tsc + vite) | ✅ 0 type errors. Bundle: app 109 KB (35.5 KB gzip), three 579 KB (144 KB gzip), zod 95 KB, plus 28 lazy data chunks |
| `npm test` | ✅ **100 / 100 tests passed** in 10 files |
| `npm run lint` | ✅ 0 problems |
| `npm run screenshots` (production build) | ✅ 9 screenshots, full flow, **0 console or page errors**, input actions verified (`moveForward, moveRight, sprint, cameraDrag`) |
| `npm run screenshots -- --dev` | ✅ same flow on the dev server |
| Runtime FPS (headless Chromium, Intel UHD via ANGLE D3D11, 1600×900) | 60 FPS in the test scene |

**Unit test coverage by file:**

| File | Tests | Focus |
|---|---|---|
| `tests/core/EventBus.test.ts` | 9 | typing, once/off, priority, error isolation, unsubscribe during dispatch, onAny, waitFor |
| `tests/core/StateManager.test.ts` | 7 | push/pop/replace/reset lifecycles, serialised ops, overlays, transitions, errors |
| `tests/core/ServiceRegistry.test.ts` | 5 | singletons, transients, duplicates, cycles, scopes |
| `tests/core/GameLoop.test.ts` | 6 | fixed steps, clamping, interpolation alpha, step cap, pause/time scale, start/stop |
| `tests/core/DataRegistry.test.ts` | 8 | item/list loading, schema errors, duplicate ids, dangling refs, strict mode, path mapping |
| `tests/core/ModuleManager.test.ts` | 6 | topological order, cycle/unknown detection, **real module graph acyclic + spec §36 coverage**, headless boot |
| `tests/core/ConfigLoggerInput.test.ts` | 11 | config overrides and validation, logger levels and sinks, input edges, axes, mouse, blur, wheel, rebinding, gamepad |
| `tests/models/formulas.test.ts` | 27 | AV, advance/delay, SPD change, cycles, turn order, DEF/RES/mitigation/broken zones, toughness, break multipliers and delays, Bleed cap, DoTs, Super Break, SP pool, energy, debuff chance, stat growth (87.12 → 640 at Lv80) |
| `tests/models/schemas.test.ts` | 13 | rejection of invalid elements, paths, rarities, eidolon counts, typos, effects, relic sets, LC superimposition, statuses, curves, banners, dialogue |
| `tests/data/content.test.ts` | 8 | every shipped file validates, all elements and paths present, break mapping, SP/energy rules, kits, curves, 5★ relic max main stats, LC S1–S5 |

## 4. Screenshots (`docs/screenshots/`)

| File | Screen |
|---|---|
| `01-loading.png` | Loading screen mid-progress with tip |
| `02-title.png` | Title screen with procedural express backdrop |
| `03-main-menu.png` | Departure Board main menu over the live backdrop |
| `04-archive-characters.png` | Data Archive: character cards |
| `05-archive-enemies.png` | Data Archive: enemies with weaknesses and toughness |
| `06-archive-rules.png` | Data Archive: combat rules and weakness-break table |
| `07-transition.png` | Shutter transition (navy panels, gold seam, emblem) |
| `08-test-scene.png` | Test Scene with HUD, input monitor and debug overlay |
| `09-test-scene-input.png` | Test Scene while W+D+Shift are held and the camera is dragged / zoomed |

## 5. Known limitations (intentional for Phase 1, or data to be completed later)

- **No gameplay yet.** Player controller, combat, progression and the other systems are interfaces and stubs, as the spec requires before Phase 1 is validated. The Test Scene's orbit camera is a sandbox tool, not the Phase-3 camera system.
- **Break level multiplier** has only two authored anchors (Lv1 = 54, Lv80 = 3767.5533), and values in between are interpolated. Phase 8 completes the table.
- **Approximations marked in data:** the `support`/`heal` ability curves, Light Cone growth constants, linear enemy level scaling (replaced by curve tables in Phase 7), and relic main-stat drop weights. Relic stat tables cover 5★ only (other rarities in Phase 11).
- **Data references not executed yet:** script handler ids (e.g. `ignatius.e6`) and condition types (`hpBelow`, `targetHasStatus`, …) are validated structurally only. Their registries arrive with the skills module in Phase 5, which will also validate them by id.
- **UI:** only the Phase-1 screens exist. Side shortcuts and disabled menu entries show their target phase. There's no localisation yet (plain strings), no audio (Phase 22), and characters show generic silhouettes (no character art by design).
- **Headless rendering:** the screenshot script prefers the hardware GPU through ANGLE and falls back to SwiftShader, where frames are slow but captures still work.

## 6. What Phase 2 will add (Player controller)

- A third-person procedural placeholder character with walk / run / sprint, acceleration and turn smoothing, ground snapping, slope limits and capsule collision against a greybox collision world.
- The `PlayerController` service behind `PlayerToken`, driven only by input **actions**, with locomotion tuning in `src/data/rules/locomotion.json`.
- An interaction-prompt query (`interact`), overworld attack and Technique hooks (encounter advantage flags emitted on the bus for Phase 5), and party-leader switching.
- Unit tests for movement integration, collision resolution and the state machine. An E2E walk test with screenshots of a greybox test area. Phase-1 systems must keep passing.
