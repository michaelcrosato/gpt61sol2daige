# Agent protocol

Call `describe` first. Commands are shared by the Node JSONL tool, `AgentRuntime.execute`, and `window.fern.command`. Browser networking has an additional small control API.

## Headless session

```bash
node tools/agent.ts --seed 142 --count 2400 < examples/walk.jsonl
node tools/agent.ts --seed 142 --record artifacts/walk.json < examples/walk.jsonl
node tools/agent.ts replay artifacts/walk.json
```

The command server reads one JSON object per line and returns one response per line. Errors are structured and do not terminate the session. Keep lines under 8 MB. When supplied, `id` is echoed as the request identifier (the `join`/`leave` command also uses `id` as its player identifier).

```json
{"op":"input","x":1,"y":0}
{"op":"step","ticks":60}
{"op":"observe"}
```

An accepted call returns `{"ok":true,"result":…}`; failure returns `{"ok":false,"error":"…"}`. The engine emits no unsolicited diagnostic prose to stdout. CLI banners from `npm run` can be avoided by invoking Node directly.

## Commands

| `op` | Fields | Result / contract |
| --- | --- | --- |
| `describe` | none | Version, commands, limits and landmarks |
| `observe` | none | Compact state, checksum, players, adventure, quest and streaming/physics counters |
| `input` | `player?`, `x?`, `y?`, `dash?`, `pulse?`, `interact?`, `attack?`, `lance?`, `nova?`, `potion?`, `aimX?`, `aimY?` | Replaces input; missing axes/buttons become idle; axes clamp to −1…1; aim is a direction vector clamped to −1…1 per axis |
| `catalog` | none | Mechanics, themes, archetypes, 48 skill nodes and a sample recipe |
| `adventure` | `player?`, `action?` | Inspect the selected build/run, or execute a validated game action |
| `encounter` | `index`, `recipe?` | Debug-preview a positive safe-integer area or a validated custom `AreaRecipe`; changes the party encounter |
| `step` | `ticks`, 0…36,000 | Advances exactly that many fixed ticks; prefer small batches in the browser |
| `inspect` | `x`, `y`, `radius?` (0…5,000), `limit?` (0…100) | Tile, biome and a bounded set of nearby entities |
| `population` | `count`, 0…65,536 | Resizes active NPC pool |
| `teleport` | `player?`, `x`, `y` | Requires a walkable point within world bounds |
| `paint` | `tx`, `ty`, `width?`, `height?`, `terrain`, `decor?` | Applies a rectangular tile brush atomically; at most 2,048 edited tiles total |
| `reset` | `seed` (uint32), `count?` | Starts a new simulation and local player |
| `join` | `id`, `name?` | Adds a headless simulated player; maximum eight; **not an online connection** |
| `leave` | `id` | Removes a headless simulated player |
| `save` | none | Full versioned checkpoint including typed-array contents and terrain patches |
| `restore` | `state` | Validates and restores a checkpoint |
| `replay` | none | Initial checkpoint, recorded commands and final checksum |

Terrain values: `0 forest`, `1 meadow`, `2 sand`, `3 shallow water`, `4 solid deep water`, `5 path`, `6 stone`. Decoration values: `0 none`, `1 pine`, `2 oak`, `3 rock`, `4 flowers`, `5 reeds`, `6 mushroom`, `7 crystal`. Tile coordinates multiply by 16 to produce world coordinates. Painting under a body can create a solid tile; the next physics step resolves the overlap. Use paused QA when making structural changes.

Observe is intentionally bounded; request `save` only when you need the complete world state. State hashes are diagnostic checksums, not cryptographic proofs. Performance counters measure the last stepping call and are excluded from deterministic state.

## Browser control

```js
window.fern.pause(true);
window.fern.batch([
  {op: "population", count: 6000},
  {op: "input", x: 1, y: 0},
  {op: "step", ticks: 120},
  {op: "input", x: 0}
]);
window.fern.observe();
window.fern.zoom(0.18);
window.fern.view("world");
window.fern.pause(false);
```

