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
| `observe` | none | Compact state, checksum, players, quest, streaming/physics counters, last eight events |
| `input` | `player?`, `x?`, `y?`, `dash?`, `pulse?`, `interact?` | Replaces input; missing axes/buttons become idle; axes clamp to −1…1 |
| `step` | `ticks`, 0…36,000 | Advances exactly that many fixed ticks; prefer small batches in the browser |
| `inspect` | `x`, `y`, `radius?` (0…5,000), `limit?` (0…100) | Tile, biome and a bounded set of nearby entities |
| `population` | `count`, 0…8,192 | Resizes active NPC pool |
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

Browser checkpoint loading normalizes the session to one `local` traveler. Engine/CLI checkpoint restoration preserves the original players exactly. Solo replay recording restarts after leaving an online room; online replay is deliberately unavailable. Exported snapshots remain available for online inspection.

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

The default creates 64 SVG frames, six WAV files and a manifest in `public/generated`. The runtime generates its own matching sprites/audio in memory, so it does not need to fetch the exported examples. A sprite recipe supplies version, kind, seed, and optional palette of 5–16 six-digit colors. Add new silhouettes by extending `spritePixels` once; Canvas and SVG export will agree.

Level recipes supply a seed and an ordered list of rectangular brushes. The exporter produces a patch file and a 48×48-tile SVG preview centered on the origin. Apply the same recipe interactively with `window.fern.batch(recipe.brushes.map(b => ({op:"paint", ...b})))`, after resetting to the recipe seed. From Node, `world.setPatches(level.patches)` loads the exported patch file. Snapshots and network packets preserve the resulting edits.

Chunk export returns terrain, decoration and variant arrays in row-major order. Coordinate hashing lets agents search seeds or generate distant chunks without first visiting intervening terrain. Do not edit generated PNG/SVG/WAV outputs and expect the runtime to change: recipes and source are authoritative.

## A useful change loop

1. Capture a seed, checkpoint and input/command sequence that reproduces the problem.
2. Inspect the relevant bounded region instead of dumping all entities.
3. Make the change in a pure engine module or validated asset recipe.
4. Replay it headlessly; compare the expected behavior and checksum, not just whether it runs.
5. Check the browser for visual, input or transport consequences.
6. Run the relevant benchmark when changing hot loops, entity limits or rendering detail.

`npm run check`, `npm run build`, and `npm run test:e2e` define the repository's verification gates. Tests use local signaling by default; production tests must explicitly target the deployed URL.
