# First-zone authored-prop repairs

This is the source and CPU-audit handoff for the first repair phase. It is not visual acceptance. Root must inspect the final source in gameplay, including normal-height approaches and sign backs.

## Repairs

- All 14 authored sign faces now measure and fit their text inside padded bounds. Body text wraps by measured words and reduces font size when needed. Titles fit independently. Texture `userData.signLayout` retains the actual browser measurements for inspection.
- Text is front-facing only. Each face has a physical, unlettered backing merged into the existing prop batch. Hill Farm and ravine fingerboards stand .215 m forward of their posts; the dock sign and island board also clear supports. The wanted poster clears wall trim. Merv's main board stands ahead of the full roof eave on two timber stand-offs. The side SHOP board hangs from correctly oriented ropes and a crossarm.
- Both orchard ladders are self-supporting A-frames with grounded feet, rear bracing and spreader bars. Their original placements and decorative collision behavior remain.
- Orchard crates are slatted containers. The loaded top crate sits directly on its lower crate; every decorative fruit shares its container transform and rests on its floor. Top crates now have matching solid colliders.
- Shop crates are slatted shipping crates with supported lids. Stacked crates align, fruit sits on the lid in the same transform, and moved solids carry their colliders. Loose shop barrels/sacks and cart/barrow feet use actual ground height. Shop origin, hatch, counter, sell pad and character placement remain unchanged.
- Dock basket contents rest on their floors instead of floating in empty space. Dock lanterns have small mounts connecting them to the bollards. Existing random draws are preserved.

## Capture handoff

- Runtime signs: `world.built.signs[i].userData.signAudit` includes stable ID, physical size and texture-layout measurements. Mesh position/rotation gives the world pose.
- Runtime props: `world.built.mesh.geometry.userData.authoredProps` includes stable IDs, local-to-world matrices and support/content metadata. Includes dock crate/barrel/basket groups, shop crates/barrels/sacks/cart, both orchard ladders/stacks/barrow, and hill/beach/ravine workstations.
- `capture/zone-repair/qa/sign-capture-manifest.json`: all 14 front/back source-derived poses at 1.6 m eye height. Wall-mounted backs may be inaccessible; do not accept an image taken from inside a solid building.
- `capture/zone-repair/qa/repair-qa-config.json`: six explicitly exterior shop views for left stack, right crate, side crate, main sign, wanted poster and island board. Wait two seconds after teleport/boot before capturing.
- `capture/zone-repair/qa/prop-capture-manifest.json`: prop transforms and fixture details.

## Validation

`npm run typecheck` passes.

`node tools/harness/repair-props-offline.mjs` passes: all 14 sign centres have no prop in front of their face; faces are front-only; fitted text stays inside padded bounds under a conservative CPU fixture font metric; 15 ladder/cart/barrow support points touch terrain; eight orchard fruit centres satisfy floor contact and container footprint checks. Shop counter, sell pad, legendary position, vine anchors and authored trimeshes remain identical to the pre-repair snapshot.

The CPU font metric is not the real browser font. Real browser `signLayout` measurements and gameplay screenshots remain required. Likewise, grounded support equations do not prove every detail is visually convincing.

Merged prop geometry grows from 33,936 to 38,928 triangles (+4,992). Sign backs join the same batch: no new materials or draw calls. Primitive collider count grows from 222 to 224 because both loaded orchard top crates now have matching colliders. Existing shop crate/barrel colliders move with their repaired visuals. No plants, terrain routes, harvest systems or physics rules change.

## Integrated visual follow-up

The later walking-height inspection added supported hill trays/hook, slatted dock and shop-apron crates, and cleared a side-crate/barrel intersection. Merv's main board moved forward above the weighing beam and the awning rose 0.45 m to clear his head. These replace the earlier roof stand-offs described above. The final merged prop mesh is 40,224 triangles; primitive colliders remain 224. Counter, sell pad, routes and fruit attachment positions remain preserved.

Final rendered views and the exact two reported locations are in `capture/alive/visual/review.html`. Fourteen faces and approaches plus eleven straight rear views and Merv's exterior side-lane rear view were inspected. Building-facing sign backs are not presented as visible proof; the obstructed central Merv pose was excluded in favor of that valid exterior oblique view. Full-resolution prop images and matching contact sheets supplement the CPU support measurements. Final source/route results are recorded in `STAGING_NUMERICAL_QA.md`.
