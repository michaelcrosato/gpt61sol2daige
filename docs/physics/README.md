# Fern reactive physics implementation plan

Build a world that visibly responds to movement, attacks, collisions and the existing area mechanics. Rapier2D will provide the physical simulation; Fern will own the rules that make it enjoyable. Physical options must be controllable for an entire run, a land, an area and a region within an area.

The plan was prepared on 2026-10-04 against Fern 2.0 at `c47cb119d6f57c70ddf79a4a72db59376d68f1e5`. M01 now implements the Rapier foundation and solo lab playground; see [STATUS.md](STATUS.md) and [the M01 handoff](handoffs/M01.md) for its evidence and merge procedure. The remaining milestones describe the implementation target, not delivered adventure physics.

## User priorities

1. Make the world react richly and visibly. Prefer an ambitious, complete interaction over a placeholder or a reduced demonstration.
2. Provide working switches and tuning for physical features, including different behavior in different regions. A control must change the simulation, not merely its graphics.
3. Performance optimization, FPS thresholds and hardware parity are not acceptance gates. Record useful telemetry without trimming features to meet the previous benchmarks. Do not silently disable physics based on FPS or distance from a camera.
4. Prioritize enjoyable, legible motion over scientific accuracy or bit-identical results across devices. Keep saves, ordinary debugging and host-authoritative co-op reliable.
5. Preserve the familiar wayfarer, fast hack-and-slash controls, outward journey, skills, equipment and optional mechanics. Physics expands that game.
6. Implement one milestone per fresh context. Persist decisions and evidence before the reset. After every commit, push and merge; do not leave milestone commits stranded on a branch.

These instructions supersede earlier performance-first recommendations and the repository's original restriction against imported physics libraries. They do not waive valid-state checks, preventable crashes, working saves or actual multiplayer verification.

## What the finished game should feel like

A Whorl scatters a crate pile, knocks a lantern into dry brush and sends a loose wheel into a pursuing pack. A charging boss breaks a fence and pushes the fallen timbers ahead of it. Stormglass discharges through wet metal, igniting a barrel that tears a gate from its hinge. Gravity Knots pull enemies, debris and loose loot together; a Riftstep arch moves an unanchored assembly without leaving its joints behind. The result has readable impacts, material sounds, expressive death motion and clear ownership of kills and rewards.

The same scene can run with destruction, impact damage, joints or material reactions disabled. Switching a feature off does not restore broken objects or erase earned progress. Towns remain usable, and every required combat route remains finishable without exploiting physical mechanisms.

The target includes all six creature rigs, the eight existing authored areas, five land themes, town objects and subsequent generated encounters. A Rapier demo disconnected from the actual run is an intermediate milestone, not the finished feature.

## Read only what the current milestone needs

- [Status and next milestone](STATUS.md): current checkpoint and what has actually shipped.
- [Architecture and integration contracts](ARCHITECTURE.md): ownership, stepping, persistence, networking and source map.
- [Regional policies and control semantics](POLICIES.md): exact behavior of on/off controls and region boundaries.
- [Session handoff procedure](HANDOFF.md): models, context resets, verification and Git workflow.
- [Reusable implementation prompt](START.md): paste into a fresh implementation session.
- [Decision record](DECISIONS.md): choices that later sessions should preserve unless evidence warrants a documented change.

Start each implementation session with `AGENTS.md`, this index, `STATUS.md`, its one milestone card and the preceding handoff. Load only relevant sections of the architecture and policy documents. Do not reread the entire repository or all completed milestone transcripts.

## Milestones

Each row is a required deliverable with a playable or inspectable result. Cards contain the steps and acceptance checks. Execute sequentially; each milestone builds on the previously merged result.

