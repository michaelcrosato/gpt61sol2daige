# Reactive physics architecture

This document specifies the implementation target. Source paths listed as new modules are proposed boundaries, not claims that files already exist. Keep the design understandable to a fresh implementation session and adjust a boundary when actual code warrants it; record consequential deviations in [DECISIONS.md](DECISIONS.md).

M01 implements `src/physics/{bootstrap,runtime,types}.ts`, the optional `Simulation.playground` owner and `src/app/physics-ui.ts`. M02 adds `policies.ts`, applied and queued policy checkpoints, live body transitions and a lab contact traveler. Confirmed contracts are documented in [the engine architecture](../ARCHITECTURE.md#m02-regional-policies), [implemented policy semantics](POLICIES.md#m02-delivered-contract) and [M02 handoff](handoffs/M02.md). Sections below remain the target for subsequent actor, material and networking milestones. The lab traveler is a prop-blocking test body, not the M03 adventure motor.

## One owner of physical motion

Keep a Rapier world associated with the authoritative simulation's current land. Use zero global gravity for the top-down plane. Regional wind, attraction and similar forces are explicit inputs. Convert between Fern world units and physics units through one adapter; start with 16 world units per physics unit and tune contact tolerances from the playground. The renderer continues to receive Fern coordinates. No custom high-precision build or cross-device floating-point project is required.

Rapier owns the pose and velocity of every body assigned to it. AI and controls produce movement intent, impulses and state transitions; they must not overwrite the solved pose later in the same tick. Position changes for teleports and restores are explicit commands, not competing integrations. Once an actor migrates, remove its old `moveBody`/`collideCircles` integration and contacts. Existing helpers may remain for explicit non-Rapier participants and legacy tests.

The initial character design is a dynamic circular/capsule body with rotation locked, controlled by a velocity motor. Separate desired movement from external knockback so the next AI update cannot cancel an impact. Tunable acceleration, damping, maximum motor force and stagger recovery preserve responsive movement. Sprite facing remains gameplay state. If the playground proves a kinematic sweep controller materially better, document that decision before replacing the motor; do not repeatedly alternate approaches. Generic platformer slope/stair defaults are not appropriate to the top-down plane without deliberate configuration.

Dash briefly changes actor-to-actor interaction while retaining obstacle handling and the existing invulnerability rules. Large enemies, bosses, invulnerable NPCs and fragile props use explicit interaction groups. Navigation gains obstacle-aware steering and a stuck-recovery behavior so physical debris does not permanently strand an encounter.

## Initialization and lifetime

Provide an explicit asynchronous `initializePhysics()` entry barrier shared by browser, Node tools and tests. After it resolves, fixed stepping and normal command execution remain synchronous. Do not hide WASM initialization inside every tick or make every agent command asynchronous. Update all direct `new Simulation`, `Simulation.restore` and replay entry paths, including `tools/agent.ts`, test bootstrap and browser restore.

A guest replica consumes host state without owning an independently simulated authoritative physics world. Snapshot decoding must not allocate a new Rapier world on every packet. Host/solo reset, restore, land changes, disconnect and abandoned initialization must free the superseded WASM world, event queue and joint/body handles. Add explicit disposal and test repeated lifecycle transitions.

Introduce the backend behind a temporary development selector in M01. It is a rollout tool, not a new performance preset. M03 makes Rapier the owner of supported active actors; M12 makes the complete reactive experience the authored default. Until M04 verifies replication, the new playground remains solo-only and ordinary co-op stays on its previously supported path. Do not present unsynchronized interactive props in a public room.

## Fixed tick order

1. Apply validated commands, pending region edits, spawns, removals and teleports at a tick boundary. Resolve feature policy before emitting new reactions.
2. Sample intent for players and AI; calculate ability starts, actor state, field forces and moving mechanism targets.
3. Query/sweep attacks and projectiles according to their definitions; schedule impulses and damage with stable event identities. Preserve attacks that intentionally pierce or phase.
4. Apply motor and external forces, then advance the Rapier world with the game's fixed timestep.
5. Collect contacts and force events. Convert them into material impacts, damage, breakage and joint events; deduplicate sustained contacts and repeated reports.
6. Resolve reaction rules, rewards and future commands. Structural destruction changes the world through the next command boundary rather than modifying colliders while iterating contacts.
7. Copy solved poses and velocities into the game observation/render state, publish lifecycle events and retain previous transforms for interpolation.

The exact ordering must be covered by small reproducible scenes. Physical accuracy is secondary to consistent gameplay causality. A single attack may have an authored hit and an environmental consequence; it must not award the same hit, destruction reward or kill twice.

## Shared representations

Use stable game identifiers independent of Rapier handles. At minimum define:

- `PhysicsBlueprint`: body/collider shapes, interaction groups, material, motor/anchor settings, break stages and optional joint sockets. Supports composition without writing a new solver.
- `PhysicalEntityState`: stable ID, land/area identity, blueprint revision, pose, velocity, durability, status, owner/instigator, region membership, destroyed state and assembly membership.
- `PhysicsAssembly`: one assembly ID, root/anchor, member IDs, joint definitions, broken-joint state and region policy anchor.
- `PhysicsCommand`: validated spawn, remove, impulse, motor intent, teleport, configure and reset operations. Commands have an issuing tick and author when relevant.
- `WorldReaction`: unique event ID, cause ID, source/target IDs, material response, hit position, strength, attribution and any delayed follow-up.
- `PhysicsPolicy`: authored defaults plus scoped overrides; resolved values carry provenance for inspection.

Gameplay entities keep their existing hero/enemy/loot IDs. References point into a physical registry rather than copying independent state in three places. Rendering maps physical transforms to existing sprites or articulated parts; it never applies forces itself.

## Materials and reactions

Start with wood, stone, metal, glass, cloth, vegetation, ceramic and volatile containers. Define mass/density, friction, bounce, durability, break response, flammability, conductivity and response tags in one registry. Artistic impulse multipliers and believable exaggeration are first-class parameters.

A destruction recipe specifies replacement pieces, their collider shapes, inherited momentum, dust/sound response and any one-time reward. Prefer authored or seeded fracture pieces for readable results. Rapier supplies collision and joint simulation; it does not author fractured art or automatically implement a burning barrel.

Reaction rules are explicit transformations such as `hot + dry wood -> burning`, `water + burning -> extinguished`, and `shock + wet metal -> conductive discharge`. Track energy/strength, source ownership and visited targets for each causal chain. Rules must terminate naturally: no entity re-explodes under the same cause, and stored contact overlap is not a fresh impact every frame. Prevent logical runaway loops without using hidden FPS-based feature reduction.

Base combat damage, skill unlocks and the original mechanic benefits remain gameplay-owned. Turning environmental reactions off does not turn off the player's sword, Cinderwake's established combat benefit or the exit portal. See [POLICIES.md](POLICIES.md) for the distinction.

## Terrain and persistence

Build physical obstacles from terrain/decoration recipes near occupied or explicitly loaded regions, independently of camera visibility. A collider's stable key includes land identity and tile/object identity. Region unloading removes runtime handles but retains meaningful mutations: broken tree, moved reward container, destroyed wall or claimed loot. Cosmetic transients may have an authored lifetime; expiry must be declared rather than silently tied to performance.

Preserve shared physical state across travel within the same land. At an outward portal, archive mutations for the old land and create the next land's body registry. Same-land recall/re-entry restores meaningful alterations without duplicating rewards. Revisiting older lands is not a new required travel feature, but explicitly restored saves and debug visits must not accidentally resurrect claimed objects.

Protect essential spawn points, townsfolk service access and the required outward route. Protection is semantic, not a blanket refusal to let nearby scenery react. Movable scenery may inconvenience navigation; required progress always has a reachable alternate route, resettable obstruction or existing travel action.

Save a versioned game envelope containing semantic physical state, body-ID mappings, regional overrides, assembly states, reaction queues and a Rapier snapshot where supported. Record the backend package version. A snapshot is the fast continuation path; semantic state is the inspectable source for validation and an explicit rebuild when a physics snapshot is incompatible. Never silently discard a player's build to recover a physics scene.

Existing version-1 saves migrate by retaining progression/terrain and assigning fresh default physical state to content that did not exist. Physics continuation can be validated by positions/velocities within a declared tolerance plus exact gameplay facts. Same-build deterministic replay remains useful where attainable; do not make numerical identity between hardware/browser families a delivery condition. Old replays identify their old engine revision rather than being claimed compatible.

## Multiplayer

Retain the host-authoritative PeerJS architecture. Only the host resolves physics and reaction causality. Guests send movement/combat and authorized interaction requests; the host validates identity, target existence, distance where appropriate and room authority. Shared policy changes are host-only. Cosmetic debug overlays can be local.

Replicate stable IDs, transforms including angle, body state, spawn/destroy events, assemblies, statuses and policy revisions. Guests interpolate dynamic transforms and snap across portal/reset revisions. Spawn/remove and irreversible changes use reliable lifecycle delivery; ordinary motion can use the existing periodic snapshot cadence. Late join must receive a complete consistent baseline before accepting interaction.

Current protocol 3 puts adventure data into a 512,000-byte JSON header. Do not simply append an arbitrarily large physical world to that header. M04 introduces a versioned physical-state section and chunked full-state transfer, validates total lengths/counts before allocation, and handles missing/late chunks atomically. Established compact ambient records may remain. Protocol changes require a clear client refresh message.

Server simulation cannot depend on a guest's draw radius. Interest filtering may control transmission/presentation but must include objects currently relevant to the guest's interactions and preserve world authority. If state grows beyond a declared transfer bound, report the condition and provide a deliberate loading path; do not silently omit collidable objects. Disconnect preserves the local hero and usable received scene for solo continuation, rekeying ownership as needed.

## Source map

| Existing module | Planned responsibility |
| --- | --- |
| `src/engine/simulation.ts` | Initialize/dispose the adapter, drive tick phases, expose complete physical state |
| `src/engine/physics.ts` | Retain reusable math/helpers; retire duplicate actor integration when migrated |
| `src/engine/world.ts` | Collider recipes, stable terrain object IDs and mutation overlays |
| `src/game/adventure.ts` | Movement intent, attack/reaction hooks, damage/reward attribution, travel lifecycle |
| `src/game/content.ts`, `types.ts`, `validation.ts` | Area physics profiles, placements, policies and state validation |
| `src/game/loot.ts`, `skills.ts` | Physical properties and modifiers on existing abilities/items |
| `src/render/rigs.ts`, `combat.ts`, `renderer.ts` | Body/assembly transforms, physical props, rig poses and feedback |
| `src/net/protocol.ts`, `coop.ts` | Host authority, physical replication, late join and disconnect |
| `src/app/save-store.ts`, `src/main.ts` | Save migration, boot readiness, controls and adapter lifetime |
| `src/app/adventure-ui.ts`, `settings-ui.ts` | Physics controls, effective scope and capability state |
| `src/engine/agent.ts`, `tools/agent.ts` | Discoverable physics commands, observations, stepping and replay |

Proposed additions are `src/physics/{runtime,types,policies,blueprints,materials,reactions,terrain,serialization}.ts`, a focused physics UI module and `tools/physics.ts`. Extract coherently from the already-large `adventure.ts`; avoid building a general-purpose ECS or plugin platform merely to support this plan.

## Verification philosophy

Keep exact assertions for IDs, rewards, policy values, generated recipes and authorization. Use meaningful tolerances for physical trajectories. Assert outcome and causality: a struck crate moves away, a broken joint disconnects, an extinguished barrel does not explode, a fallen tree stays fallen after load, and a disabled region suppresses its configured reaction.

Retain the actual eight-client browser test. Expand it with late-join physical state and representative interactions. Extend the headless controller only where needed to navigate the new world, not to bypass combat or manufacture a clear. An explicit recorded test tuning preset remains acceptable; label it.

Keep telemetry and existing benchmark commands available to the user. Remove or relocate the existing browser FPS pass/fail assertion when implementation starts; do not respond to a slow measurement by cutting planned reactions. No new performance test gate is part of this work.
