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
- `npm run bench:quality` measures 6k, 16k, 32k and 65,536 creatures in game mode, including actual simulation Hz. Camera draw radius and visible budgets are local presentation settings; only population changes affect authoritative state. Keep co-op snapshot budgets and the 65,536-entity packet cap aligned.
- Never replace actual co-op verification with room-count UI checks. E2E uses eight isolated browser contexts and actual WebRTC connections.
- Browser networking uses PeerJS only as transport/signaling. All simulation, world generation, physics, rendering, assets, quest logic and agent tooling are local source.
- `.env*`, `.vercel/`, test traces and runtime artifacts are ignored. Never commit credentials. Generated distributable assets and selected verification evidence belong in `public/` and `docs/evidence/`.

Main files: `simulation.ts` owns state; `world.ts` owns terrain; `physics.ts` owns contact response; `agent.ts` owns commands; `protocol.ts` owns packet boundaries. Keep presentation-only state out of replay hashes.
