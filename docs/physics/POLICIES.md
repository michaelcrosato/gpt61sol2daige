# Regional physics policies

The user must be able to choose what reacts, where it reacts and how strongly it reacts. Feature policies affect authoritative behavior. Rendering overlays are separate local preferences.

## Scope and precedence

Resolve values in this order: engine defaults, land profile, area profile, containing named region, then applicable live debug overrides. A more specific live override wins over a broader live override; the session-wide master `worldReactions = false` is an absolute off switch. Within one specificity, use declared priority and stable region ID to break ties. Show the effective value and the source that supplied it.

Support circle, rectangle and authored polygon regions. Membership normally uses the body's center at the start of a tick, with a small configurable boundary margin to avoid rapid toggling on an edge. Large articulated assemblies use their declared root/anchor; one region policy controls the assembly's optional simulation. This avoids leaving half a joint chain frozen across a boundary.

Live edits are queued and applied atomically at the next tick boundary. A command includes scope, ID and expected policy revision. Reject stale or invalid edits without partially changing a scene. During pause, allow a deliberate apply transaction so the user can configure and inspect before resuming. Do not require a restart.

New features register their controls as they become available. M02 establishes the policy system; subsequent milestones add working capabilities. Do not ship switches that claim a reaction is enabled when its implementation does not yet exist.

## Feature controls

| Feature | On behavior | Off behavior | First delivery |
| --- | --- | --- | --- |
| World reactions | Enables optional physical/reactive capabilities according to resolved settings | Suppresses all optional reactions; core movement, essential collision and base combat continue | M02 |
| Dynamic props | Loose objects translate/rotate and respond to contact | Freeze existing props at their current pose as static obstacles where appropriate; discard stored motion | M02 |
| Prop blocking | Optional scenery generates physical actor contacts | Optional scenery does not block actors; weapon queries and material state remain available, and required terrain boundaries remain solid | M02 |
| Crowd contacts | Players and monsters physically separate and push according to their roles | Actors may pass through one another while attacks, targeting and core world collision remain active | M03 |
| Destruction | Material durability can progress to break stages | Preserve current damage/broken state; prevent further environmental destruction | M05 |
| Impact damage | Fast physical impacts can damage permitted targets | Contacts still move objects when enabled, but add no physical collision damage | M06 |
| Projectile world collision | Eligible projectiles strike/ricochet/pierce scenery according to their definition | Projectiles retain base combat target behavior and ignore optional scenery contacts | M06 |
| Environmental forces | Wind, suction, vortex and radial pressure affect permitted bodies | Stop adding field forces; retain existing momentum unless dynamic simulation is also off | M06 and M08 |
| Jointed mechanisms | Hinges, tethers, springs and motors can move | Freeze the assembly in its current valid configuration; retain broken-joint state | M07 |
| Joint breakage | Joint stress or authored damage can break a connection | Preserve existing breaks; prevent new automatic stress breaks | M07 |
| Material reactions | Fire, wetness, oil and electricity evolve and interact | Stop optional material evolution and new material damage; preserve inspectable status and pause its remaining timers | M08 |
| Chain reactions | A material or mechanism event may trigger further eligible events | Allow the initial direct effect, suppress secondary propagation; mark queued propagation ineligible while off | M08 |
| Physical ragdolls | Death transitions to articulated bodies responding to the scene | Use the ordinary authored death pose; an existing ragdoll settles into a non-reactive corpse without resurrecting its actor | M09 |
| Physical loot | Loot has bounce/slide response before collection | Settle loot at a reachable nearby position; keep magnet/pickup and ownership functional | M06 |
| Foliage response | Grass, cloth and flexible plants bend/react to nearby forces | Return toward an authored resting pose; collider state follows the object's actual role | M05 and M09 |
| Ambient creature physics | Eligible ambient creatures participate as physical actors, with optional steering/contact response | Hand each creature back to its ambient behavior at its current position; remove its old physical contacts | M03 |
| Swept collision checks | Apply appropriate CCD/shape-sweep handling to configured objects | Use discrete overlap handling for those optional checks, while retaining essential character obstacle handling | M03 and M06 |

M01 includes a minimal pushable prop to exercise the backend. M02's initial demonstration uses world reactions and dynamic props. The remaining controls become active with their listed systems.

## Transition rules

- Disabling a feature is not a reset. Never repair a tree, refund an attack, recreate loot, restore a broken joint or respawn a dead actor as a side effect.
- Re-enabling starts from the current scene. Frozen dynamic props restart with zero velocity. Revalidate overlaps before waking a body or assembly; use a small separation correction or a visible reset option if placement is invalid.
- Switching off an optional feature cancels or suspends its future work according to the table. Turning it back on must not unleash a backlog of impacts or ignitions from time spent disabled.
- Base combat statuses remain separate from optional environmental material state. For example, the existing Cinderwake ability benefit must still function when environmental fire propagation is off.
- Material breakage checks the target's resolved policy; a projectile crossing a region boundary keeps its identity and authored attack damage. Regional toggles never erase the player's base hit simply because environmental impact damage is off.
- An optional reaction must be permitted at its source and accepted at its target. A burning prop entering a quiet region cannot spread fire into protected town objects. Essential service roles retain their protection regardless of nearby debris.
- Assemblies transfer as a unit where possible. An anchored chain cannot enter a portal until its anchor is released; an unanchored assembly can be translated together with its joints and motion. Portal cooldown prevents immediate re-entry loops.
- On/off state, overrides, remaining suspended timers and policy revision survive save/load and late join. A guest cannot diverge shared physics through a local quality setting.

## Presets

| Preset | Purpose | Behavior |
| --- | --- | --- |
| Quiet | Compare against a restrained world | Optional reactions off; movement, combat and interaction remain usable |
| Reactive | Default authored adventure | Physical props, material reactions, destruction and other implemented systems enabled; protected roles remain protected |
| Wild | Exaggerated interaction playground | Same feature set with stronger impulses, easier breakage and longer-lived debris; no automatic FPS-based downgrades |
| Sanctuary | Town service area | Harmless movable props, cloth/foliage and gentle reactions; no environmental damage to essential NPCs or service access |
| Custom | User-authored behavior | Independent feature values and numeric controls at the selected scope |

These are behavior presets, not graphics quality settings. A land may contain Reactive combat areas, a Sanctuary town and a Quiet test region simultaneously.

## Numeric controls

Expose impact strength, knockback recovery, material durability, joint break threshold, field strength, prop friction/bounce, debris persistence and ragdoll response. Advanced debug controls may expose solver iterations and CCD options once their actual API is verified. Values must be finite and valid for their physical meaning; give zero and off explicit meanings. Defaults should show the feature clearly, with no adaptive performance manager.

Show scope selection, named region bounds, inherited versus overridden values, reset-this-scope, reset-to-authored, preset preview and a short explanation of what freezing changes. The inspector can select a body and display its effective policy, material, last reaction cause and assembly. Wire the same operations into the agent API. Regions are authored with recipes or direct lab commands; a new full scene editor is not required.

## Required switch demonstrations

For every implemented feature: observe its real effect, disable it, repeat the cause and verify suppression, enable it again and verify recovery. Also cross a region boundary in both directions, apply a broader override, save/restore the off state, and observe it from an actual guest. Test the dependency combinations that change meaning, especially master-off with feature-on, joints-off with breakage-on, destruction-off with impact damage on, and reactions-off with base combat still active. Exhaustively testing every possible boolean combination is unnecessary.
