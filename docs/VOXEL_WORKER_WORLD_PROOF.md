# Voxel worker + orchard visual proof

This is a deliberately small style check for the RIPE RIOT worker and one piece of Sunpatch. It is available at `/voxel-proof.html` on this worktree's Vite server. The page has scene-distance, close-up, and whole-patch cameras; drag to orbit and scroll to zoom.

## What is shown

- A roughly 2 m worker with the orange cap, yellow suit, brown gloves and boots, and green pack. The worker is authored as one connected voxel occupancy volume and rendered as one exposed-face mesh. Its face, cap, boots, and pack meet the main body through shared voxel faces.
- A roughly 14.4 × 11.5 m terrain slice with an orchard path, three fruit trees, a harvest crate, sandy bank, and turquoise water. Terrain, water, crate, and each complete tree are batched surfaces rather than one scene object per cube.
- The warm Sunpatch palette, rendered with simple sun/sky light and cast shadows.

The proof contains 952 worker voxels and 2,328 terrain/water voxels in seven draw objects. It is a static visual study. It does not replace the worker asset in the live game or introduce voxel first-person hands, animation, physics, or a complete island. Mimic and Snapjaw assets are untouched. This visual direction remains a user decision.

## Visual evidence

| View | Capture |
| --- | --- |
| Scene distance, 1920×1080 | [scene-distance-1920x1080.png](evidence/voxel-worker-world-proof/scene-distance-1920x1080.png) |
| Worker close-up, 1920×1080 | [worker-close-1920x1080.png](evidence/voxel-worker-world-proof/worker-close-1920x1080.png) |
| Whole patch, 1920×1080 | [whole-patch-1920x1080.png](evidence/voxel-worker-world-proof/whole-patch-1920x1080.png) |
| Scene distance, 3434×1270 | [scene-distance-3434x1270.png](evidence/voxel-worker-world-proof/scene-distance-3434x1270.png) |

I visually inspected all four captures. The worker silhouette and orchard/shore materials remain readable at the intended views. The proof uses its own elevated 46° orbit camera, while the live game uses a 68° first-person camera; these images do not establish exact in-game framing. The head and face are intentionally simple cubes; whether that look belongs in RIPE RIOT needs user approval.

## Checks

- `node --test tools/harness/voxel-style.test.mjs` — connected worker, approximate character scale, and batched compact terrain pass.
- `npm run build` — TypeScript and Vite multi-page build pass; both `index.html` and `voxel-proof.html` are emitted.
- `node tools/harness/capture-voxel-proof.mjs` — four headless captures, HTTP 200, no browser console or page errors. Results: [capture-results.json](evidence/voxel-worker-world-proof/capture-results.json).

These checks establish that the proof renders and stays within the intended scope. They do not mean the style has been approved or that the voxel worker has been exercised in gameplay.