Other methods: `describe()`, `start()`, `recording()`, `view("world"|"atlas"|"lab")`. `observe()` adds renderer and network telemetry. `batch` accepts at most 1,000 commands and applies them sequentially; it is not transactional. Pause before deterministic browser experiments so the animation loop does not advance between commands. Browser `input` commands remain active until changed or real movement/view input takes over.

Version 1.1 adds persistent view settings and game mode:

```js
window.fern.settings.set({drawDistance: 8192, entityLimit: 32768, population: 32768});
window.fern.settings.get();
await window.fern.display.enterGame(false); // Fill the window for automation, without a native request.
window.fern.display.get(); // {gameMode, fullscreen}
await window.fern.display.exitGame();
window.fern.settings.reset();
```

Draw distance is an integer from 256 to 16,384 world units. Visible-creature limit and simulated population are integers from 0 to 65,536; invalid values are rejected before applying any change. `showPerformance` controls the compact game HUD readout. Presentation settings do not change simulation state or replay hashes; a population change goes through the recorded engine command. Settings persist on the current origin/device. Guests may set their draw distance and creature limit, but cannot change population.

`enterGame()` defaults to a native fullscreen request and requires a user activation when the browser demands it; test the real button to verify native fullscreen. `enterGame(false)` uses the same game UI inside the browser window. `observe()` reports display state, viewport dimensions, draw distance, entity limit, eligible/drawn/limited counts, FPS and actual simulation Hz. The view budget affects network snapshots as well as drawing. To benchmark every active creature, make the world population and visible limit equal and zoom out enough to include the active region. `npm run bench:quality` measures four populations with 300 real frames each.

Browser checkpoint loading normalizes the session to one `local` traveler. Engine/CLI checkpoint restoration preserves the original players exactly. Solo replay recording restarts after leaving an online room; online replay is deliberately unavailable. Exported snapshots remain available for online inspection.

Browser save/load is asynchronous and uses IndexedDB; wait for the saved toast or restored state in browser automation. Legacy `fern:save:v1` localStorage checkpoints remain readable. Game-mode settings provide Save game and Load game controls, while the lab retains its original controls.

## Adventure actions (2.0)

```js
window.fern.game.observe(); // Run, live enemies/drops, local hero, derived stats, recent combat events.
await window.fern.game.action({type: "skill", id: "blade-0"});
await window.fern.game.action({type: "buy", index: 2});
await window.fern.game.action({type: "depart"});
window.fern.game.panel("skills"); // Also inventory, town, pause, mechanics.
```

The browser adapter executes locally as solo/host and sends acknowledged RPCs as a guest. The same headless call is `{"op":"adventure","action":{"type":"skill","id":"blade-0"}}`. Never call a guest's `command` to simulate authority; use `game.action` and `network.input`.

| Action `type` | Fields and effect |
| --- | --- |
| `depart`, `advance` | Leader leaves town for the next uncleared area, or advances after defeating the warden |
| `return` | Leader channels recall for 150 ticks; movement/damage interrupts |
| `respawn` | Revives a dead hero; preserves a live party encounter or returns a defeated party to town |
| `rest` | Town-only free life/spirit/flask refill |
| `skill` | `id`: catalog node; checks level, prerequisite, path investment, rank and unspent points |
| `respec` | Town-only refund; costs 10 gold per allocated point |
| `equip`, `sell` | `id`: owned item; selling requires town and an unequipped item |
| `sell-spares` | Town-only sale of unequipped common/magic gear; preserves rare/legendary finds |
| `buy` | `index`: 0–5; validates stock, funds and 40-slot bag capacity |
| `tuning` | Leader-only `values` partial object: `difficulty`, `playerDamage`, `playerHealth`, `enemyDamage`, `enemyHealth` (0.1–10), `playerSpeed`, `enemySpeed` (0.1–3); UI sliders use narrower maxima of 3 for difficulty and 5 for damage/health |
| `new-run` | Leader starts a newly seeded run, clearing builds/progression while retaining tuning |

