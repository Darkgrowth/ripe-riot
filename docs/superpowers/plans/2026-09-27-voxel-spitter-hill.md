# Voxel Spitter and hill path implementation plan

**Goal:** Make the existing ranged encounter and its immediate approach read as one approved voxel-style scene while preserving all gameplay rules.

**Architecture:** The opt-in voxel mode selects a new authored Spitter mesh and pod visual. The existing encounter model remains authoritative. Nearby voxel dressing is selected by position without moving any plant, fruit socket, rock, collider, or route.

**Tech Stack:** Three.js, TypeScript, existing `VoxelVolume`, Node test harness, Vite.

**Source brief:** Latest `Analyze Fishing Game` chat, reviewed 2026-09-27; continue from `9f47b7f`, keep Snapjaw and shop work unchanged.

## Constraints

- Do not change `EncounterModel`, projectile spawn/flight/collision, damage, timing, rewards, saves, or co-op authority.
- The user's port 5232 preview remains untouched. No browser or game automation while the user plays.
- Use the `?voxelPilot=1` branch for new visuals; polygon baseline stays as it is.
- Manual gameplay approval, co-op, worker ground contact, and sustained performance remain pending.

## Tasks

1. [x] Add authored exposed-face Spitter geometry: connected roots/stalk, pressure bulb, dark muzzle, layered leaves, and a compact pod. Test connectivity, size, and draw-object count.
2. [x] Integrate voxel Spitter visual poses for warning, firing, recovery, hit, and persistent defeat. Test phase transitions and loaded defeated snapshot; keep baseline behavior.
3. [x] Replace only the voxel projectile visual with the pod at the exact network projectile position and orientation. Test its size and position; preserve the model and deflection rules.
4. [x] Convert only mismatched hill-path dressing around world `(-31,-8)` and the nearby fruit-bearing boulderBush while preserving sockets, colliders, and clearance. Test selected assets and unchanged positions.
5. [x] Run offline encounter and visual regressions, typecheck/build, diff check; record geometry/object counts and explicit manual review limits; commit and push the focused branch.
