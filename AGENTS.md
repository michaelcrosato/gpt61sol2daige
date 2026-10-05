# Working on Fern

The engine is the product. The browser UI is a playable reference and QA surface.

- Read `docs/ARCHITECTURE.md` and `docs/AGENT-PROTOCOL.md` before changing engine contracts.
- `src/engine/` and `src/audio/synth.ts` must import without a browser, DOM, GPU, or network.
- Do not use `Math.random`, wall-clock time, or object iteration with unstable ordering in simulation decisions. `performance.now()` is telemetry only.
- Content is seed + coordinates + validated patches. Chunk eviction must never change generated content.
- Keep checkpoints complete, versioned and validated. A state-affecting feature must survive save/restore and replay.
- `src/game/` owns the 2.0 adventure, skills, loot and encounter registries. Combatants have a separate 100-live-enemy budget; the 65,536 pool and local view caps cover ambient wildlife. Keep mechanics optional and recipe-driven. `npm run verify:run` clears nine areas with documented QA tuning; `npm run bench:combat` measures real combat frames.
- Agents use `npm run agent` (JSONL), `window.fern` (browser), sprite recipes, and terrain brushes. Add commands to `describe` and document them.
- Use `npm run check`, `npm run build`; run `npm run test:e2e` for simulation, renderer, controls, save or network changes. E2E owns ports 5187/9018 and refuses to reuse other projects' servers.
- `npm run bench` measures CPU simulation. `npm run bench:browser` measures 300 real frames against the dev server. Keep measured claims separate from limits and ambitions.
- This is a feature-first phase: get each base feature package in and working, even when performance is low. Keep things reasonably efficient where it is easy, but a performance concern never blocks a feature or a milestone. Benchmarks and stress tests are informational; a later stress-test pass decides what to scale back, tune or adjust for multiplayer.
- `npm run bench:quality` measures 6k, 16k, 32k and 65,536 creatures in game mode, including actual simulation Hz. Camera draw radius and visible budgets are local presentation settings; only population changes affect authoritative state. Co-op snapshot budgets and the 65,536-entity packet cap follow what single player needs; they are not performance targets.
- Single player comes first. Co-op is planned but experimental and will change with the game: it adapts to single-player features, never the reverse. Do not benchmark, tune or gate multiplayer performance, and do not cut or reshape a single-player feature to fit co-op. New shared state needs a headless replication/late-join check; the existing WebRTC browser scenarios are functional smoke checks to keep passing, and may be adapted or slimmed when the game changes. Whenever co-op is verified, use actual WebRTC connections, never room-count UI checks.
- Browser networking uses PeerJS only as transport/signaling. Gameplay, world generation, rendering, assets, quest logic and agent tooling are local source. The reactive physics plan explicitly authorizes Rapier2D behind the local physics adapter.
- `.env*`, `.vercel/`, test traces and runtime artifacts are ignored. Never commit credentials. Generated distributable assets and selected verification evidence belong in `public/` and `docs/evidence/`.

Main files: `simulation.ts` owns state; `world.ts` owns terrain; `physics.ts` owns contact response; `agent.ts` owns commands; `protocol.ts` owns packet boundaries. Keep presentation-only state out of replay hashes.

## Reactive physics implementation

For this phase, read `docs/physics/README.md`, `STATUS.md`, `HANDOFF.md` and the current milestone card before changing physics. The user prioritizes rich reactions and per-area/per-region options over performance optimization, scientific precision or cross-device bit identity. Benchmarks are informational; do not cut features to meet an FPS gate or add hidden adaptive cutbacks. Keep finite valid state, meaningful save/restore checks and same-build debugging. Host-authoritative co-op keeps working at a functional level and follows single player, as above.

Implement one milestone per fresh session, using the requested GPT-6.1 Sol Extra high (`xhigh`) selection in the client. Persist the handoff before finishing. Immediately push every created commit and include it in a merged PR before ending the milestone. Verify the result, then stop before the next milestone so a fresh context can take over. Never claim to have switched models, cleared the current transcript or reserved a context size without actual client support. The plan is documentation until its individual milestones are implemented and verified.
