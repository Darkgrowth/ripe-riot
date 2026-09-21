# Focused response to user footage

The supplied video is 1.450646 seconds. Eight extracted frames were inspected; it is a shop-floor view. Moving hard-shadow edges are consistent with the unsnapped light frustum; hardware confirmation is still pending.

Staged changes:
- Snap the directional light projection in light-space to whole shadow texels to reduce crawling under slight camera motion.
- Add rooted, forked branches at all 7 active vinebomb origins. Existing fruit/plant IDs, nodes and RNG are preserved. New solid limbs have matching capsule proxies and lifecycle cleanup; roots are buried 0.12m.
- Preserve soft authored normals on the purple pear, with 24 radial segments; hanging stems now use 8 radial segments.
- Barrel cylinders/hoops use 16 sides; King Melon support crags use 14 sides with their matching collision mesh.
- Render one 22-second original 132 BPM music audition. It is not a runtime replacement or an approved mix.

Validation: typecheck/build passed (`index-Dz-FGfU6.js`). Seven clear vine nodes and 14 measured release flights passed. Rock checks: 4/4 supports, 64/64 side rays, valid geometry and rope capture/pin/release. Rendered close-ups inspected. Shadow projection alignment passed; reported flicker is not yet claimed eliminated. Browser messages were software ReadPixels warnings, with no JavaScript errors. No full gameplay/multiplayer suites or hardware performance rerun in this narrowly scoped pass.

Capture review: `capture/focused-feedback/review.html`. Exact logs and the original short-clip contact sheet are alongside it. The previous ten-minute recording validates its earlier build, not these subsequent rendering changes. Original live source and browser are left alone.
