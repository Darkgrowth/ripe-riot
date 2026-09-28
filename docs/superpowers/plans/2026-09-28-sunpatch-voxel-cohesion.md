# Sunpatch voxel consistency pass

## Brief and evidence

The latest *Analyze Fishing Game* feedback and four screenshots show overlapping first-person mallet gloves, noisy segmented palms, a smooth faceted gull, and a Hill Farm stall that mixes broad flat surfaces with newer voxel foliage. The requested direction is medium-resolution, softened, intentional voxel art across the first island. This pass follows the verified `codex/quality-pass` branch in an isolated worktree. The user's 5237 game and cursor remain untouched.

## Boundaries

Keep the existing Sunpatch route, fruit sockets, plant colliders and sway, encounter rules, progression, co-op authority, saves, and readable signs. Improve visual geometry and placement only. No new enemies, islands, or mechanics. Preserve the baseline visual mode where the current code supports it.

## Slices

1. Separate the mallet's first-person glove silhouettes while keeping both grips on the shaft and the head aligned to the combat contact beat. Check 4:3, 16:9, and wide projection offline.
2. Rebuild the voxel palm around a continuous curved trunk and a few broad frond fans. Preserve coconuts, collider, batching, and sway.
3. Rebuild the gull's voxel body, head, beak, eyes, and wings on its existing pivots. Preserve its behavior and baseline presentation.
4. Restyle the first-island dock, shop, stalls, signs, crates, ladders, and route props to share the same medium-resolution shape language without moving interaction points or supports.
5. Audit the playable first-island route for obvious remaining mixed-style holdouts, and record what still needs gameplay-scale review.

## Gates

Use focused geometry/pose tests for each slice, then all offline Node tests, typecheck, production build, and diff review. Compare against the supplied normal-gameplay screenshots. New runtime visuals, active play feel, co-op visuals, and performance remain unverified until the user tests an isolated preview; do not launch browser automation during the live session.

## Verification record

- The mallet's ready and contact poses were rendered from the actual viewmodel geometry with `mallet-offline-preview.mjs` and `mallet-offline-render.py` at the 52-degree first-person camera. The ready pose now shows two separate grips on the shaft; the contact pose retains both grips with the head over the aim area. The pose test also checks 4:3, 16:9, and ultrawide projections. The baseline art path keeps its original grip transform.
- The gull body and wing meshes were rendered headlessly from below and from the side. The broad connected wings, head, beak, and tail read as voxels in these isolated views.
- Two palm variants were rendered headlessly at about 12 m and 1.8 m eye height. The revised crowns show five broad separated fronds, and the trunks no longer have dark full-width bark bands. Their large voxel bend steps remain visible.
- All offline Node harness tests passed: 178/178. `npm run build` passed, including `tsc --noEmit`; `git diff --check` passed. A read-only integration review found no actionable code regression.
- Structure appearance in actual island lighting, palm coconuts and sway, gameplay feel, multiplayer visuals, and performance still need a player-scale in-game check. Some small dock rope/lantern, oar, and reel-crank details retain the simpler established art.
