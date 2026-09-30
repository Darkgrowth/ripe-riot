# Sunpatch Chaos Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary Sunpatch play visibly shift from static damage exchanges to recoverable physical chaos in the orchard and Snapjaw clearing.

**Architecture:** The host emits numbered, bounded impact/launch decisions; FruitSystem and PlayerController apply them, while encounter snapshots carry durable phase. Orchard collisions use actual plant/obstacle physics hits. IslandDirector owns local agitation and chooses existing telegraphed events. Clients render shared state and can request only validated rescues or net catches.

**Tech Stack:** TypeScript, Three.js, Rapier, Vite, Node test runner, Playwright harness, BroadcastChannel transport.

**Spec:** `docs/superpowers/specs/2026-09-30-sunpatch-chaos-combat-design.md`

## Global Constraints

- Preserve the bright rounded voxel direction, current mallet timing, starter tools, $110 Air Cannon, optional ropes, banked money, safe dock, saved settlement, and existing enemy roster.
- Keep host authority over encounter phases, fruit state, player impacts, and rewards. One impact can affect a given object only once; stale packets cannot replay a launch.
- Existing saves without new fields load with calm defaults. Defeated enemies and consumed authored prizes do not regenerate or repay.
- Use an isolated worktree and port. Do not focus, navigate, resize, or capture the user's live game or cursor.
- Validate the shipped gameplay camera at the recorded ultrawide aspect; numerical tests alone do not establish visual success.

## Review Focus

1. A remote victim receives exactly one Mimic or Snapjaw impulse despite duplicate, late, or old-host packets; Task 1 tests host epoch and sequence rejection, and Task 3 tests capture snapshot ordering.
2. A charge hitting a fence cannot detach fruit as though it hit a tree; Task 2 tests collision owner classification.
3. A site activated before save and restored afterward cannot spawn another Puff Melon or repeat rewards; Task 2 tests attached, launched and consumed Puff states plus old-save migration.
4. Escape, rescue, defeat, and fling cannot all release the same victim; Task 3 tests mutually exclusive transitions and host promotion.
5. A net swing by an unequipped or distant peer cannot cancel another player's flight; Task 4 tests identity, phase, range, and tool checks.

---

### Task 1: Shared bounded player and fruit impacts

**Files:**
- Create: `src/enemies/ChaosImpact.ts` (pure impact identity, sweep and bounded impulse helpers)
- Modify: `src/enemies/EncounterModel.ts`, `src/enemies/EncounterSystem.ts`, `src/fruit/FruitSystem.ts`, `src/player/PlayerController.ts`, `src/net/MultiplayerAuthority.ts`, `src/net/Transport.ts`, `src/main.ts`
- Test: `tools/harness/chaos-impact.test.mjs`, `tools/harness/chaos-network.test.mjs`

**Interfaces:**
- Produce `ChaosImpact` with host identity/epoch, monotonic `id`, `kind`, charge segment, point, forward vector and bounded strength; `FruitSystem.applyChaosImpact(impact)` returns affected fruit IDs. Its geometric sweep sees attached fruit regardless of collider activation; detach occurs before impulse.
- Produce `MultiplayerAuthority.launchPeer(peer, impact)` and local `PlayerController.applyChaosLaunch(impact)` with once-only sequence handling. The caller determines damage separately.

- [ ] Write tests for finite/clamped vectors, swept attached/free fruit selection with the host far away, one detach/impulse per fruit, and duplicate/late/old-host launch rejection; run them red with `node --test tools/harness/chaos-impact.test.mjs tools/harness/chaos-network.test.mjs`.
- [ ] Implement the pure rules, authoritative fruit impulse path and host-to-victim launch packet. Keep the packet one-shot and scoped to a live connected peer; host promotion changes the identity/epoch so delayed old-host events cannot be accepted.
- [ ] Run the focused tests green, then `npm run build` and affected action/authority tests. Commit this independently usable physics/transport layer.

### Task 2: Orchard Mimic wrecking-ball encounter

**Files:**
- Modify: `src/fruit/FruitSystem.ts`, `src/enemies/EncounterModel.ts`, `src/enemies/EncounterSystem.ts`, `src/enemies/EncounterVisuals.ts`, `src/enemies/HarvestSites.ts`
- Test: `tools/harness/mimic-chaos.test.mjs`, `tools/harness/harvest-sites.test.mjs`, `tools/harness/expedition-encounters.test.mjs`

**Interfaces:**
- Extend the Mimic collision query to choose the nearest of its physics probes and report a physical collision point and plant ID only when the collider owner is an ordinary fruit tree. The model produces a numbered charge impact event; EncounterSystem applies it through Task 1's shared impact API. A mallet-biased pending heading is replicated for host promotion.
- Append one authored orchard Puff Melon plant after current generated IDs. Register its fruit IDs with the compatible HarvestSites release/consume ledger while keeping its plant out of the Mimic harvest gate and its prompt distinct from the overloaded watermelon crop. The fruit is real and can be detached/launched by a swept charge. Preserve the existing watermelon prize IDs.

- [ ] Write failing tests: first/second deliberate harvest action still gate activation; a remote-host charge path can hit an attached Puff Melon without its collider; a tree impact shakes/detaches a bounded set of ordinary fruit and enters stagger; rail/rock/return-home contact does not; an impact does not double-release a prize; reload preserves attached/launched/sold Puff states, cleared sites and existing IDs.
- [ ] Implement physical sweep and orchard placement. Damage plus launch stays recoverable, the shell stops short of the camera, and a mallet recovery hit biases the next committed charge without increasing health.
- [ ] Run focused tests, `mimic-fight.mjs`, the saved-prize regressions, and a normal-gameplay camera capture. Commit the encounter and its visual proof.

