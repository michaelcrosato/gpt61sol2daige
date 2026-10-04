# Milestone sessions and handoffs

Run one milestone in one fresh chat. Persistent repository files and verified Git history carry the work forward; the old conversation is not required input for the next implementer.

## Model selection and context

The requested planning role is GPT-6 Astra with `max` reasoning. The requested implementation model is **GPT-6.1 Sol**, canonical ID **`gpt-6.1-sol`**, with **Extra high (`xhigh`)** reasoning. These are workflow requests, not a claim that this planning conversation changed its own model. Verify the selected model and effort in the actual client before starting implementation. Do not silently substitute a model or launch another agent to bypass that choice.

The installed CLI exposes `--model`, `--config` and `--cd`. This starts a new implementation session without resuming the old transcript:

```bash
codex --cd /home/micha/dev/gpt61sol2daige \
  --model gpt-6.1-sol \
  -c 'model_reasoning_effort="xhigh"' \
  'Read AGENTS.md and docs/physics/START.md. Implement only the next eligible milestone in docs/physics/STATUS.md. Follow its acceptance and handoff requirements, then stop before the next milestone.'
```

This command intentionally inherits the user's existing tool permissions. It does not change global configuration, supply API credentials or disable safeguards.

In the CLI, `/new` starts a fresh chat; `/clear` starts a fresh chat and clears the terminal view. In the app, use its new-chat control and select the implementation model/effort. `/compact` summarizes the current conversation and can help during a milestone, but it is not the fresh-chat boundary requested here. Use `/status` to inspect the client-reported context. [Official developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

**Do not assume or force an 828K window.** The user requested that working size, but this agent cannot reserve it or clear its own active transcript. At planning time, the public API catalog listed a 1.05M context for the requested models while the local Codex model cache advertised 272,000; neither establishes this chat's effective remaining capacity. Check the active client. The milestone workflow works independently of a particular limit and resets at completion rather than waiting to exhaust context. [Official model catalog](https://developers.openai.com/api/docs/models).

## Beginning a milestone

1. Read `AGENTS.md`, `docs/physics/README.md`, `STATUS.md`, this procedure, the one milestone card and the preceding handoff. Read the card's named contract sections and source files next.
2. Inspect `git status`, the current branch and `origin/main`. Preserve unrelated user changes. Fetch updates and verify that the previous milestone's commit is included in `main` and its PR is merged. Resolve a stale status entry from actual Git/GitHub evidence rather than assuming completion.
3. Confirm no earlier acceptance gap blocks the chosen card. State the intended outcome briefly to the user. Do not restart architectural selection or reread every past artifact.
4. Use a milestone branch/worktree. Implement the card's complete vertical slice; add its needed state, rendering, controls, save/network behavior and meaningful tests together.

## Staying focused

Treat the milestone's acceptance conditions as the working boundary, not a reason to reduce quality. A new idea that is not needed to finish the milestone goes into a named future card or a short decision note. Avoid speculative rewrites of the renderer, transport or entire entity model.

If an approach fails twice for the same reason, state the evidence and change the hypothesis before another attempt. Do not keep restarting from scratch or weakening a check until it passes. If a milestone genuinely exceeds a safe context span, record a coherent partial checkpoint and explicit remaining acceptance items, then continue that same milestone in a fresh chat. Do not mark it complete or move to the next card.

Maintain short, meaningful progress updates. Do not dump full state, generated buffers, node_modules, all previous plans or secrets into the conversation. Use bounded observations and reproducible scene files.

## Finishing a milestone

1. Run its acceptance scenes and appropriate repository checks. `npm run check` and `npm run build` remain required. Run `npm run test:e2e` for physics, renderer, control, save or networking changes. The new reactivity work has no FPS pass/fail gate; M01 removes the old browser FPS assertion while preserving functional coverage.
2. Inspect the visible result and capture the relevant evidence. Record observed limitations honestly. A successful build without a playable demonstration does not close a feature milestone.
3. Update architecture/agent documentation where contracts changed. Update `STATUS.md`, the decision record if needed, and `handoffs/Mxx.md` using the template below. Prepare these before the milestone commit.
4. Prefer one complete milestone commit. Push immediately after every commit. Create a concrete PR, pass applicable CI, and merge it. Any repair commits must also be pushed and included in the merged milestone before finishing. Do not accumulate local WIP commits or leave an unmerged milestone for another model.
5. Verify `main`, production deployment when affected, and the appropriate live flow. Put the merge/check/deployment receipt in the final message and the PR's release notes. Do not create an endless series of commits merely to record a commit's own hash.
6. Stop before implementing the next milestone. Tell the user the next card and exact handoff path. Start a fresh chat using `START.md`; do not use `resume` or `fork` to claim a cleared context.

The next session can derive a handoff's containing commit with `git log -1 --format=%H -- docs/physics/handoffs/Mxx.md`, find its PR through GitHub and check ancestry against `origin/main`. Thus a pre-commit handoff may honestly say `implemented; merge verification required` without needing to predict its eventual SHA. `STATUS.md` stores the last evidence actually known; the next session reconciles it before advancing. Missing merge evidence never becomes an assumed pass.

## Handoff template

Keep each handoff concise enough to read at the beginning of a new session, normally under 1,500 words. Link larger evidence instead of embedding it.

```markdown
# Mxx handoff

## Delivered behavior
What the player or developer can now do, with the milestone acceptance items covered.

## Checkpoint
Base commit, branch, scope, and implementation state at the time this file was written.
Derive the containing commit from git; verify its merged PR before starting the next card.

## Contracts and source
Files changed; initialization/ownership rules; save/protocol versions; commands added.
Only the decisions the next milestone needs.

## Evidence
Exact commands and results; reproducible seeds/scenes; screenshot or video paths;
multiplayer checks; known test tuning. Do not claim CI/production checks that have not run.

## Remaining work
Real gaps or none. If incomplete, list the unmet acceptance items and keep this milestone active.

## Next session
Next eligible milestone, small read list, concrete first steps, decisions not to reopen.
```

The durable handoff plus Git/PR evidence is the continuity mechanism. Automatic compaction is useful during work, but it does not replace the requested milestone reset.
