# Phase 1 Report: Project Architecture

**Project:** Astral Rail, an original fan project inspired by the gameplay structure of *Honkai: Star Rail*
**Scope:** spec §39 "FIRST ACTION" (analysis, engine, stack, architecture, folders, data models, dependencies, roadmap) and **Phase 1** of §37
**Status:** complete, **Revision 1 applied** (validator feedback on the 7.5/10 review, see [§7](#7-revision-1-changelog)), awaiting validation. No Phase 2+ gameplay was implemented (interfaces, data models and stubs only).

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
- **Data models (`src/models`):** 16 schema files (incl. description templates), a collection catalog, and pure formulas for AV and turn order, damage zones, toughness and break (incl. Bleed cap, Wind Shear stacks, Entanglement, Super Break, the full Lv1–95 level-multiplier table), SP, energy, effect-hit chance, stat growth and unit lifecycle (memosprites leave the field at 0 HP). All constants are read from data.
- **Sample content (`src/data`, 30 files / 105 records / 19 collections, all original):**
  - 4 characters with full kits, traces and E1–E6: *Ignatius* (Fire, Destruction, 5★), *Lyra* (Lightning, Remembrance, 5★, with memosprite *Aria*: Memosprite Skill + Memosprite Talent), *Brann* (Physical, Preservation, 4★), *Seraphine* (Wind, Harmony, 4★)
  - 3 enemies (normal, elite, and a 2-phase boss with summons and a charge-up)
  - 3 Light Cones (5★/4★/3★), 2 Cavern + 2 Planar relic sets, 5★ relic stat tables
  - the 7 break statuses plus kit and equipment statuses, items, cost tables, a limited character banner and a limited Light Cone banner, a quest + branching dialogue, input bindings, loading tips and combat/progression/scaling rules
- **Modules (`src/modules`):** 28 `GameModule`s covering every system in spec §36 (and more), each with a public interface, a DI token, a roadmap phase and declared dependencies. Two are partial: **ui** (layers, transitions, theme, SVG icon set, screens) and **vfx** (procedural starfield, nebula, ringed planet).
- **Boot flow (in the browser):**
  1. **Loading:** emblem with rotating rings, a gameplay tip loaded from data, and a gold progress rail tracking real per-file validation and module initialisation.
  2. **Title:** a procedural express rides a rail of light through a nebula past a ringed gas giant (tracking shot, bloom), with the "ASTRAL RAIL" wordmark, a pulsing "CLICK TO START" and side shortcuts.
  3. **Main menu:** a "Departure Board" overlay sliding in over the live backdrop. Future systems appear with phase badges.
  4. **Data Archive:** a registry browser with character cards (rarity, element/Path icons, Lv80 stats computed by the shared formulas, base AV, kit), Light Cones (S1/S5 values), enemies (weakness icons, toughness), and a combat-rules / break-effects table.
  5. **Test Scene:** a calibration platform with one crystal per element (colours from data), a placeholder mannequin and a light-rail arch. A debug orbit camera responds to WASD/Q/E/drag/wheel, a live input monitor shows held actions, and the F3 debug overlay (off by default) shows FPS, draw calls, state stack, registry and modules.
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
| `npm run build` (tsc + vite) | ✅ 0 type errors. Bundle: app 115 KB (37.3 KB gzip), three 579 KB (144 KB gzip), zod 95 KB, plus lazy per-file data chunks |
| `npm test` | ✅ **117 / 117 tests passed** in 12 files |
| `npm run lint` | ✅ 0 problems |
| `npm run screenshots` (production build) | ✅ 25 screenshots: full flow at 1600×900 plus menu / archive / test scene at 1280×720, 1024×768 and 390×844. **0 console or page errors, 0 layout problems** (overlap, cut-off and horizontal-overflow checks), 0 unresolved placeholders, input actions verified (`moveForward, moveRight, sprint, cameraDrag`) |
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
| `tests/models/formulas.test.ts` | 31 | AV, advance/delay, SPD change, cycles, turn order, DEF/RES/mitigation/broken zones, toughness, **full level-multiplier table** (anchors Lv1/4/20/40/50/60/70/80/95, monotonic, no interpolation, gap rejection), break multipliers and delays, Bleed cap, DoTs, Freeze advance, SP pool, energy, debuff chance, stat growth (87.12 → 640; **Light Cones 26.4 → 582.12** and all three rarity tiers), memosprite leave-field lifecycle |
| `tests/models/templates.test.ts` | 4 | `{n}`/`{name}` placeholder resolution, load-time failures for abilities / Eidolons / Light Cones / relic sets, Light Cone param usage |
| `tests/models/kit-model.test.ts` | 5 | trigger hooks, closed condition types, memosprite Skill + Talent, memosprite Eidolon bonuses, Energy vs points Ultimates |
| `tests/models/schemas.test.ts` | 13 | rejection of invalid elements, paths, rarities, eidolon counts, typos, effects, relic sets, LC superimposition, statuses, curves, banners, dialogue |
| `tests/data/content.test.ts` | 12 | every shipped file validates, all elements and paths present, break mapping, SP/energy rules, kits, curves, 5★ relic max main stats, LC S1–S5, **every set / Light Cone bonus encoded as data**, Light Cone stat tiers, Remembrance kit, Light Cone banner |

## 4. Screenshots (`docs/screenshots/`)

| File | Screen |
|---|---|
| `01-loading.png` | Loading screen mid-progress with tip |
| `02-title.png` | Title screen with procedural express backdrop |
| `03-main-menu.png` | Departure Board main menu over the live backdrop |
| `04-archive-characters.png` | Data Archive: character cards (gold 5★ / purple 4★) |
| `04b-archive-light-cones.png` | Data Archive: Light Cones with resolved passives and Lv80 stats |
| `05-archive-enemies.png` | Data Archive: enemies with weaknesses and toughness |
| `06-archive-rules.png` | Data Archive: combat rules and weakness-break table |
| `07-transition.png` | Shutter transition (navy panels, gold seam, emblem) |
| `08-test-scene.png` | Test Scene with HUD and input monitor (debug overlay off by default) |
| `09-test-scene-input.png` | Test Scene with the F3 debug overlay while W+D+Shift are held and the camera is dragged / zoomed |
| `vp-<size>-main-menu.png` | Main menu at 1280x720, 1024x768 and 390x844 |
| `vp-<size>-archive.png`, `vp-<size>-archive-rules.png` | Archive characters and Combat Rules tabs at each size |
| `vp-<size>-test-scene-banner.png`, `vp-<size>-test-scene.png` | Test Scene with the area banner, then settled, at each size |

## 5. Known limitations (intentional for Phase 1, or data to be completed later)

- **No gameplay yet.** Player controller, combat, progression and the other systems are interfaces and stubs, as the spec requires before Phase 1 is validated. The Test Scene's orbit camera is a sandbox tool, not the Phase-3 camera system.
- **Approximations marked in data:** the `support`/`heal` ability curves, linear enemy level scaling (replaced by curve tables in Phase 7), relic main-stat drop weights, and Light Cone ascension credit costs. Relic stat tables cover 5★ only (other rarities in Phase 11).
- **Data references not executed yet:** script handler ids (e.g. `ignatius.e6`) are validated structurally only; their registry arrives with the skills module in Phase 5. Condition types and trigger events are closed enums (typos fail at load), but they are evaluated only once the Phase 5 engine exists.
- **UI:** only the Phase-1 screens exist. Side shortcuts and disabled menu entries show their target phase. There's no localisation yet (plain strings), no audio (Phase 22), and characters show generic silhouettes (no character art by design).
- **Headless rendering:** the screenshot script prefers the hardware GPU through ANGLE and falls back to SwiftShader, where frames are slow but captures still work.

## 6. Revision note on reference numbers

The break level-multiplier table (Lv1–95) was copied from the HSR community wiki page
[Toughness → Level Multiplier](https://honkai-star-rail.fandom.com/wiki/Toughness) (wikitext read through the MediaWiki API on
2026-10-06, since the HTML page is behind a bot check). All 95 rows were compared programmatically with `rules/combat/default.json`
(0 mismatches), and the source is cited in that file's `sources` array. The Light Cone growth constants were checked against the
22.05× Lv80 ratio (In the Night 48 / 26.4 / 21 → 1058.4 / 582.12 / 463.05), also cited in `rules/progression/default.json`.

## 7. Revision 1 changelog

Validator score before revision: **7.5/10** (Mechanics 8, Architecture 8.5, Visual 7.5, Functionality 8.5).

| # | Finding | What changed |
|---|---|---|
| 1 | Main menu didn't fit at 1280×720 / 1024×768; 390px overlaps and archive overflow | `screens.css`: the Departure Board uses a clamp/vh vertical rhythm (panel padding, title, caption gap, row padding and gaps) and its list scrolls if the viewport is very short. While the board is open, the title footer stacks in the free area left of the panel and the wordmark scales to 0.82 / 0.66 below 1440 / 1180 px. At ≤900 px the board is full width and replaces the wordmark and footer; at ≤700 px the title logo, start prompt and footer re-flow. Archive: the tab strip scrolls on its own, the page never scrolls sideways, the rules table sits in its own scroll box and drops the prose column on phones, and the cards use `minmax(min(250px, 100%), 1fr)`. `scripts/screenshots.mjs` now captures 1280×720, 1024×768 and 390×844 and **fails** on horizontal overflow, overlapping elements (menu rows vs. footers, wordmark vs. panel, footer halves, HUD panels, banner) and cut-off UI. |
| 2 | "?" placeholder in Light Cone passives | New `models/templates.ts`: one resolver for `{n}` (Light Cones: modifiers, then params) and `{name}` placeholders, used by the archive. Load-time validation for every ability (incl. memosprite and enemy abilities), Trace passive, Eidolon, Light Cone and relic set: an unresolved placeholder fails the data load. Harmonic Thread now reads `{skillTargetDmg}` and renders "12% (S5 24%)". The E2E run also fails if an archive passive contains `{`, `}` or `?`. |
| 3 | Light Cone growth reached 20.05× instead of 22.05× | Growth curves use cumulative per-phase `ascensionBonus` tables (Light Cones 0, 1.2, 2.8, 4.4, 6.0, 7.6, 9.2 with 0.15/level; characters 0…2.4 with 0.05/level), so every rarity reaches 22.05×. Unit tests assert 26.4 → 582.12 and all nine 5★/4★/3★ reference values. Sample cones rebased: Ember Oath 48 / 26.4 / 21, Harmonic Thread 43.2 / 19.2 / 18, Bulwark Memory 38.4 / 14.4 / 12. |
| 4 | Remembrance Eidolons couldn't boost memosprite abilities | `abilityLevelBonus` accepts `memospriteSkill` / `memospriteTalent` (`LeveledAbilitySlotSchema`); validation rejects them on characters without a memosprite. Lyra E3 = Ultimate +2, Basic ATK +1, Memosprite Skill +1; E5 = Skill +2, Talent +2, Memosprite Talent +1 (reference wording "up to a maximum of Lv. 10/15"). Memosprites must have exactly one Memosprite Skill and one Memosprite Talent; Aria gained *Lingering Cadence* (team CRIT DMG while on the field, Energy for Lyra on entering). Memosprite abilities cap at Lv6 naturally (`abilityMaxLevel`), with their own trace nodes. |
| 5 | Trigger vocabulary missing core hooks; description-only bonuses | Added `afterUseBasic`, `afterUseSkill`, `afterUseUltimate`, `onFollowUp`, `onEnterBattleField`, `onMemospriteSummoned`, `onMemospriteLeave`; split `afterAllyAttacked` into `afterAllyAttack` and `afterAllyHit` (Seraphine/Lyra talents use the former, Brann's counter the latter). Condition types are now a closed enum (incl. `abilityTargetsAlly`, `attackerIsOwnMemosprite`). Courier 4pc is an `afterUseUltimate` + `abilityTargetsAlly` trigger applying `buff.gale-courier` (+12% SPD) to all allies; Pilgrim 4pc uses `afterUseUltimate` and applies **Fire** DMG via `buff.ember-pilgrim`; Harmonic Thread's `skillTargetDmg` is consumed by an `afterUseSkill` trigger through a `{ "param": … }` reference. Ignatius E2/A6 use the new hooks. Validators require every Light Cone param to be used by a trigger, and a content test requires every set and Light Cone bonus to carry modifiers or triggers. |
| 6 | Combat runtime couldn't represent HSR turn mechanics | `models/combat.ts`: `Combatant.kind` (character / memosprite / enemy / summon), `ownerUid`, `presence` (active / downed / leftField) and `onZeroHp`; memosprites leave the field at 0 HP and a downed owner takes its memosprite with it (`formulas/units.ts`, tested). `BattleState.insertedActions` (follow-up / counter / extra turn / immediate memosprite action, ordered by `seq`) alongside a typed `ultimateQueue`. `PlayerAction` adds `enhancedBasic`, `enhancedSkill` and `memospriteSkill`. `UnitFactory.create(spec, uid)` takes a `UnitBuildSpec` (`CharacterBuildSpec` = `CharacterInstance` + Light Cone + relic instances; enemy id + level; owned memosprite/summon + owner), and `EncounterSpec.party` carries build specs. New `combat:unitEntered` / `combat:unitLeft` events. |
| 7 | Break level multiplier was a linear placeholder | Full Lv1–95 table in `rules/combat/default.json` with a cited source (see §6); `levelMultiplier()` is an exact lookup that throws outside the table; the schema requires a contiguous, strictly increasing table covering at least Lv1–80. Tests check the Lv1/4/20/40/50/60/70/80/95 anchors. Also from the reference page: break debuff base chance 150% (`statusBaseChance`), Freeze/Entanglement deal Additional DMG (`damageType`), and Freeze advances the next action 50% on thaw (`advanceOnExpire`). |

**Nice-to-haves**

| Item | What changed |
|---|---|
| Light Cone banner | `banners/oath-of-embers-cone.json`: 0.8% 5★ / 6.6% 4★, hard pity 80, soft pity from pull 66, 75/25 featured odds, own pity group `limited-light-cone`. |
| Abstract Ultimate resource | `ultimateResource: { kind: "energy", max } \| { kind: "points", name, max, cost, initial }` replaces `maxEnergy`; `ultimatePoints` effect; runtime `UltimateGauge`. The archive shows Max Energy or the point counter. |
| Debug overlay | Off by default (`debug.overlay: false`, F3 or the backquote key toggles it), placed below the back button and height-capped; full width under the area title on phones. |
| "TEST SCENE" banner | Moved into the sky band (13 vh) on a soft horizontal scrim, smaller type, so it no longer crosses a crystal; checked at all sizes. |
| Input monitor | Keycap highlight has no fade, so the highlighted keys and the "No input" / action text change in the same frame. |
| Rarity colours | Gold 5★ / purple 4★ (/ blue 3★) tokens, rarity-coloured stars, gradient card backdrops and Light Cone card tints. |
| Chamfered corners | `--chamfer-*` clip-path tokens: menu rows, character cards, info cards, the input monitor and the debug overlay use clipped corners; pills remain for buttons, chips and badges. |

## 8. What Phase 2 will add (Player controller)

- A third-person procedural placeholder character with walk / run / sprint, acceleration and turn smoothing, ground snapping, slope limits and capsule collision against a greybox collision world.
- The `PlayerController` service behind `PlayerToken`, driven only by input **actions**, with locomotion tuning in `src/data/rules/locomotion.json`.
- An interaction-prompt query (`interact`), overworld attack and Technique hooks (encounter advantage flags emitted on the bus for Phase 5), and party-leader switching.
- Unit tests for movement integration, collision resolution and the state machine. An E2E walk test with screenshots of a greybox test area. Phase-1 systems must keep passing.