`pulse` now casts Whorl as well as the existing wildlife impulse. `attack` repeats the melee combo; lance/nova require their unlocks. Held flags respect authoritative cooldowns. `(aimX, aimY) = (0, 0)` selects keyboard auto-aim toward a nearby enemy, falling back to movement direction. For explicit aim, normalize `(target.x − player.x, target.y − player.y)` to a unit direction vector. Every combat command, delayed echo, item roll and transition participates in deterministic replay.

Solo dialogs and the atlas pause the live clock; explicit `step` still advances it for QA. Closing a dialog preserves an explicit `pause(true)`. Online menus never pause the party. Combat observations are bounded; `save` is the full inspectable state. The live-enemy limit is 100, distinct from the 65,536 ambient-creature pool. Other players' unequipped inventory items are omitted from guest snapshots.

## Actual online sessions

```js
const room = await window.fern.network.host();
// In another independently loaded browser/context:
await window.fern.network.join(room);
window.fern.network.input({x: 1, y: 0});
window.fern.network.input({x: 0, y: 0});
window.fern.network.status();
window.fern.network.leave();
```

These methods establish real WebRTC connections. The separate `join` simulation command does not. The host enforces the eight-player limit and guest authority. Guests can inspect and save observations, but cannot reset, teleport, paint or change population. Host lab commands that would invalidate an ongoing room are also rejected. Hosts can paint terrain and change population; both synchronize.

## Assets and level design

```bash
npm run assets
npm run assets -- sprite examples/autumn-traveler.sprite.json --out artifacts/autumn
npm run assets -- level examples/moss-courtyard.level.json --out artifacts/courtyard
npm run assets -- chunk -1 2 142 --out artifacts/chunks
```

The default creates 64 SVG frames, ten WAV files and a manifest in `public/generated`. The runtime generates its own matching sprites/audio in memory, so it does not need to fetch the exported examples. A sprite recipe supplies version, kind, seed, and optional palette of 5–16 six-digit colors. Add new silhouettes by extending `spritePixels` once; Canvas and SVG export will agree.

Level recipes supply a seed and an ordered list of rectangular brushes. The exporter produces a patch file and a 48×48-tile SVG preview centered on the origin. Apply the same recipe interactively with `window.fern.batch(recipe.brushes.map(b => ({op:"paint", ...b})))`, after resetting to the recipe seed. From Node, `world.setPatches(level.patches)` loads the exported patch file. Snapshots and network packets preserve the resulting edits.

Chunk export returns terrain, decoration and variant arrays in row-major order. Coordinate hashing lets agents search seeds or generate distant chunks without first visiting intervening terrain. Do not edit generated PNG/SVG/WAV outputs and expect the runtime to change: recipes and source are authoritative.

```bash
node tools/adventure.ts                         # Catalog: mechanics, themes, rigs, layouts, skills
node tools/adventure.ts area 25 142             # Seeded AreaRecipe JSON
node tools/adventure.ts validate artifacts/adventure/area-25.json
node tools/adventure.ts rig examples/glass-warden.rig.json  # 80 SVG frames
node tools/adventure.ts playthrough 9           # Actual input-driven run; JSON evidence
```

`--out` selects an export directory. Rig recipes supply `version:1`, `rig`, `theme` and integer `seed`; runtime and SVG share `monsterPixels`. Area recipes select a theme, layout, signature/secondary mechanics, links, archetypes, power and kill goal. Read `catalog` for an example, validate edits, then preview with `encounter`. The playthrough accepts 1–64 areas and uses 2× player damage/health explicitly; its controller buys skills, equips upgrades, dodges and fights using ordinary inputs. It is a progression smoke test, not proof of balance at every generated depth.

## A useful change loop

1. Capture a seed, checkpoint and input/command sequence that reproduces the problem.
2. Inspect the relevant bounded region instead of dumping all entities.
3. Make the change in a pure engine module or validated asset recipe.
4. Replay it headlessly; compare the expected behavior and checksum, not just whether it runs.
5. Check the browser for visual, input or transport consequences.
6. Run the relevant benchmark when changing hot loops, entity limits or rendering detail.

`npm run check`, `npm run build`, and `npm run test:e2e` define the repository's verification gates. Tests use local signaling by default; production tests must explicitly target the deployed URL.

