# Reactive physics milestone status

Planning baseline: `c47cb119d6f57c70ddf79a4a72db59376d68f1e5` on `main`, Fern 2.0. Planning PR [#2](https://github.com/michaelcrosato/gpt61sol2daige/pull/2) is merged at `00ab840c1f1757d554610570145820269be6b2e8`, verified with Git/GitHub on 2026-10-04.

**M01–M03 are verified and merged. This session implements only M04.** M01 PR [#3](https://github.com/michaelcrosato/gpt61sol2daige/pull/3) merged at `59c0c2eab2790769210abc76f5e65cdece094523`; M02 PR [#4](https://github.com/michaelcrosato/gpt61sol2daige/pull/4) merged at `c2ef7e299575e8716a83f616db613d668f0b74b8`. M03 PR [#5](https://github.com/michaelcrosato/gpt61sol2daige/pull/5) is MERGED at `c3ae7201aafaf5719bcf0a235dcd5fcd1255b75a`. Its final implementation `0f79010e1d07cf8b2b5658eb330ef39dd7880bff` is an ancestor of fetched `origin/main`, verified on 2026-10-04. Main CI [37238557384](https://github.com/michaelcrosato/gpt61sol2daige/actions/runs/37238557384) reports SUCCESS for that exact merge. PR #5's release receipt records READY production deployment `dpl_4aFrt4LdJQvo9GUPstUpiDyzZEyX` and all 21 production scenarios, including actual eight-client WebRTC. M03's committed status intentionally preceded its merge; this reconciles that row from current Git/GitHub evidence.

Use a fresh GPT-6.1 Sol / xhigh session with [START.md](START.md) for M05 after M04's release is verified. No client model/context change is claimed here.

| Milestone | State | Handoff and evidence |
| --- | --- | --- |
| Planning | Verified and merged | [Planning handoff](handoffs/M00.md), PR #2 |
| M01 | Verified and merged | [Foundation handoff](handoffs/M01.md), PR #3, [scene evidence](../evidence/physics-m01.json) |
| M02 | Verified and merged | [Regional handoff](handoffs/M02.md), [scene evidence](../evidence/physics-m02.json), [region canvas](../evidence/physics-m02.png) |
| M03 | Verified and merged | [Actors and world](milestones/M03.md), [current handoff](handoffs/M03.md) |
| M04 | Implemented; merge verification required | [Saves and co-op](milestones/M04.md), [handoff](handoffs/M04.md) |
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

The pre-physics baseline was 41 headless and 14 browser scenarios. M01 expanded that to 48 and 17; M02 adds eight headless policy scenarios and two browser policy/control scenarios. M03 passes 67 headless and 21 browser scenarios, including its integrated encounter and actual eight-client WebRTC. Preserve the actual eight-client WebRTC coverage. FPS remains informational, with no hidden adaptive cutbacks.

M04 local gates pass: 74 headless scenarios, 23 browser scenarios, build and all nine route areas. Its final guest policy inspection also passes targeted actual WebRTC coverage. [Handoff](handoffs/M04.md) records versions, framing, rebuild/recovery and QA tuning. Verify its PR release receipt/main ancestry/production before starting M05; this row is deliberately written before commit/merge.
