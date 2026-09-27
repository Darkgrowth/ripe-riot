# Orchard Ground Integration Implementation Plan

> **For agentic workers:** Execute this focused fix with the systematic-debugging and test-driven-development workflows.

**Goal:** Remove the plate seams and terrain intersections on the dock-side Old Orchard approach while preserving the existing movement surface and voxel palette.

**Architecture:** Voxel mode will tint the existing Terrain render mesh. Its vertex positions and the Rapier trimesh remain identical to baseline; no second walkable surface is created. Keep all changes in this isolated successor of `60f620a`; the user's port 5233 preview stays on the prior checkout.

**Tech Stack:** Three.js r169, TypeScript, esbuild-backed Node tests, Vite build.

**Spec:** Latest `Analyze Fishing Game` review of the 18-second recording, read 2026-09-27.

## Root cause and red evidence

- The 0.5 m overlay uses flat center heights above a separately triangulated 1.5 m terrain mesh. On the approach, its tops cross the underlying triangles and its dark-green vertical faces stripe the path.
- Offline red test of the x=-8..4, z=28..40 approach with path weight >0.6: 140 of 1,770 sampled top vertices leave less than 1.2 cm clearance; minimum is -5.05 cm, shared-edge jump reaches 17.6 cm, and 268 side triangles are present. The uploaded 14-second frame shows the corresponding raised plates and green seams.
- The old test compares only to `Terrain.height()` at overlay vertices, so it misses the different triangulation underneath.

## Steps

1. [x] Replace the overlay test with a red contract: voxel tint changes the real terrain mesh colors but leaves its geometry, collider inputs, and scene mesh count intact. Test an orchard-route sample and an outside-patch sample.
2. [x] Replace `buildVoxelClearingTerrain` with a palette operation on `Terrain.mesh`; call it from `Sunpatch` after `Terrain.build` in voxel mode only. Keep the same grass, earth, path and edge-blend color relationships.
3. [x] Run focused non-browser geometry/regression tests and the build. Record the remaining gameplay-camera check; commit and push. Do not modify the live port 5233 checkout or automate the browser.

## Verification and limits

- The rewritten terrain regression failed first because the single-mesh palette function was absent, then passed after implementation. It checks the real terrain mesh identity, unchanged vertex positions and collider input size, recoloring at the Old Orchard gate and center, and unchanged colors outside the clearing.
- `node --test` over all `tools/harness/*.test.mjs`: 114/114 pass. Several pre-existing Vite middleware tests log nonfatal `WebSocket server error: Port is already in use` messages while the concurrent suite exits successfully. No browser or game automation was used.
- `npm run build` and `git diff --check`: pass. Vite retains its existing large-chunk advisory.
- The old overlay contributed 29,270 triangles and one extra ground draw object in voxel mode. The new palette uses the existing Terrain mesh; no movement height, Rapier collider, fruit position, route width, or baseline-mode code changed. This is a source-level count, not an FPS claim.
- Gameplay-camera confirmation of route appearance and sustained performance remains pending. The user's port 5233 preview remains on the previous checkout, untouched by this branch.

## Review focus

- The Old Orchard gate path reads as a continuous earth route at normal camera height, without green seams or base-triangle breaks.
- Clearing banks, trees, produce, and props retain the approved moderate voxel language.
- Movement, collision, fruit sockets, route clearance, and baseline mode remain unchanged.
- Performance is measured only if a safe, authorized gameplay capture becomes available.