## Physics playground (M01–M02)

In solo **Agent lab**, choose **Open / reset playground**, select a body and use **Push right**, **Push off center** or **Launch swept body**. The collider checkbox is presentation-only. Pause/run and explicit tick controls use the same simulation clock. Save trail, Snapshot JSON and replay include the physical scene. Close the playground before hosting/joining; online and connecting rooms reject playground commands until M04.

The discoverable `physics` operation supplies these actions:

| `action` | Fields / result |
| --- | --- |
| `inspect` (default) | Backend, unit scale, tick, bodies with solved poses/velocities, sleeping/frozen state, effective policy/provenance, contacts and policy document/queue/preview; `{active:false}` when closed |
| `reset` | Open/recreate the ten-body crate/wheel/wall recipe, disposing the previous world and queue |
| `close` | Dispose the scene without changing adventure progress |
| `spawn` | `body`: `{id,motion:"dynamic"|"fixed",shape:{kind:"circle",radius}|{kind:"box",width,height},x,y,angle?,mass?,friction?,restitution?,damping?,ccd?,role?:"prop"|"terrain"|"actor",areaId?,consequences?:{destroyed,claimed,durability?}}` |
| `impulse` | `id`, `x?`, `y?` (default 0); optional `atX` and `atY` world-space application point together; linear impulse units are kg·Fern units/s |
| `sweep` | Predict the nearest collider on the authored lane and launch the real CCD body; returns its ID, path and hit fraction; use `step` to observe contact |
| `configure` | `expectedRevision`: current `policies.nextRevision`; `edits`: validated atomic `PolicyEdit[]`; queues a transaction and returns applied/next revisions |
| `apply` | `expectedRevision`: final queued revision; deliberate paused commit without advancing ticks. Browser rejects while running; the next tick normally applies accepted edits |
| `policy` | `areaId?` (default `playground`), `x?`, `y?` (default 0): inspect effective values/provenance and region entry membership at a point |
| `place` | `id,x,y`: deliberate relocation of the same lab body (±10,000), preserving angle/consequences, clearing motion and applying current scope membership |
| `drive` | `id,x?,y?`: lab contact actor intent in units/s, ±600 (default 0). Actor role requires a dynamic body; essential terrain remains blocking |

```json
{"op":"physics","action":"reset"}
{"op":"physics","action":"impulse","id":"wheel","x":240,"y":0,"atX":-140,"atY":54}
{"op":"step","ticks":60}
{"op":"physics","action":"inspect"}
{"op":"physics","action":"spawn","body":{"id":"my-crate","motion":"dynamic","shape":{"kind":"box","width":24,"height":24},"x":-100,"y":-90,"mass":2}}
```

Body IDs use 1–80 letters/digits/underscores/hyphens and must be unique. Spawn coordinates lie within ±10,000; circle radii are 1–256 and box dimensions 1–512. Mass is 0.01–10,000 (default 1), friction 0–10 (default 0.6), restitution 0–1 (default 0.3), damping 0–100 (default 0.35), and CCD defaults on. Angles and impulse components/application coordinates are finite and bounded by ±100,000. Fixed bodies reject impulses. The lab has explicit 4,096-body and 4 MB binary-checkpoint limits; these do not alter ambient population. These props remain an experimental scene and do not collide with adventure actors yet.

```bash
npm run physics                          # asserts the default scene's movement, spin, contacts, CCD and snapshot/replay
node tools/physics.ts my-scene.jsonl      # runs an authored command sequence and checks its snapshot/replay continuation
node tools/agent.ts --count 0 < examples/physics-playground.jsonl
```

When importing the engine directly, await `initializePhysics()` from `src/physics/bootstrap.ts` first; synchronous construction, restore, commands and replay follow that barrier. Dispose caller-owned `Simulation` instances when finished. Raw playground snapshots identify Rapier 0.21.0 and reject incompatible versions; old version-1 saves without this member retain the ordinary adventure path. FPS/throughput telemetry is informational, with no FPS acceptance threshold.

