# Voxel King Vine finale implementation plan

**Goal:** Carry the approved moderately detailed voxel presentation through the existing King Vine fight, suspended King Melon, holding vines, and extraction worksite.

**Architecture:** Keep King Vine, LegendaryHarvest, RopeSystem, and world placement as the authorities for combat, constraints, physics, and extraction. Select new geometry and pose presentation only in `?voxelPilot=1`, while the polygon baseline retains its visual path.

**Tech Stack:** Three.js r169, TypeScript, existing VoxelVolume, Node offline tests, Vite.

**Source brief:** Latest `Analyze Fishing Game` review after `d62f1c8`, read 2026-09-27.

## Global constraints

- Do not change boss attack order, timing, health, damage, vulnerability sphere, projectile path/return, or host/co-op authority.
- Do not change King Melon radius 5.6 m, mass 2600 kg, anchor search, rope endpoints, cutting, optional tethers, payout, extraction conditions, or saves.
- Do not move or add obstacles in the approach, two ravine exits, or downhill extraction corridor.
- Keep the active preview and user's pointer untouched; no browser/game automation in this pass.
- Existing Spitter, Snapjaw, and shop work remains unchanged. Normal-camera visual approval and sustained performance remain pending.

## Tasks

1. [x] Add authored voxel King Vine base, crown, sweep arm, exposed stem, and seed with source-level geometry/scale tests.
2. [x] Integrate opt-in boss presentation: sweep/seed warning, lateral sweep, launch recoil, recover exposure, hit response, and persistent subdued pose. Preserve baseline and snapshots with offline pose tests.
3. [x] Give the King Melon a six-striped rounded voxel render mesh within its original visual envelope and unchanged physics center, with offline size/selection tests.
4. [x] Style the four real holding vines and extraction destination in voxel mode without moving their geometry endpoints or changing rope/extraction rules. Check geometry and lifecycle contracts offline.
5. [x] Run relevant offline boss/legendary regression tests, typecheck/build, diff check. Record actual source-level counts and remaining manual checks; commit and push.

## Verification and handoff

- `node --test` across `tools/harness/*.test.mjs`: 114/114 pass, including boss combat, voxel pose, melon envelope, holding-vine cut removal, and pad lifecycle. Several existing tests log `WebSocket server error: Port is already in use` while still passing; no browser was opened for this pass.
- `npm run build` and `git diff --check`: pass. Vite reports its existing large-chunk advisory.
- Source geometry: voxel melon 11,056 triangles; guardian base 5,952, sweep arm 4,864, 684 core, 604 per guard, and 788 seed. Connector length varies with melon height (3,720 triangles at a 15 m local top). Four active holding vines render at 192 triangles each. Extraction border has 24 separate pieces inside the existing 15 m pad.
- The physics melon still has radius 5.6 m and mass 2,600 kg. The four cuttable vine endpoints, their solver settings, boss strike rules, and extraction search/completion code were not edited.
- Remaining acceptance: normal gameplay-camera review of the boss silhouette, warning readability, vine/pad legibility, route clearance, and sustained frame rate on the user's active setup. Pointer-sensitive browser and playtest automation remain deferred.
