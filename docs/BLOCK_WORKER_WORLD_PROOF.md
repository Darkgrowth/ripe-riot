# Block worker + orchard visual proof

This is a second, more Minecraft-like style study beside the [first voxel proof](VOXEL_WORKER_WORLD_PROOF.md). Open `/block-proof.html` on the worktree's Vite server to orbit the scene and switch between scene-distance, close-up, and whole-patch views. The study uses original colors and procedural geometry; it does not use Minecraft textures or assets.

## What changed from study 01

| Element | Study 01 | Study 02 |
| --- | --- | --- |
| Worker | Finer voxel silhouette and smaller facial pixels | Broader square head, straighter sleeves, flatter cap, apron pixels |
| Trees | Rounded voxel crowns | Squared tiered crowns with block fruit |
| Ground | Even grass and path slice | Stepped grass/dirt bank and stronger block pattern |

The orange cap, yellow suit, orchard route, sand, and turquoise water remain recognizable. The worker is one connected occupancy volume and one render mesh. Each tree, the terrain, water, and crate are each batched surfaces rather than individual cube scene objects. There are 1,236 worker voxels and 2,373 terrain/water voxels in seven draw objects.

Both studies use the same 46° preview camera presets, lighting, output color settings, and 1920×1080 capture size for comparison. This is an orbit-camera style view, not the live game's 68° first-person framing.

## Visual evidence

| View | Capture |
| --- | --- |
| Scene distance, 1920×1080 | [scene-distance-1920x1080.png](evidence/block-worker-world-proof/scene-distance-1920x1080.png) |
| Worker close-up, 1920×1080 | [worker-close-1920x1080.png](evidence/block-worker-world-proof/worker-close-1920x1080.png) |
| Whole patch, 1920×1080 | [whole-patch-1920x1080.png](evidence/block-worker-world-proof/whole-patch-1920x1080.png) |
| Scene distance, 3434×1270 | [scene-distance-3434x1270.png](evidence/block-worker-world-proof/scene-distance-3434x1270.png) |

I inspected these captures at scene distance and close-up. The block worker and square trees read clearly, and the shore/path separation remains visible. This remains a static style choice for the user; no live game model, animation, hands, Mimic, or Snapjaw assets were replaced.

## Checks

- `node --test tools/harness/block-style.test.mjs tools/harness/voxel-style.test.mjs` — both studies' connected worker and batched patch checks pass.
- `npm run build` — TypeScript and Vite build pass with both proof pages and the game entry.
- `node tools/harness/capture-block-proof.mjs` — four headless captures, HTTP 200, no browser errors; camera selector and link back to study 01 work. [Capture results](evidence/block-worker-world-proof/capture-results.json).

These checks do not establish visual approval, live-game integration, animation quality, or exact in-game framing.
