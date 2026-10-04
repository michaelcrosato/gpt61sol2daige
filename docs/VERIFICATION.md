# Verification record

The evidence here distinguishes tested behavior from operating limits. Source tests are executable; selected captures and benchmark JSON are committed under `docs/evidence/`. Full test traces and generated output stay in ignored local artifact directories.

## Reproduction gates

The delivered source passes **21 headless tests**, TypeScript, lint/format checks, and the production build. The browser suite passes desktop gameplay, mobile controls, and actual eight-player co-op. GitHub Actions also completed the full local-signaling suite on an independent Linux runner. Production gameplay/mobile checks and the public-signaling eight-client test passed; an earlier public connection attempt timed out before a diagnostic retry and the complete eight-client rerun succeeded.

```bash
npm ci
npm run check
npm run build
npm run test:e2e
npm run bench
# With npm run dev running:
npm run bench:browser
```

The browser suite starts isolated app/signaling processes on ports 5187 and 9018. `BASE_URL` targets an existing app, including production. No simulated WebRTC adapter is used. Chrome runs headlessly with background throttling disabled for multiple test tabs. The eight-client test places most clients in the lab to avoid conflating connection correctness with eight competing renderers on one workstation; one guest renders the 6,000-NPC view.

## Requirement-to-evidence map

| Brief requirement | Implementation | Acceptance evidence |
| --- | --- | --- |
| Ground-up 2D top-down engine | Pure TypeScript simulation, own renderer/physics/world/quest | Source modules plus headless and browser suites |
| Fast, token-efficient agent development | Bounded JSON observations, command discovery, explicit stepping, shared browser/Node API | CLI JSONL example executed and recorded; replay hash matched |
| Massive open-world streaming | Seed/coordinate generation, negative coordinates, 1,024-chunk LRU, bounded render cache | Eviction/regeneration test visits 60 widely separated chunks with an 8-chunk test budget; cache and content checks pass |
| Up to eight online co-op players | Real WebRTC star network with host simulation and input authority | Eight isolated browser contexts; movement, shared beacon, 6,000-entity state, terrain edits, ninth-player rejection, slot replacement and host disconnect |
| Good physics for the game | Spatial broad phase, impulses, unequal masses, restitution, tile/trunk contacts, substeps, wading and forces | Momentum, broad-phase, high-speed wall, gameplay dash/pulse and deterministic simulation tests |
| Thousands of on-screen NPCs | 8,192-capacity typed arrays, culling/LOD | 8,192-NPC headless test; 6,000 actually drawn during 300 browser frames |
| Close and far zoom | 0.08×–5× camera, detail/overview rendering | Browser controls, far-view entity count and screenshots |
| Modern pixel graphics and smooth animation | Procedural pixel recipes, cached poses, 60 Hz position interpolation | Desktop/mobile visual inspection, atlas/lab captures, browser frame benchmark |
| Procedural graphics and animation tools | Shared runtime/export pixel recipes, palette validation | SVG generation and animation tests; custom sprite recipe exported successfully |
| Procedural sound and music | Pure seeded PCM synthesis, Web Audio, WAV export | Every sound checked for finite, bounded, non-silent samples and correct WAV headers; browser sound toggle exercised |
| Agent level-design tools | JSON terrain brushes, patch files, preview SVG, chunk export | Brush invalidation/checkpoint/replay tests; level/chunk CLI runs; online patch replication |
| Better verification | Versioned saves, deterministic replay, complete checkpoint comparison | Headless repeatability and exact post-restore equality; browser recording replayed by Node |
| Environment reproducibility | Node 24, pinned lockfile, local Chrome, locally bundled assets/fonts | Successful install/typecheck/tests/build and documented commands; no runtime LLM or GPU API |
| Approach/design/time-allocation report | `docs/REPORT.md` and hosted static documentation | Report covers decisions, alternatives, procedural investment, work allocation, measured results and limits |
| Public GitHub repository and Vercel production | Repository and deployment configuration | Final delivery checks inspect GitHub visibility, remote commit, Vercel readiness, public HTTP response and deployed browser behavior |

## Measurements

CPU workload: seed 142, one moving player, 120 warm-up ticks, 360 measured ticks per population. Node v24.21.0 on Ubuntu/WSL2, Intel i7-14700F, 20 logical cores.

| Active NPCs | Median tick | p95 tick | Mean tick | Full-range snapshot |
| --- | --- | --- | --- | --- |
| 1,000 | 0.418 ms | 0.792 ms | 0.454 ms | 16,523 bytes |
| 2,400 | 0.875 ms | 1.016 ms | 0.898 ms | 38,923 bytes |
| 6,000 | 2.573 ms | 2.931 ms | 2.615 ms | 96,523 bytes |
| 8,192 | 3.757 ms | 5.546 ms | 4.003 ms | 131,595 bytes |

These are measurements of the delivered implementation on a shared workstation. Full-range snapshots include the metadata for one player and no edited tiles; actual packet size varies with players, camera interest, events and edits. [Raw CPU benchmark](evidence/benchmark.json).

The final 300-frame browser measurement includes both Canvas rendering and live simulation: 1440×1000, 6,000 visible creatures, 0.18× zoom, mean **60.15 FPS**, p95 frame interval **16.7 ms**. The nominal display refresh rate caps this measurement. It is not a minimum FPS guarantee on other machines. [Raw browser benchmark](evidence/browser-benchmark.json). An earlier run with other QA browser sessions still open averaged 54.54 FPS; [that measurement is retained](evidence/browser-benchmark-loaded.json) to show workload variability.

## Fixes exposed by verification

- A browser test initially encountered a different project's dev server on a shared port. The suite now owns dedicated ports and refuses to reuse an existing server.
- Large PeerJS messages arrived as Uint8Array after reassembly rather than ArrayBuffer. The transport now normalizes both forms; a typed-array offset test and the 6,000-entity co-op test exercise that path.
- A synthetic mobile test supplied an inactive pointer ID. It now uses a real pressed pointer and checks for browser errors.
- Replay recording restarts on transition from an online session to solo, and imported browser saves normalize player ownership.
- Detailed terrain uses a working-set cap so wide zooms switch representation before exceeding the terrain image cache.
- Wildlife slots now follow stable party anchors, so explorers traveling far from a stationary host receive their share of the population. A separated-traveler test covers this, including save/restore. A 6,000-NPC dispersed benchmark measured a 4.64 ms p95 tick, 750 creatures near each of eight travelers 10,000 units apart, and 671 chunks inside the 1,024-chunk limit. [Dispersed-world evidence](evidence/dispersed-benchmark.json).

## Scope limits

The physics tests cover circles, static terrain and the reference game's interactions. They do not establish arbitrary-polygon rigid-body behavior. Eight contexts prove real transport and shared-state operation on the tested host; they are not eight remote households behind different NATs. No cross-region latency or TURN fleet capacity has been measured. Browser audio verification checks activation plus generated PCM correctness; there was no human listening panel. The active NPC pool recycles dormant entities, while terrain and quest/resource edits persist. These limitations are explained in the architecture and design report.