| Milestone | Delivered experience | Completion demonstration |
| --- | --- | --- |
| [M01](milestones/M01.md) | Rapier runs in browser and Node; a physics playground exists | Push, spin and sweep real bodies; reset and dispose the scene cleanly |
| [M02](milestones/M02.md) | Per-area and per-region physical controls | Move the same prop across reactive and quiet regions, then toggle it live |
| [M03](milestones/M03.md) | Players, monsters and terrain use a coherent physical world | Fight and dodge through a real encounter; move props and crowd enemies |
| [M04](milestones/M04.md) | Physical state survives saves and eight-player co-op | Late join, change a region, move a crate, save/reload and disconnect |
| [M05](milestones/M05.md) | Materials, breakable scenery and persistent wreckage | Break crates, fences, glass and trees; debris remains real and damage is not duplicated |
| [M06](milestones/M06.md) | Combat, projectiles, loot and gear affect the physical world | Launch a prop into enemies; cast through cover; earn correctly attributed rewards |
| [M07](milestones/M07.md) | Joints, tethers and mechanisms | Swing a gate, pull a chain and break an anchor without resetting the assembly |
| [M08](milestones/M08.md) | Fire, wetness, electricity, wind and gravity combine | A reproducible multi-stage material reaction alters an actual encounter |
| [M09](milestones/M09.md) | Physical monster rigs and expressive reactions | All six rigs react to hits and transition into coherent death motion |
| [M10](milestones/M10.md) | Towns and all eight authored areas showcase physics | Complete the original outward route with physical advantages enabled and disabled |
| [M11](milestones/M11.md) | Generated physical encounters and modular boss interactions | Seeded encounters beyond area eight compose mechanisms, materials and bosses |
| [M12](milestones/M12.md) | Finished controls, showcase and verified release | Full run, regional switch matrix, real co-op and public deployment all work |

The dependency order is intentional: save/network ownership is settled before rich destruction and assemblies proliferate. Every feature milestone also extends persistence, network behavior, tools and validation for its own new state; M04 is not a substitute for those later checks.

## Definition of complete

- The milestone's stated experience is reachable through the game or its deliberate physics playground. Intermediate tooling is clearly identified; final features are integrated into the run.
- Behavior has inspectable state, actual visible consequences and the relevant audio/animation feedback. Menu entries and particles alone do not count as physical implementation.
- On/off transitions, region crossings, save/load and co-op have defined behavior. Each new feature supplies its own representative verification.
- The repository checks and applicable browser scenarios pass. Physics checks assert useful outcomes with justified tolerances; other established correctness assertions remain meaningful.
- No FPS threshold, old population throughput target or cross-device numerical identity blocks completion. Finite state, absence of runaway event loops and reachable gameplay do.
- The milestone has a committed handoff, immediately pushed commits, a merged PR, and release evidence. A fresh session verifies the merge before proceeding.

## Scope choices

Use the existing TypeScript, Canvas 2D, Web Audio, Node and PeerJS stack. Select the standard JavaScript/WASM Rapier2D distribution behind a local adapter. `@dimforge/rapier2d-compat` was published at **0.21.0** when checked with `npm view` for this plan. M01 must verify the actual installed API and pin an exact version in the lockfile. An initial Rust fork, new renderer, GPU rewrite, fluids solver or server migration is not needed to deliver these interactions.

Water, fire, oil, smoke and apparent vertical tosses can use authored game rules and presentation layered over planar rigid bodies. This follows the user's preference for convincing reactions over precision. Those rules must remain inspectable and composable.

The existing ambient system remains available as an explicit behavior choice. Ambient physics can be enabled for eligible creatures throughout an authored area or selected region; do not secretly substitute decorative motion or impose a new small active-body cap to protect a benchmark. Current user-selected population limits remain visible configuration.

## Source basis

This design is grounded in the current repository and the official [Rapier getting started guide](https://rapier.rs/docs/user_guides/javascript/getting_started_js/), [collider and filtering guide](https://rapier.rs/docs/user_guides/javascript/colliders/), [scene queries](https://rapier.rs/docs/user_guides/javascript/scene_queries/), [rigid-body guide](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/), [joint guide](https://rapier.rs/docs/user_guides/javascript/joints/) and [snapshot API](https://rapier.rs/docs/user_guides/javascript/serialization/). These establish available building blocks. The milestone scope, defaults and gameplay rules are proposed Fern design decisions.