M02's policy document is version 1; the playground member is now version 2, with explicit M01 import. The outer save remains version 1 and network wire remains 3. Shared controls stay solo-only until M04. Collider/region overlays are local device preferences, absent from saves and hashes.

Each policy edit has `type` and these fields:

| `type` | Fields and semantics |
| --- | --- |
| `master` | `enabled`: session-wide absolute world-reactions switch |
| `margin` | `value`: finite 0–16 boundary hysteresis (default 1) |
| `land` | `profile:{id,values}`; upsert current profile layer |
| `area` | `profile:{id,landId,values}`; upsert, parent land must exist |
| `region` | `profile:{id,areaId,priority,shape,values}`; upsert bounds/profile, parent area must exist |
| `override` | `scope:"land"|"area"|"region",id,values`: merge live override fields |
| `preset` | `scope,id,preset:"Quiet"|"Reactive"|"Wild"|"Sanctuary"`: replace this scope's override with working M02 values |
| `reset` | `scope,id,to:"inherited"|"authored"`: remove the live override; authored also restores the original profile/region bounds. Custom profiles clear values and keep bounds |
| `remove` | `scope,id`: remove a current profile and its override; remaining references and body area bindings must remain valid |

Only `worldReactions`, `dynamicProps`, `propBlocking` (booleans) and `impulseStrength` (finite 0–10) are registered; omitted fields inherit, unknown controls are rejected. Presets: Quiet disables optional reactions; Reactive uses defaults; Wild multiplies commanded prop impulses by 2.5; Sanctuary uses 0.35 and disables prop blocking. Zero impulse strength suppresses commanded prop impulses without freezing contact dynamics. Numeric/boolean controls affect actual bodies, not graphics.

Shapes: circle `{kind:"circle",x,y,radius}`, rectangle `{kind:"rectangle",x,y,width,height}` (top-left), polygon `{kind:"polygon",points:[{x,y},...]}` (3–64 simple, possibly concave vertices). Coordinates are ±10,000; positive circle radius is 0.01–10,000 and rectangle dimensions 0.01–20,000. Priority is integer -1,000–1,000. Stable IDs follow body ID syntax. Final documents validate parent references, duplicate IDs and polygon geometry. Profile/transaction/queue limits are documented in [policy semantics](physics/POLICIES.md#m02-delivered-contract).

Resolution is defaults → land/area/region profiles → land/area/region live overrides, per field. Higher region priority then smaller stable ID wins overlaps. More-specific live overrides beat broader ones; broader live overrides beat authored region values. Master-off gates every optional capability regardless of feature-on. Inspect both `values` and `effective`, with per-value `provenance`. Tick-start center membership enters inside the margin and exits outside it; applied membership and position samples persist across saves.

```json
{"op":"physics","action":"configure","expectedRevision":0,"edits":[{"type":"preset","scope":"area","id":"playground","preset":"Quiet"}]}
{"op":"physics","action":"inspect"}
{"op":"physics","action":"apply","expectedRevision":1}
{"op":"physics","action":"configure","expectedRevision":1,"edits":[{"type":"override","scope":"region","id":"quiet-garden","values":{"worldReactions":true,"dynamicProps":true}}]}
{"op":"step","ticks":1}
{"op":"physics","action":"policy","x":-210,"y":-70}
```

In Agent lab, select land/area/region and its profile, queue individual overrides or a previewed preset, then step/run or apply while paused. Reset controls affect only the selected scope. The inspector shows effective settings and sources; the region JSON editor can author all three shapes. Move a frozen prop back out with **Place selected body**; it keeps its pose angle and restarts with zero motion. **Spawn contact traveler**, **Traveler left/right** and **Stop traveler** demonstrate real actor-to-prop blocking without migrating the adventure wayfarer. If wake overlap correction cannot find a valid pose, the inspector reports the frozen body and requests deliberate placement.

```bash
node tools/physics.ts examples/physics-regions.jsonl # asserts crossing, repeated-cause suppression, specificity, master-off, paused apply, save continuation and replay
node tools/agent.ts --count 0 < examples/physics-regions.jsonl
```