### Task 3: Snapjaw Eat & Fling state and safe landing

**Files:**
- Create: `src/player/SafeLanding.ts` (shared dry/slope/capsule landing query extracted from ragdoll recovery)
- Modify: `src/enemies/EncounterModel.ts`, `src/enemies/EncounterSystem.ts`, `src/enemies/EncounterVisuals.ts`, `src/player/PlayerRagdoll.ts`, `src/player/PlayerController.ts`, `src/player/PlayerCamera.ts`, `src/interaction/InteractionSystem.ts`, `src/net/MultiplayerAuthority.ts`, `src/ui/UIManager.ts`, `src/ui/EncounterAdvice.ts`
- Test: `tools/harness/snapjaw-fling.test.mjs`, `tools/harness/safe-landing.test.mjs`

**Interfaces:**
- Add capture aim and fling sequence to `EncounterState`. `EncounterModel.step()` emits exactly one host `fling` event unless escape, rescue, defeat or a lethal bite won first; EncounterSystem resolves a safe target and Task 1 launches the victim. Nonlethal mallet/Air Cannon contact during the open-jaw hold releases the victim.
- `SafeLanding.findSafeLanding(...)` returns a bounded dry target or a known safe fallback. Player launch clears captured state before applying velocity; control and ragdoll windows have a finite maximum.

- [ ] Write failing tests for solo safe target, teammate-directed aim, capture tell, escape/rescue/defeat/lethal-bite exclusivity, nonlethal jaw interruption, one fling, finite launch, dry clear landing, launch-versus-landing ragdoll thresholds and stale captured snapshot ordering.
- [ ] Implement the state transition, safe-ground reuse, local/remote presentation cues and recovery. The remote avatar attaches visibly to the jaw during the hold and transitions to a flying pose; the victim gets short recapture immunity. Keep bait, protected jaw, low health, and once-only payout behavior.
- [ ] Run focused tests, existing capture/action tests and build. Commit the solo and host-owned throw before adding the net catch.

### Task 4: Co-op rescue and timed Catch Net interception

**Files:**
- Modify: `src/tools/Tools.ts`, `src/tools/ToolInventory.ts`, `src/enemies/EncounterSystem.ts`, `src/net/MultiplayerAuthority.ts`, `src/ui/UIManager.ts`, `src/ui/EncounterAdvice.ts`
- Test: `tools/harness/snapjaw-net-catch.test.mjs`, `tools/harness/action-coop.mjs`, `tools/harness/island-multiplayer.mjs`

**Interfaces:**
- A remote Catch Net swing records a numbered `netSwingStart` intent against host time; a catch intent names that swing and supplies bounded origin/aim. The host checks current fling ID, equipped net, active swing window, rescuer/victim distance and line of sight before confirming a safe landing. A targeted confirmation dampens the victim client's velocity. Existing E rescue and mallet/Air Cannon jaw interruption remain alternative responses.

- [ ] Write failing tests for valid catch and rejection of stale fling or swing IDs, distant peers, unequipped tools, spoofed origins, closed swing windows, self catches and duplicate attempts; verify the victim's motion actually stops on confirmation.
- [ ] Implement the intent and confirmation, guest-side one-shot cues, visible victim marker and catch feedback. Clear any net swing that was active when its owner became captured.
- [ ] Run focused tests and the two-client scripts against an isolated server. Commit the co-op rescue pass.

### Task 5: Harvest agitation and expedition integration

**Files:**
- Modify: `src/systems/IslandDirector.ts`, `src/ui/IslandEventView.ts`, `src/enemies/EncounterSystem.ts`, `src/fruit/FruitSystem.ts`, `src/tools/Tools.ts`, `src/core/GameEvents.ts`, `src/net/MultiplayerAuthority.ts`
- Test: `tools/harness/harvest-agitation.test.mjs`, `tools/harness/island-final-events.test.mjs`, `tools/harness/scenarios/island-events.mjs`

**Interfaces:**
- Host-owned local pressure accepts an action ID and position emitted only after the authority seam accepts a valuable/violent action. It counts once, decays during calm, warns before one nearby eligible windfall, then cools down. It serializes/mirrors with defaults for old saves and yields to the final King Melon sequence. The old first-hand-pick timer is removed; pressure queues behind an active rush order rather than cancelling its payout.

- [ ] Write failing tests for ordinary apples/dock remaining calm, accepted high-value actions counting once (including remote shake/blast), visible warning before burst, pressure queued through a rush order, no eligible fruit fallback, cooldown, co-op host ownership and old-save defaults.
- [ ] Implement pressure, warning feedback and existing windfall selection. Keep rush orders and the final return readable.
- [ ] Run focused event tests, two-client transport checks and build. Commit the scheduling pass.

### Task 6: Integrated gameplay proof and delivery

**Files:**
- Create: `docs/evidence/sunpatch-chaos-combat/README.md` and selected gameplay-scale captures/reports
- Modify: `tools/harness/sunpatch-expedition-playthrough.mjs` only if the new physical responses require a legitimate player-input route adaptation

- [ ] Run all offline tests, `npm test`, action/co-op/expedition browser checks and `npm run build` on a separate port. Distinguish baseline warnings from regressions.
- [ ] Record a fresh normal-input orchard and Snapjaw route, plus isolated two-client throw/net-catch footage or captures. Inspect at gameplay scale and the recorded ultrawide aspect. Fix visible camera/HUD/fruit feedback defects, then rerun only affected checks.
- [ ] Review the integrated diff for save, authority, double payout and stale-packet risks; `git diff --check`; commit the evidence; push the branch. Report remaining human feel, pacing and physical-device gaps without claiming approval.
