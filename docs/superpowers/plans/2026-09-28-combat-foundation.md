# Combat Foundation Implementation Plan

> **For agentic workers:** Use test-driven development task by task; the lead integrates shared edits and reviews the whole branch.

**Goal:** Make the starter mallet's input, visible contact, host result, and three threat responses reliable enough for a combat playtest.

**Architecture:** A fixed-step mallet controller owns one attack lifecycle and swing ID. Pure sweep geometry finds reachable surfaces; the encounter system checks obstruction and phase. A single host melee intent validates cadence and resolves an encounter or the guardian once, then returns a concise outcome for feedback.

**Tech Stack:** TypeScript, Three.js, Rapier, Node test runner, Vite.

**Spec:** `docs/superpowers/specs/2026-09-28-combat-foundation-design.md`

## Global Constraints

- Keep port 5235 and its worktree untouched; run no browser/game automation or pointer interaction during the user's play session.
- Keep saves, host authority, rescue, cargo restrictions, economy, rewards, and approved voxel art.
- E picks; a free-hand left-click swings; fruit in hand uses its existing throw/stow/drop path.
- Stop for the user's combat review before the broader scenery conversion.

## Review Focus

- A click in an empty view still animates and never picks a fruit: tested in Task 1.
- A target entering the arc during wind-up can be hit while a target leaving before contact cannot: tested in Task 2.
- A close/slope target is reachable without hitting through a fence: tested in Task 2.
- A closed Snapjaw reports protection while recovery accepts the mouth: tested in Task 2.
- A delayed duplicate client swing cannot apply damage or reward again: tested in Task 3.

---

### Task 1: One mallet lifecycle and clear controls

**Files:** Create `src/tools/MalletSwing.ts` and `tools/harness/mallet-swing.test.mjs`; modify `src/tools/Tools.ts`, `src/tools/ToolInventory.ts`, `src/player/ViewmodelSystem.ts`, `src/ui/UIManager.ts` as needed. Update the control expectation in `tools/harness/scenarios/harvest.mjs`.

**Interface:** `MalletSwing.press(): boolean`, `MalletSwing.step(dt, sample): SwingEvent[]`, `MalletSwing.cancel()`, `MalletSwing.state`, and timing constants. HandPicker supplies current eye/look at contact and emits one `tool:swing` of the same total duration. It exposes a compact debug state to offline tests.

- [ ] Write and run failing Node tests for empty swings, contact after wind-up, one near-end buffer, rapid press rejection, and cancellation by switching/capture/carry/menu.
- [ ] Implement the controller and HandPicker routing; remove free-hand left/right-click pickup fallback while preserving carried-fruit release behavior.
- [ ] Align viewmodel pose's central strike with the active contact interval and update the browser scenario's E-pick expectation without running it.
- [ ] Run focused Node tests, typecheck, and `git diff --check`; commit the coherent lifecycle.

### Task 2: Reachable surface and obstruction

**Files:** Create `src/enemies/MeleeSweep.ts` and `tools/harness/melee-sweep.test.mjs`; modify `src/enemies/EncounterModel.ts`, `src/enemies/EncounterSystem.ts`, and focused encounter tests.

**Interface:** `probeMeleeSweep(origin, direction, enemySurfaces)` returns nearest surface point/distance/kind or null. `EncounterModel.resolveMelee(origin, direction, actorId, blocked)` returns `whoosh | blocked | protected | hit` and authoritative hit details. EncounterSystem provides Rapier's solid ray obstruction check.

- [ ] Write and run failing geometry/model tests for moving target at contact time, surface range boundary, close/inside position, height/slope, lateral sweep limits, fence obstruction, closed/open Snapjaw, and one target per swing.
- [ ] Implement swept contact with a small arc and per-enemy body bounds; keep Air Cannon and existing projectile tests intact.
- [ ] Run focused and all offline Node tests, typecheck, `git diff --check`; commit the contact resolution.

### Task 3: Host identity and response

**Files:** Create `src/net/MeleeIntentGuard.ts` and `tools/harness/melee-intent.test.mjs`; modify `src/net/MultiplayerAuthority.ts`, `src/enemies/EncounterSystem.ts`, and `src/boss/KingVine.ts` only where necessary.

**Interface:** One `melee` intent carries `swingId`, origin, and direction. `MeleeIntentGuard.accept(peerId, swingId, time, active)` rejects duplicate/stale/cadence/state. `MultiplayerAuthority.tryMelee(...)` handles solo or client submission; the host resolves encounter first, then guardian if no encounter contact, and sends the result to the owning peer.

- [ ] Write and run failing guard tests for duplicate, stale, rapid, invalid state, invalid origin, and peer reset/migration cases.
- [ ] Implement the single host route and result packet; block the legacy remote melee hit intent from bypassing it.
- [ ] Add offline integration coverage proving one swing cannot pay twice or hit two targets; run tests/typecheck/build and commit.

### Task 4: Distinct feedback and threat tells

**Files:** Modify `src/audio/AudioManager.ts`, `src/player/ViewmodelSystem.ts`, `src/enemies/EncounterVisuals.ts`, and small UI/game event types as needed. Add focused offline tests for outcome mapping and existing encounter timing.

- [ ] Write and run failing behavior tests for whoosh, obstruction, protection, and damaging result cues; retain Air Cannon deflection coverage.
- [ ] Implement concise feedback, Mimic stagger clarity, Snapjaw closed/open cue, and Spitter firing/recovery cue using existing art and rules.
- [ ] Run offline tests, typecheck, build and static diff review; commit.

### Task 5: Integration and handoff

**Files:** Update `tools/harness/scenarios/action-combat.mjs` and related scenario expectations; write short playtest instructions in the final handoff.

- [ ] Inspect every affected browser scenario for old instant-hit/LMB-pick assumptions and update source expectations.
- [ ] Run all offline Node tests and `npm run build`; explicitly record browser scenarios, co-op, feel, and hardware checks as pending because the live play session must not be controlled.
- [ ] Review branch diff, commit/push all coherent changes, and provide a separate launch path without touching the active preview. Stop for the user's combat review before scenery work.
