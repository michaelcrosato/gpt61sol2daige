# Reactive physics milestone status

Planning baseline: `c47cb119d6f57c70ddf79a4a72db59376d68f1e5` on `main`, Fern 2.0. Planning PR [#2](https://github.com/michaelcrosato/gpt61sol2daige/pull/2) is merged at `00ab840c1f1757d554610570145820269be6b2e8`, verified with Git/GitHub on 2026-10-04.

**M01 and M02 are verified and merged. M03 is implemented; merge verification is required.** M01 PR [#3](https://github.com/michaelcrosato/gpt61sol2daige/pull/3) merged on 2026-10-04 at `59c0c2eab2790769210abc76f5e65cdece094523`; implementation `8ec9695e98670914f4bb0c7decb042517ac0eeff` is an ancestor of fetched `origin/main`, verified this session. M02 PR [#4](https://github.com/michaelcrosato/gpt61sol2daige/pull/4) merged at `c2ef7e299575e8716a83f616db613d668f0b74b8`; implementation `6c1059f0c546b56503d34d8f31a308e962e92061` is an ancestor of fetched `origin/main`, verified 2026-10-04. Its release receipt records green PR/main CI and READY production deployment with all 19 production browser scenarios. This session implements only M03. Use a fresh GPT-6.1 Sol / xhigh session with [START.md](START.md).

| Milestone | State | Handoff and evidence |
| --- | --- | --- |
| Planning | Verified and merged | [Planning handoff](handoffs/M00.md), PR #2 |
| M01 | Verified and merged | [Foundation handoff](handoffs/M01.md), PR #3, [scene evidence](../evidence/physics-m01.json) |
| M02 | Verified and merged | [Regional handoff](handoffs/M02.md), [scene evidence](../evidence/physics-m02.json), [region canvas](../evidence/physics-m02.png) |
| M03 | Implemented; merge verification required | [Actors and world](milestones/M03.md), [current handoff](handoffs/M03.md) |
| M04 | Not started | [Saves and co-op](milestones/M04.md) |
| M05 | Not started | [Materials and destruction](milestones/M05.md) |
| M06 | Not started | [Combat and loot](milestones/M06.md) |
| M07 | Not started | [Jointed mechanisms](milestones/M07.md) |
| M08 | Not started | [Material reactions and fields](milestones/M08.md) |
| M09 | Not started | [Physical rigs](milestones/M09.md) |
| M10 | Not started | [Authored world](milestones/M10.md) |
| M11 | Not started | [Procedural world](milestones/M11.md) |
| M12 | Not started | [Release](milestones/M12.md) |

## State conventions

Use `not started`, `in progress`, `implemented; merge verification required`, or `verified and merged`. Never advance a milestone solely because its code exists or a UI switch is present. Record remaining acceptance gaps when incomplete. A fresh session upgrades the previous row to `verified and merged` only after checking actual ancestry, PR state and required evidence; that status update can ride with its own milestone change.

The pre-physics baseline was 41 headless and 14 browser scenarios. M01 expanded that to 48 and 17; M02 adds eight headless policy scenarios and two browser policy/control scenarios. M03 passes 65 headless and 21 browser scenarios, including its integrated encounter and actual eight-client WebRTC. Preserve the actual eight-client WebRTC coverage. FPS remains informational, with no hidden adaptive cutbacks.
