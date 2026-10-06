# Agent protocol

Call `describe` first. Commands are shared by the Node JSONL tool, `AgentRuntime.execute`, and `window.fern.command`. Browser networking has an additional small control API.

## Headless session

```bash
node tools/agent.ts --seed 142 --count 2400 < examples/walk.jsonl
node tools/agent.ts --seed 142 --record artifacts/walk.json < examples/walk.jsonl
node tools/agent.ts replay artifacts/walk.json
```

The command server reads one JSON object per line and returns one response per line. Errors are structured and do not terminate the session. Keep lines under 8 MB. For larger checkpoints, send `{"op":"restore-file","file":"artifacts/checkpoint.json"}` to the Node tool; it validates/imports the file without embedding it in a command line. When supplied, `id` is echoed as the request identifier (the `join`/`leave` command also uses `id` as its player identifier).

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
| `encounters` | `action?`, `index?`, `seed?`, `plan?`, `manifest?` | M11 generated encounters (read-only): `catalog`, `preview`, `validate`, `export` ([details](#m11-generated-encounters)) |
| `step` | `ticks`, 0…36,000 | Advances exactly that many fixed ticks; prefer small batches in the browser |
| `inspect` | `x`, `y`, `radius?` (0…5,000), `limit?` (0…100) | Tile, biome and a bounded set of nearby entities |
| `population` | `count`, 0…65,536 | Resizes active NPC pool |
| `teleport` | `player?`, `x`, `y` | Requires a walkable point within world bounds |
| `paint` | `tx`, `ty`, `width?`, `height?`, `terrain`, `decor?` | Applies a rectangular tile brush atomically; at most 2,048 edited tiles total |
| `reset` | `seed` (uint32), `count?` | Starts a new simulation and local player |
| `join` | `id`, `name?` | Adds a headless simulated player; maximum eight; **not an online connection** |
| `leave` | `id` | Removes a headless simulated player |
| `save` | none | Full versioned checkpoint including typed-array contents and terrain patches |
| `restore` | `state` | Validates and restores version-1 or version-2 checkpoints |
| `restore-file` | `file` | Node CLI only: reads a complete checkpoint file, including expanded physical saves above 8 MB |
| `interact-physics` | `id,x,y,atX?,atY?,player?` | Host/solo validates a nearby movable prop impulse; online guests use `network.interact` with connection-owned identity |
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

Solo dialogs and the atlas pause the live clock; explicit `step` still advances it for QA. Closing a dialog preserves an explicit `pause(true)`. Online menus never pause the party. Combat observations are bounded; `save` is the full inspectable state. The live-enemy limit is 100, distinct from the 65,536 ambient-creature pool. Complete M04 physical scenes carry all party builds; the bounded observational snapshot helper omits other players' unequipped items.

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

In solo **Agent lab**, choose **Open / reset playground**, select a body and use **Push right**, **Push off center** or **Launch swept body**. The collider checkbox is presentation-only. Pause/run and explicit tick controls use the same simulation clock. Save trail, Snapshot JSON and replay include the physical scene. Close the standalone playground before hosting/joining. Shared physical edits use the playable adventure scene.

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

When importing the engine directly, await `initializePhysics()` from `src/physics/bootstrap.ts` first; synchronous construction, restore, commands and replay follow that barrier. Dispose caller-owned `Simulation` instances when finished. World-v4 checkpoints identify the backend and retain complete semantic state for incompatible-backend rebuilding; original M01/M02 raw formats import explicitly, and old version-1 saves without this member retain their builds/terrain with fresh physical content. FPS/throughput telemetry is informational, with no FPS acceptance threshold.

M02's policy document remains version 1. M04 writes outer save 2, adventure envelope 2 and world 4, retaining explicit M01–M03 import. Room protocol is 5 with a separate physical channel. Collider/region overlays are local device preferences, absent from saves and hashes.

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

## M03 playable adventure physics

Solo adventures use Rapier actors and occupied terrain automatically. In Agent lab choose **Physics scene → Playable adventure** to inspect and edit the real run. Select land/area/region, queue crowd contacts, ambient physics, prop blocking, prop dynamics, swept collision or the master switch, then step/run or apply while paused. The normal world renders solved actor/prop poses. Playground remains a separate scene. Hosts can edit the shared adventure policies/bodies; guests inspect their received scene and request nearby prop impulses through the host.

`actors` actions use the same command/replay route:

| Action | Fields and behavior |
| --- | --- |
| `inspect` (default) | Backend, land ID, bounded first 100 bodies, total body count, policies/provenance, all optional props, occupied chunks and complete movement-owner counts. The body preview limit never limits physical participation. |
| `body` | `id`: complete solved pose and effective policy for one stable ID |
| `configure` | `expectedRevision`, `edits`: same atomic PolicyEdit queue; adventure area bindings cannot be removed while needed for entry/handovers |
| `apply` | `expectedRevision`: deliberate paused boundary, including ambient ownership, without advancing game ticks |
| `policy` | `areaId?`, `x?`, `y?`: effective values/provenance; default area follows coordinates |
| `impulse` | `id,x?,y?,atX?,atY?`: same physical impulse units; props honor strength/freeze; character rotation stays locked |
| `place` | `id,x,y`: relocate a prop and retain consequences; use normal `teleport` for the player |
| `spawn` | `body`: prop BodyRecipe, explicit current `areaId`, unique ID starting `prop-`; no playground body cap applies to adventure |

Stable IDs: `player-<player ID>`, `enemy-<enemy ID>`, `ambient-<slot>-<generation>`, `crate-<area>-<0..3>`, `wheel-<area>`. Terrain keys include `terrain-land-<run>-<land>-<tx>-<ty>-water|decor`. Default scoped IDs include `town`, `wilderness`, `area-1`, `quiet-1`, `reactive-1`; read inspection for the current land. `crowdContacts`, `ambientPhysics`, `sweptCollision` are booleans added to the registered M02 fields. Master-off suppresses optional contacts/ambient/prop dynamics while retaining core movement, solid terrain and base combat. Core actor CCD stays on even when optional swept checks turn off.

```json
{"op":"encounter","index":1}
{"op":"actors","action":"configure","expectedRevision":0,"edits":[{"type":"override","scope":"area","id":"area-1","values":{"crowdContacts":false,"ambientPhysics":true}}]}
{"op":"step","ticks":1}
{"op":"actors","action":"body","id":"player-local"}
{"op":"actors","action":"inspect"}
```

`save` includes the complete versioned `actorPhysics` member. Same-build replay and save continuation retain motor/external velocity, policy samples, ownership, navigation and mutations. Node/Chrome trigonometry may differ in insignificant digits; compare actual physical outcomes with stated tolerances across runtimes, and use exact replay in the originating runtime. `node tools/physics-actors.ts` produces the M03 encounter receipt; `--population 65536` deliberately enables every selected creature and reports informational first-tick timing. This does not advertise later reaction systems.


## M04 physical co-op and checkpoint import

```js
await window.fern.network.interact({id: "crate-1-0", x: 100, y: 0});
window.fern.command({op: "actors", action: "body", id: "crate-1-0"});
window.fern.network.status(); // baselineReady, physicalRevision, population, byte counters
```

A guest must finish its complete baseline before interacting. Requests accept a prop within 96 units, ±120 impulse components and optional paired application coordinates within 32 units of that prop. The host supplies identity and rejects policy fields, actor targets, unknown objects and excessive/far interactions. Frozen props discard impulses. Host `actors/configure` uses the same expectedRevision/atomic edits as solo; guests can read `inspect`, `body`, `policy`, `props` and `recipes` but cannot edit or damage shared physics. The host lab's Playable adventure controls remain available online; explicit paused apply requires a solo pause.

Physical wire 2 uses protocol-5 rooms (protocol 6 from M05) and reliable 48,000-byte chunks with a checked manifest, complete portable scene and lifecycle events. Its 256 MB total bound is separate from the observational packet's 512 KB header. Missing/duplicate/reversed/stale chunks never publish partial state. All selected ambient creatures and physical bodies remain in the replica even when local draw settings show fewer. Lossless gzip, one shared cost-spaced frame build, staged receipts and buffer-paced immutable retries carry the whole scene; a progressing baseline can outlast the initial handshake timer. A 1 Hz host heartbeat keeps guests of a loaded host connected while their acknowledgements wait. Compressed and expanded lengths are bounded, and inflation is validated before publication. Large scene transmission can take longer; it never cuts physical eligibility. Portal/land transitions snap interpolation, and leaving/host loss retains the received scene and each guest's build for solo play.

```bash
node tools/agent.ts --count 0 <<'JSONL'
{"op":"restore-file","file":"artifacts/checkpoint.json"}
{"op":"observe"}
JSONL
```

This file path supports expanded saves exceeding the unchanged 8 MB JSONL line limit. `describe` lists `restore-file` as CLI-only. Save 2 includes world-4 semantics, motor/knockback, policies/queues, stable IDs, terrain/land mutations, builds/progression and backend bytes; incompatible-backend restore rebuilds those facts. Original M01–M03 checkpoints migrate explicitly. See [save/transport contracts](ARCHITECTURE.md#m04-saves-replication-and-recovery).

## M05 materials and destructible scenery

Every clearing now holds crates, barrels (one volatile), pots, a log, loose stones, a wheel, a wagon, a three-segment fence, a glass pylon, a lantern and three trees. Each prop carries a registered `material` and a `blueprint` `{family, palette, piece?, parent?, expiresAt?}`; `consequences.durability` is the percentage remaining (100 intact, absent for stumps and debris). Authored attacks (slash, Whorl, Nova, Bloom, Bramble, Rift and delayed effects) damage props in their reach through the same material rules. A destroyed parent is replaced by authored gameplay-solid pieces and recorded once.

| Action | Fields and behavior |
| --- | --- |
| `props` | Every scenery body (material, blueprint, durability, solved pose, effective policy) plus `destroyed` parent records. Works on guests' received scenes. |
| `recipes` | Reproducible export: materials, families (variants, toughness, reward, pieces), stage thresholds and clearing layout. Works on guests. |
| `damage` | Host/solo only. `id`, `damage` 0–10,000, optional `angle` (fall/burst direction). Runs the attack path's material resistance, durability stage, fracture, one-time reward drop and feedback events; returns the `PropHit` list. |

```json
{"op":"encounter","index":1}
{"op":"actors","action":"damage","id":"prop-pylon-1-0","damage":20}
{"op":"actors","action":"damage","id":"prop-stone-1-0","damage":15}
{"op":"actors","action":"configure","expectedRevision":0,"edits":[{"type":"override","scope":"area","id":"area-1","values":{"materialDurability":2,"debrisLifetime":30}}]}
{"op":"step","ticks":1}
{"op":"actors","action":"props"}
```

New IDs: `prop-<family>-<area>-<n>` for clearing scenery and `<parent id>-<piece>` for fracture pieces (`plank0`, `shard3`, `chunk1`, `rim2`, `hub`, `hoop`, `canopy`, `wheel0`, `rail1`, `half0`, `frame`, `pane`, `stump`, `log`). Broken pieces that are themselves families (a tree's `log`, a wagon's `wheel0`) can break again; debris and stumps move but never break. `PropHit` reports `resisted` (material resistance absorbed a weak hit), `protectedByPolicy` (destruction off: damage is preserved, nothing new happens), `durability`, `stage` 0–3 and `broken {pieces, reward}`. Combat events add `impact` (`<material>:resisted|protected|stage<n>`) and `break` (`<family>:<material>`, amount = pieces); they are bounded observations outside replay hashes.

Policy values add `destruction` (boolean), `materialDurability` (0.05–20, divides material damage) and `debrisLifetime` (0–3,600 s; 0 keeps debris for the scene). Saves write adventure envelope 3 / world 5; rooms use protocol 6. Real M04 checkpoints migrate with exact legacy bodies. Guests read `props`/`recipes` but cannot `damage`. See [the M05 contract](ARCHITECTURE.md#m05-materials-and-destructible-scenery).

## M06 combat forces, grab/throw and physical loot

| Command | Fields and behavior |
| --- | --- |
| `{"op":"actors","action":"attacks"}` | The shared attack spec: impulse, torque, material multiplier and cover/pierce/ricochet rules per ability, plus impact formula, ownership window and team rules. Works on guests. |
| `{"op":"adventure","action":{"type":"grab","id":"crate-1-3"}}` | Host-validated: a loose, unfrozen prop within 72 units and mass ≤ 8 that nobody else holds. The prop follows the traveler's aim (`aimX/aimY`, else facing). |
| `{"op":"adventure","action":{"type":"release","throw":true}}` | Throw along the aim (speed 430 × force × impulse strength, slower for heavy props) and own it for 2.5 s; `throw:false` sets it down. |
| `actors` `inspect` → `combat` | `{instigators, impacts, suppressed, holds, settled}`; guests' replica inspection includes the same record. |

```json
{"op":"encounter","index":1}
{"op":"adventure","action":{"type":"grab","id":"crate-1-3"}}
{"op":"input","aimX":1,"aimY":0}
{"op":"step","ticks":10}
{"op":"adventure","action":{"type":"release","throw":true}}
{"op":"step","ticks":30}
{"op":"actors","action":"inspect"}
```

Combat events add `impact` texts `impact:hit` (a launched prop struck a monster), `<material>:cover` and `<material>:deflect`, and `grab` events (`<id>`, `throw:<id>`, `drop:<id>`). An environmental kill emits `kill` with owner `""` and text `environment`. New policy values: `impactDamage`, `projectileWorld`, `physicalLoot` (booleans) and `impactStrength` (0–10). Item affixes and `HeroStats` add `force`, `shatter` and `ricochet`. Saves write adventure envelope 4 / world 6; rooms use protocol 7. See [the M06 contract](ARCHITECTURE.md#m06-combat-forces-projectiles-and-physical-loot).

## M07 jointed mechanisms

| Command | Fields and behavior |
| --- | --- |
| `{"op":"actors","action":"mechanisms"}` | The registry (kinds, joint types, strain/cut/motor/policy rules, launch speed) plus every assembly, joint (intact or broken, load, peak, damage, motor), drawable link with strain, and gate/launcher/causeway state. Works on guests (read-only). |
| `{"op":"actors","action":"cut","id":"chain-1:anchor"}` | Cut damage to one joint (default: enough to sever) through the joint-breakage policy; returns `{damage, threshold, broken, protectedByPolicy}`. Host only. |
| `{"op":"actors","action":"motor","id":"vane-1:pivot","motor":{"mode":"velocity","target":-2,"stiffness":0,"damping":1.5}}` | Change or stop (`null`) a hinge or slider motor; the state is saved. |
| `{"op":"actors","action":"transport","id":"prop-chain-1-ball","dx":300,"dy":40}` | Move a member's whole connected part with its motion; refused while it is anchored to a post. |
| `{"op":"physics","action":"assembly","recipe":{…},"joints":[…]}` | Lab: attach an assembly to spawned bodies whose recipes name it; lab `cut` and `motor` as above. |

Joint ids are `<assembly>:<name>`: `gate-N:hinge`, `chain-N:anchor|link1..3|ball`, `vine-N:root|seg1..5|pod`, `launcher-N:slider|spring`, `vane-N:pivot`, `bridge-N:south|deck1..3|north`. Parts are `prop-gate-N-leaf`, `prop-chain-N-ball`, `prop-vine-N-pod`, `prop-launcher-N-sled`, `prop-vane-N-rotor` and `prop-bridge-N-plank0..3`, plus posts. `place` on a jointed member moves its part as a unit. Grabbing works on loose members (gate leaf, chain links and ball, vine, pod, sled), never planks or vanes.

```json
{"op":"encounter","index":1}
{"op":"actors","action":"impulse","id":"prop-chain-1-ball","x":0,"y":1500}
{"op":"step","ticks":6}
{"op":"actors","action":"cut","id":"chain-1:anchor"}
{"op":"step","ticks":30}
{"op":"actors","action":"mechanisms"}
```

Mechanism changes appear as `assembly` events (`gate:latched`, `gate:closed`, `launcher:cocked`, `launcher:fired`, `bridge:span-lost`, `<kind>:<joint>:snapped|cut`) with the responsible traveler as owner. New policy values: `mechanisms`, `jointBreakage` (booleans) and `jointStrength` (0.05–20). Saves write adventure envelope 5 / world 7; rooms use protocol 8. See [the M07 contract](ARCHITECTURE.md#m07-jointed-mechanisms-and-assemblies).

## M08 material reactions and fields

| Command | Fields and behavior |
| --- | --- |
| `{"op":"actors","action":"reactions"}` | The registry (stimuli, every rule with its parameters, material fuel/windage/flammable/conductive, containers, releases, field kinds, yard layout, chain and policy rules) plus the state: statuses, surfaces, fields, delayed reactions, chains (owner, origin, rules fired, visited `rule|target` keys, depth) and recent events. Works on guests (read-only). |
| `{"op":"actors","action":"stimulate","stimulus":"fire","id":"prop-brush-1-0"}` | Apply `fire`, `water`, `oil`, `shock` or `blast` to one body (`id`, a prop or `enemy-<id>`) or everything within `radius` (0–400) of `x,y`, with optional `strength` (0.1–4). Starts a chain owned by the caller and returns it. Honors the material and chain policies. Host only. |
| `{"op":"actors","action":"field","field":{"kind":"wind","shape":{"kind":"lane","x":900,"y":120,"angle":0,"length":200,"width":80},"strength":300,"ticks":600}}` | Add a field (`wind`, `pressure`, `attract`, `repel`, `vortex`; `circle {x,y,radius}` or `lane {x,y,angle,length,width}`; strength 0–20,000 units/s²; ticks, −1 permanent; optional `id`, `gust` 0–1, `actors`). `{"remove":"<id>"}` removes one. Host only. |
| `{"op":"actors","action":"body","id":"crate-1-0"}` | Now includes `reaction`, the body's status or `null`. |

Yard ids per area N: `prop-brazier-N-0`, `prop-jar-N-0..1` (oil), `prop-brush-N-0..4` (fuse), `prop-barrel-N-2` (powder keg), `prop-cask-N-0..1` (water), `prop-rod-N-0..1`, `prop-coil-N-0` and `prop-fan-N-0`. Authored wind lanes are `wind-N`. A struck fan's field is `fan:<fan id>`, a mechanic's is `mechanic:<id>` and an explosion's is `blast:<chain>:<source>`.

```json
{"op":"encounter","index":1}
{"op":"actors","action":"stimulate","stimulus":"fire","id":"prop-brush-1-0"}
{"op":"step","ticks":200}
{"op":"actors","action":"reactions"}
```

That reproduces the fuse chain: the brush burns segment by segment, lights the keg's fuse, and the explosion breaks the water casks, which spill and steam the debris. Reaction changes appear as `reaction` events with the chain owner. New policy values: `materialReactions`, `chainReactions`, `environmentalForces` (booleans) and `fieldStrength` (0–10). Saves write adventure envelope 6 / world 8; rooms use protocol 9. See [the M08 contract](ARCHITECTURE.md#m08-material-reactions-and-environmental-fields).

## M09 physical rigs and reactions

| Command | Fields and behavior |
| --- | --- |
| `{"op":"actors","action":"rigs"}` | Returns, read-only and on guests too: <ul><li>the rig registry: each rig's parts with sockets, mass shares, limits, materials, follow/lag, channels, detachables and art-measured geometry, plus the reaction and death rules;</li><li>every monster's `reaction` (lean, poise, stagger, knockdown, last blow, shed mask) and its drawn part pose;</li><li>remains records (enemy, rig, birth and landing ticks, fall angle) with each body's pose, motion, `frozen`, material, part and `loose`;</li><li>loose pieces, foliage bend and townsfolk positions and shove.</li></ul> |
| `{"op":"actors","action":"monster","rig":"brute","x":600,"y":0,"hp":400,"passive":true,"clear":true}` | QA. Places a monster with the chosen rig in the current area, uncounted for the area goal. Options: <ul><li>`passive`: planted and never attacking;</li><li>`boss`;</li><li>`clear`: other live monsters leave without reward, and the area spawns no further waves or boss (it cannot be cleared afterwards).</li></ul> Returns `{id, body, rig, hp}`. Host only. |
| `{"op":"actors","action":"hit","id":"enemy-12","damage":40,"angle":0}` | One blow through the ordinary hit path, credited to the caller, from the direction `angle` (the blow travels along it). Recoil, poise, stagger, knockdown, shed armor, the kill, its rewards and the remains follow exactly as in play. Host only. |

Remains ids:

- `prop-remains-<enemy>-<part>` for each part, in assembly `remains-<enemy>`;
- `prop-remains-<enemy>-<piece>` for loose armor, bark and lantern cores.

Their `blueprint.rig` tag names the rig, part, theme, variant, scale, mirroring, birth tick, fall angle and fall pivot. Townsfolk bodies are `npc-rowan`, `npc-iona` and `npc-orin`, present in town only.

Rig events (`rig` combat events):

- `stagger:<rig>` and `topple:<rig>`;
- `shed:<rig>:<material>`;
- `fall:<rig>:<material>` when remains reach the ground;
- `npc:bump:<id>`.

```json
{"op":"encounter","index":1}
{"op":"actors","action":"monster","rig":"stalker","x":520,"y":-24,"hp":120,"passive":true,"clear":true}
{"op":"actors","action":"hit","id":"enemy-12","damage":5000,"angle":0}
{"op":"step","ticks":30}
{"op":"actors","action":"rigs"}
```

That kills the stalker and leaves a six-body ragdoll lying to the east. Use the monster's actual id from `monster`'s result.

- New policy values: `ragdolls` and `foliage` (booleans) and `reactionStrength` (0–10).
- Saves write adventure envelope 7 / world 9; rooms use protocol 10.
- Local `Settings` gain `cameraShake` (0–1) and `hitFlash` (boolean), and `observe().render.feedback` reports the last frame's shake and flash.

See [the M09 contract](ARCHITECTURE.md#m09-physical-rigs-and-expressive-reactions).

## M10 reactive towns and authored areas

| Command | Fields and behavior |
| --- | --- |
| `{"op":"actors","action":"showcase"}` | Returns, read-only and on guests too: <ul><li>the showcase registry (each mechanic's extension, set piece and off semantics) and the warden registry (move, telegraph, weakness, windup and exposure);</li><li>live restraints (`snare-<n>`: kind `bloom` or `lash`, body, anchor or point, rest length, owner, `until`, load);</li><li>recent showcase events;</li><li>every living warden's `warden` state (move, locked target `tx`/`ty`, `echoAt`, `exposedUntil`, `exposedBy`, `lastExposed`);</li><li>`setPieces`: the M10 body ids per area.</li></ul> |
| `{"op":"actors","action":"mechanic","id":4}` | QA. Uses area mechanic `id` now, as the caller, through the ordinary activation (costs and physical extension included); a mechanic that is not ready is refused. Returns the mechanic and the showcase state. Host only. |
| `{"op":"actors","action":"warden","id":"enemy-12"}` | QA. Makes that living boss's next attack, due now, its signature move: at its next attack it winds up for 64 ticks toward its target, which is locked when the telegraph starts. Returns `{id, name, warden}`. Host only. |

Set-piece ids follow `prop-<family>-<area>-<mechanic>-<instance>-<piece>`, for example:
- `prop-hedge-1-bramble-0-1` and `prop-barricade-5-cinder-0-front`;
- `prop-crate-8-rift-0-0` (rift freight);
- `vane-<area>-wind-<n>` (a vane assembly).

Town fixtures are `prop-<family>-town-…` in the assemblies `stall-town-<n>`, `lamp-town-<n>` and `bunting-town`. Other ids:
- thorn splinters: `prop-thorn-<seq>-<k>`;
- fields: `tailwind-<area>-<n>`, `gust:<mechanic>`, `mechanic:<id>` (a drifting knot), `thornburst-<seq>`, `breeze-town` and `sanctuary-<service>`;
- permanent pools: `pool-<area>-<n>`;
- regions: `market`, `wild-<area>` and `calm-<area>`.

Events:
- `assembly` events: `snare:grown`, `snare:snapped`, `snare:withered`, `lash:caught`, `lash:snapped`, `lash:withered` and `freight:carried` (amount = pieces).
- `mechanic` events: `warden:<move>` at the start of a telegraph (amount = windup ticks).
- `rig` events: `warden:exposed:<cause>` and `warden:crash`.
- Stormglass arcs are `reaction` events starting `conduct`. Echo repeats instigate with cause `echo:<ability>`.

```json
{"op":"encounter","index":6}
{"op":"actors","action":"monster","rig":"crawler","x":2600,"y":0,"hp":100000,"boss":true,"clear":true}
{"op":"actors","action":"warden","id":"enemy-1031"}
{"op":"step","ticks":70}
{"op":"actors","action":"showcase"}
```

That starts the Bloom Tyrant's lash at the traveler; after the telegraph a `lash` restraint holds them until a dash tears it (`warden:exposed:lash`). Use the boss's actual id and the area's position from `observe`.

- No new policy values. Saves write adventure envelope 8 / world 9; rooms use protocol 11.
- `node tools/adventure.ts playthrough 9 --reactions off` runs the route with the session master switch off and writes `playthrough-reactions-off.json`.
- `node tools/physics-world.ts` prints the M10 receipt.

See [the M10 contract](ARCHITECTURE.md#m10-reactive-towns-and-authored-areas).

## M11 generated encounters

Areas 9+ are generated from the encounter grammar; `encounters` inspects and checks them without screenshots. Every action is read-only, works on guests (export reads the received scene) and is never recorded in replays.

| Command | Fields and behavior |
| --- | --- |
| `{"op":"encounters"}` | `catalog`: the module kits (pieces, assembly, fields, surfaces, tags, switches), the 14 combinations (roles, chain rules, affinity, regional profile, how to start), profiles, warden armor and arena kits, slot geometry, route points, the cluster link reaches, warden moves and the selection/placement/fallback/persistence rules. |
| `{"op":"encounters","action":"preview","index":13,"seed":142}` | Builds that area (default: this run's seed, the current area or 9) without a running game and returns its manifest. The manifest holds: <ul><li>`reproduce`: the `reset` and `encounter` commands that rebuild it;</li><li>`plan`: the grammar's intent;</li><li>`realized`: clusters with combination, modules, slot, heading, links (rule, distance, reach, ok), region and profile, plus the filler, arena, warden, routes, fallbacks, overlaps and body count;</li><li>`policies`: the cluster regions' values;</li><li>`rules`: the M08 rule parameters the combinations rely on;</li><li>`modules`: every generated body with family, position and assembly.</li></ul> Optional `plan`: an edited `EncounterPlan` to realize instead. |
| `{"op":"encounters","action":"validate","seed":142,"plan":{…}}` or `{…,"manifest":{…}}` | Returns `{ok, errors, warnings, manifest}`. Errors: <ul><li>unknown references (`unknown module trebuchet`, `unknown combination …`, `unknown armor …`, `unknown boss move …`);</li><li>impossible placements (overlapping bodies, a broken chain link, a planned cluster that could not stand);</li><li>a route a module closed;</li><li>for a manifest, any difference from a fresh build of its seed (`manifest does not reproduce: …`).</li></ul> Fallbacks are warnings. |
| `{"op":"encounters","action":"export","index":10}` | The current land's realized manifest as built (default: the current area), the live values of its cluster regions, and `mutations` since the land was built: destroyed module pieces (cause, owner, tick), missing ones and those moved more than 1 unit. A land saved before M11 answers "saved before generated encounters (M11); it keeps its earlier content". |

Ids in a generated area:
- cluster pieces: `prop-<family>-<area>-c<k>-<n>-<tag>` (cluster k, module n), for example `prop-brazier-12-c0-0-0`, `prop-barricade-12-c0-2-front`, `prop-coil-10-c1-0-0`;
- filler pieces: `prop-<family>-<area>-m-<module>-<tag>`;
- arena pieces: `prop-<family>-<area>-a<n>-<tag>`;
- assemblies: `<kind>-<area>-c<k>` (cart, chain, launcher, vine, vane, gate), `<kind>-<area>-m` and `chain-<area>-a<n>n`;
- pools: `pool-<area>-c<k>-<n>`;
- fields: `gale-<area>-c<k>-<n>-lane`, `maelstrom-<area>-c<k>-<n>-eye` and `-pull`;
- regions: `combo-<area>-<k>`;
- warden armor: `prop-armor-<enemy>-<k>`, each held by a `mount` restraint in `actors showcase` (body, anchor `enemy-<id>`, rest, load).

Events: `assembly` `mount:armed:<armor>` (amount = pieces), `mount:snapped`; `rig` `warden:armored:<armor>`.

```json
{"op":"reset","seed":142}
{"op":"encounters","action":"preview","index":12}
{"op":"encounter","index":12}
{"op":"actors","action":"monster","rig":"stalker","x":2500,"y":200,"hp":10,"passive":true,"clear":true}
{"op":"adventure","action":{"type":"grab","id":"prop-jar-12-c0-0-0"}}
```

The preview names the Burning palisade cluster (`fire-stockade`) and its pieces. Hold the oil jar and walk it into the brazier's coals (movement input toward it, aim at it) until it catches, then set it down (`adventure release {throw:false}`). This starts the chain `heat`, `ignite`, `spill`, `coat`, `flare` and `spread`. A thrown jar breaks without catching. The stockade burns through in about 150 ticks (`encounters export` lists the destroyed boards). Use the ids your preview returns.

- No new policy values; cluster regions use existing ones. Saves write adventure envelope 9 / world 9; rooms use protocol 12.
- `npm run verify:run` now runs 12 areas (areas 9–12 are generated). In each generated area holding a combination it can start by input, the bot first sets one off with ordinary inputs (`leadIn`).
- `node tools/physics-encounters.ts` prints the M11 receipt.

See [the M11 contract](ARCHITECTURE.md#m11-generated-encounters-and-modular-wardens).

## M12 world physics controls, showcase and functional matrix

The in-game **World physics** panel (O, the HUD button, the game-mode menu or the pause menu) drives the same agent API, so an agent can reproduce every click:

| Command | Fields and behavior |
| --- | --- |
| `{"op":"actors","action":"policies"}` | The policy document alone: applied `state`, `pending` queue, `nextRevision` (the `expectedRevision` for `configure`), the projected `preview`, capability names and presets. Guests read the received document. |
| `{"op":"actors","action":"policy","x":629,"y":-120}` | Effective values, requested values, the source of each value and the regions at a point (unchanged; the panel's "Where you stand"). |
| `{"op":"actors","action":"body","id":"crate-1-0"}` | One body's pose, motion, material, policy (effective, provenance, regions), consequences and reaction status, plus `lastReaction` (rule, owner, tick and text of the last recorded reaction aimed at it) and `instigator` (who last pushed or threw it, while that credit lasts). Works on guests. |
| `{"op":"actors","action":"configure","expectedRevision":R,"edits":[…]}` then `{"op":"actors","action":"apply","expectedRevision":R+1}` | What every panel control sends. While paused (solo menus pause time) the panel applies at once. A running co-op host's edit commits at the next tick. The browser allows `apply` only while paused. |

Panel edits, by control:
- **Preset at a scope:** `{type:"preset",scope,id,preset}`.
- **One switch at a scope:** `{type:"override",scope,id,values:{key:value}}`. "Default" sends `reset … inherited` plus the scope's other live values.
- **Clear live changes here:** `reset … inherited`.
- **Reset to authored:** `reset … authored`.
- **Center on me, Larger, Smaller, Priority ±5:** a `region` profile upsert.
- **New region around me:** a `custom-<n>` circle (radius 80, priority 30).
- **Remove region** (custom regions only): `remove`.
- **Session master:** `{type:"master",enabled}`.
- **Undo every live change:** master on, every override reset, custom regions removed and edited regions reset to authored, in one transaction.

The showcase route is a scene recipe, [`examples/showcase.json`](../examples/showcase.json):
- `setup` holds agent commands; `as` names a spawned monster, for example `$target`.
- Each beat has an `at` staging spot, `steps` (`walk`, `slash`, `grab`, `drag`, `carry`, `wait`, `throw`, `release`, `whorl`, `region` with `preset` or `reset`, and inline `check`) and `expect` (`destroyed`, `intact`, `dead`, `remains`, `moved`, `rules`, `event`, `policy`).
- Every beat starts from the recipe's clean scene.
- `npm run showcase [recipe.json]` plays it headless and prints a receipt; it exits non-zero if a check fails.
- `npx playwright test e2e/showcase.spec.ts` plays it in the browser with real keys, mouse and panel clicks. `SHOWCASE_VIDEO=1` also records a video.

`tests/physics-matrix.test.ts` is the functional matrix. Every value in `POLICY_DEFAULTS` gets a cause and a measured effect in Brambleburst. Each one is checked on, off inside a scoped region, still off after a save and restore, received by a late-join replica, and back on. One more test covers the dependency combinations POLICIES.md names (master off with features on, joints off with breakage on, destruction off with impact damage on, base combat without reactions). `MATRIX_REPORT=1` prints the measured effects ([evidence](evidence/physics-m12-matrix.json)).

See [the M12 contract](ARCHITECTURE.md#m12-controls-showcase-and-release).
