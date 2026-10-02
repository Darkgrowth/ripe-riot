# Orchard Extraction Implementation Plan

> **For agentic workers:** Use focused disjoint implementation and one lead for integration. Existing user authorization requests implementation of the referenced design; the lead continues in this session.

**Goal:** Deliver one playable $500 harvest-extraction clearing to test the proposed physics-chaos pivot.

**Architecture:** A query-selected mode composes a compact `OrchardClearing`, mode-specific planting, the existing fruit authority/tools/rescue mechanics, an extraction ledger and a dedicated front door/results shell. The original Sunpatch expedition remains accessible. Enemy fruit-contact rules run only on the host and use existing encounter snapshots.

**Tech Stack:** TypeScript, Three.js, Rapier, Vite, Node tests, remote Ubuntu Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-orchard-extraction-design.md`

## Global Constraints

- Preserve rounded voxel art and existing fruit valuation.
- No boss, quest progression, shopping, permanent timer or new island content in Orchard Run.
- Target $500; smaller extraction and continuing after target are allowed.
- Storage keys and transport channels separate Orchard Run from Sunpatch.
- No local browser input or npm test; use remote Linux for gameplay proof.

## Review Focus

- Duplicate and guest-predicted sale events must not multiply team quota.
- A replay/reload must not resurrect secured fruit or overwrite Sunpatch saves.
- A fast fruit crossing an enemy between steps must hit once, not tunnel or repeatedly damage.
- Safe-crate recovery must not cover the dangerous harvest pockets.
- Mode mismatch must never join peers with incompatible deterministic fruit IDs.

### Task 1: Extraction ledger, authority and front door

**Files:** new `src/systems/HarvestExtraction.ts`, `src/ui/OrchardShell.ts`, focused model/tests; modify `src/save/SaveSystem.ts`, `src/net/MultiplayerAuthority.ts`, `src/ui/UIManager.ts`, related transport selection.

**Interfaces:** `HarvestExtraction` system name `extraction`, `objective`, `netState()`, `applyNet(state)`, `serialize()`, `deserialize(data)`, `finish()` at crate. World exposes `orchardRun`, spawn, sellPad, sellRadius and safe-radius. Register extraction before net/save/UI.

- [x] Write/verify failing ledger tests for true fruit sale only, duplicate IDs, exact $500, partial extraction, malformed snapshot and saved state.
- [x] Implement host ledger, shared snapshot, mode-separated storage/rooms, safe extraction/results/replay shell and HUD.
- [x] Verify browser-free affected tests and typecheck; lead integrates main composition.

### Task 2: Physical fruit/enemy bridge

**Files:** `src/enemies/EncounterModel.ts`, `src/enemies/EncounterSystem.ts`, relevant visuals and new fruit-contact tests.

**Interfaces:** World `orchardRun` selects two threat spawns near loaded tree and glue pocket. Expose `setHarvestAwake(awake: boolean)` for the director; resting clears committed danger without losing banked state. Swept contact receives real free-fruit positions and bounded speed.

- [x] Write/verify failing tests for Boulder knock/damage, Glue interruption, high-speed swept contact, overlap cooldown, non-host and snapshot behavior.
- [x] Implement bounded physical contact and nonlethal Air Cannon control in Orchard Run; use existing mallet/net paths.
- [x] Verify model/network regressions and typecheck; give lead exact integration API.

### Task 3: Compact clearing and actual run composition

**Files:** new `src/world/OrchardClearing.ts`, `src/world/OrchardLayout.ts`; modify `src/fruit/FruitSystem.ts`, `src/main.ts`, `src/systems/IslandDirector.ts`, `src/player/DockRecovery.ts`, `src/interaction/InteractionSystem.ts`.

- [x] Author crate/safe apron, short approach, loaded trees, Puff/Glue/Boulder pockets and compact playable terrain using approved geometry helpers.
- [x] Plant deterministic recoverable cargo only in clearing; suppress legendary/progression/shops/old route systems in mode.
- [x] Wire harvest agitation to warn/wake/rest without rush orders. Forfeit held cargo on evacuation through host authority.
- [x] Add the menu entry/direct mode and start tools; verify safe radius, authored cargo value/reach, browser-free checks/build.

### Task 4: Remote proof and delivery

**Files:** new ordinary-input extraction harness, remote workflow job, durable evidence README/reports/images.

- [x] Push coherent verified code, run Ubuntu gameplay and existing regression jobs.
- [x] Verify real harvest → haul → bank → partial/full finish → reload and two-peer shared quota; label staged impact/rescue checks.
- [x] Inspect matching gameplay-scale captures, fix concrete problems, retain raw failure logs.
- [x] Commit/push final pass, provide new isolated frozen preview and honest human-playtest limitations.

## Delivery evidence

Game source `4afa199`; QA follow-ups `94ec35c` leave `src/` unchanged. Browser-free regressions: 463/463. Build/typecheck: pass. Remote Orchard solo: 26/26; Orchard co-op: 33/33; original scenarios: 20/20; original expedition: 26/26 route beats; supplemental host and guest net fixtures: 10/10 each with staged aim and real primary input. Gameplay-scale captures and reports are in `docs/evidence/orchard-extraction/README.md`.

Frozen preview: `http://127.0.0.1:5287/?orchardRun=1`. Human fun, pacing, ordinary aiming during rescue, deliberate fruit tricks and hardware frame rate remain playtest judgments.
