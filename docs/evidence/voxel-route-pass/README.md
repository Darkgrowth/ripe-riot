# Dock to orchard voxel route review

27 September 2026. Opt-in build: `?voxelPilot=1` on `codex/voxel-art-polish`.

## What changed

- The dock/shop/orchard route now uses stepped palms, bananas, coconuts, foliage and boulders. Seeded placement, fruit sockets, sway metadata and physics colliders are retained.
- The skinned worker has simpler sleeves, cuffs, pants and boots. The 17-bone game contract remains in place. Editable Blender source, export script and close-up renders are in [the clothing pass](../detailed-voxel-worker/clothing-pass/).
- The shop structure, display fruit and some distant scenery are still older polygonal art. The rest of Sunpatch is still in development.

## Gameplay-scale evidence

- Matched 1920×1080 [baseline dock](baseline/dock-arrival.png) and [voxel dock](voxel/dock-arrival.png), plus [shop approach](voxel/shop-approach.png) and a clearer [orchard path](orchard/orchard-path.png). The [matched-view manifest](manifest.json) records draw calls, triangles and page errors.
- [Worker front](worker/worker-front.png), [side](worker/worker-side.png), [walking](worker/worker-walk.png), [ragdoll](worker/worker-ragdoll.png) and [co-op motion clip](worker/worker-coop-motion.webm) are separate gameplay captures; [worker manifest](worker/manifest.json) records rendering and ground position measurements.
- The [normal-input report](normal-loop/report.json) records all nine route beats passing: dock, warning, hit and recovery, Mimic defeat, physical prize, carrying, real sale pad, and E sale. [Orchard entry](normal-loop/02-orchard-entry.png), [defeat](normal-loop/05-mimic-defeated.png), [carrying](normal-loop/06-prize-carried.png) and [sale](normal-loop/08-sold.png) show the route in play. The report has no browser errors or warnings.

## Verification and remaining concerns

`npm test` passed 20/20, the focused voxel integration checks passed 14/14, and `npm run build` passed. The worker export validation and its focused contracts also passed. The route capture ran headless on an RTX 4070 Ti through ANGLE/D3D11; at the dock it drew about 2.36 million triangles versus 0.94 million for the matched baseline, with 246 versus 262 draw calls. These are static draw counts, not a sustained FPS or GPU frame-time measurement.

The worker's early fallen pose sits about 5 cm above the local terrain in the capture, and the later settled screenshot does not show enough of the body to judge contact. The defeated Mimic obscures part of the carried-prize view. The worker still needs art approval at gameplay scale, and shop/distant-area conversion and performance tuning remain open.
