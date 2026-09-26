# RIPE RIOT detailed voxel visual overhaul

26 September 2026. This records the art direction settled in the later “Analyze Fishing Game” discussion. It supersedes the **visual** direction in `ACTION_HARVEST_OVERHAUL.md` where that document says to retain the polygonal island; its route, combat, fruit ownership, economy, save, network and recovery rules remain active. The connected low-poly worker and both static voxel studies remain evidence and fallbacks, not the final visual target.

## Target

Build one coherent, colorful, moderately detailed voxel-style action adventure. Use the first “Voxel worker + orchard” study as the starting shape language, then substantially improve character proportions, materials, animation and game integration. The second “Block worker + orchard” study deliberately shows the coarse Minecraft-like direction we are **not** choosing.

“Detailed” means deliberate silhouettes and features, not uniformly tiny cubes. The opening worker is roughly 40–48 modeling units tall; ordinary fruit is roughly 12–24 units across when its size warrants it. Character faces, clothes, gloves, tools and enemy tells get finer detail than distant terrain. Trees have irregular stepped crowns and shaped trunks. Fruit stays recognizably rounded. Terrain can have chunky, layered forms without turning every metre into a visible cube. Use restrained color variation, keeping high contrast for fruit, threats and interactions.

Voxel-authored geometry is exported or generated as optimized Three.js meshes. Hidden faces are removed and there is no one-Mesh-per-voxel scene graph. Models may use well-fitted articulated sections where animation requires them; no accidental floating parts, open seams or ugly intersections. Movement remains continuous, with planted feet, anticipation, impact and recovery. Preserve the existing game technology; this direction does not add mining, block placement, physics per voxel, or arbitrary terrain destruction.

## Whole-game scope

The eventual visual overhaul covers workers, residents, enemies, fruit, first-person hands, tools, vegetation, buildings, props and terrain. It also replaces effects that clash with the new materials. Temporary mixed visuals during development are acceptable; a half-converted final island is not. Preserve the tropical action-harvest identity and approved route and encounter rules.

### Stage 1: one complete playable orchard clearing

Convert and integrate the worker, first-person hands, Picking Mallet, Air Cannon, a few ordinary fruit and the Mimic's physical prize, orchard trees/ground/working props, and Mimic Melon. Preserve the real path and a usable delivery point. The normal-input loop must read as **walk in → recognize the warning → fight → recover from a mistake → collect the prize → deliver it**. The playable build, not a standalone diorama, is the quality gate.

The worker must fit the existing 17-bone co-op/ragdoll contract or a verified equivalent. First-person grips must remain correctly framed at 1920×1080 and 3434×1270. Fruit tree visual attach points, sway and colliders must remain aligned. Mimic's existing host-owned combat phases, hitboxes, damage, reward and telegraph timing are preserved while its shell, mouth, roots and attack pose are redesigned. Main paths remain comfortable to walk, and meaningful ledges retain honest collision.

Stage 1 is complete only after source inspection, matched gameplay views, continuous animation review, the affected test suites/build, a normal-input harvest/fight/delivery run, and a clear account of performance and unverified hardware limits. The user decides whether the visual standard is good enough to expand.

**Stage 1 implementation status (27 September 2026):** The opt-in orchard clearing is implemented on branch `codex/detailed-voxel-clearing`. The connected skinned worker and grips, batched fruit/trees/ground/dressing, tools, and Mimic are integrated into the existing game. The standard and ultrawide normal-input route, co-op worker motion, source topology, build, focused contracts, full scenario suite, and cross-mode save round trip are recorded in [the Stage 1 evidence](evidence/detailed-voxel-clearing/README.md). After reviewing a 52-second gameplay clip, the later “Analyze Fishing Game” discussion chose this moderately detailed voxel direction for the overhaul. The [follow-up art review](evidence/voxel-art-polish/README.md) fixes the worker's unintended limb texture and varies orchard crowns. The user has approved the **direction**, not every finished asset. The remote fallen pose still appears high over the slope; planted feet and local settled ragdoll contact remain visual concerns. Sustained hardware frame rate has not been measured. Palms, rocks, bushes and shop art outside the clearing still need conversion.

### Stage 2: reusable art workflow

Keep editable source and reproducible exports; lock palette, detail hierarchy, joint conventions and material treatment from the successful clearing. Create only helpers demonstrated by Stage 1 assets. Preserve and label the older connected-worker specification as superseded where it conflicts with this direction.

### Stage 3: rest of Sunpatch

Convert coherent areas in route order: dock/shop, orchard remainder, dangerous grove, hill and ravine, then legendary worksite. Convert each area's associated enemies, fruit, tools and scenery together. Preserve sightlines, escape routes and encounter behavior while changing presentation.

### Stage 4: complete opening verification

Play from a separate fresh save with normally acquired equipment. Check traversal, first-person framing, enemy readability, recovery, delivery, upgrades, King Melon extraction, standard and ultrawide views, multiplayer presentation, and hardware performance when available. Screenshots and software rendering timings alone are insufficient for final art or performance approval.
