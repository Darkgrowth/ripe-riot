# Mimic Melon style comparison — design and acceptance

25 September 2026. This branch continues `codex/action-harvest-overhaul`.
The experiment decides how **one** action-harvest enemy should look and feel.
It does not choose a permanent island style or rebuild the world as voxels.

## Shared creature and fight

Both A and B use one anatomy: a squat, ribbed melon with a rooted lower body,
a hinged upper rind, red flesh visible in a real mouth split, a restrained row
of teeth, four weight-bearing roots, and a crown stem. At rest, the shell closes
and the roots tuck in. Proximity reveals a threat: roots plant, shell lifts,
mouth opens, then the body compresses and commits to a straight lunge. A miss
skids into a recovery opening. Hits interrupt with knockback; defeat leaves a
brief, readable collapsed rind before the physical prize drops.

The model and animation event timing are shared. Mesh construction alone
differs: A uses rounded low-poly surfaces with a few decisive facets; B uses
stepped block-built volumes and sparse colour blocks. Both use the same scale,
palette roles, lighting, camera, hitboxes, health, damage, speed, rewards,
effects count, and audio. B's small blocks are merged into a few buffers per
moving body part, with hidden faces omitted; they are not individual objects.

## Orchard arena

The fight sits in the center lane of the current orchard, clear of trunks,
crates and the two solid fence lines. It has lateral dodge space and an open
route back to an orchard sell pad in the comparison fixture. The normal game's
dock sell pad is unchanged. The Mimic's committed path must stop at
solid geometry, just as the player does. A solid rail must not be an enemy-only
shortcut. The Picking Mallet is the direct route; the existing Air Cannon is
the ranged tool alternative. A mistake can cost health, then the player can
recover, collect the dropped watermelon and sell it with normal controls.

The baseline at `9b56b71` passes 19/19 game scenarios, the production build,
and 10/10 two-page co-op checks. A targeted reproduction showed the old Mimic
crossing the lower fence rail near `(-28.42, 15.55)` while the player stopped
against it. The earlier combat scenario used a debug teleport and did not
prove a normal-control fight. No fully inescapable trap was established.

## Comparison preview

The selector opens A or B in the same fresh orchard fixture. Changing style
restarts that fixture, so phase, position, health, player state, money, tools,
arena and lighting match. Preview saves are neither loaded nor written to the
real progression slot. Other threats stay out of the focused fixture. The
normal game retains its save and co-op systems; style choice is local visual
state and never changes authoritative hit detection or network packets.
Open `/?mimicCompare=A` or `/?mimicCompare=B` on the dedicated preview server.
Use the selector or `V` to swap styles, `R` to reset, and normal controls for
the fight. Pointer lock starts the Mimic AI. The fixture equips the current
Picking Mallet and Air Cannon and places its temporary sell pad on the orchard
route. It does not load or write the real save slot.

## Matched visual evidence

The committed [A and B stills](evidence/mimic-style/) show the same staged
entry, lane, warning, charge, stagger, recovery, and defeat poses. These were
captured with the debug pose probe to compare shape and animation at matched
camera positions. They are not the normal-control combat proof. In particular,
compare [A warning](evidence/mimic-style/A-warn.png) with
[B warning](evidence/mimic-style/B-warn.png), and
[A recovery](evidence/mimic-style/A-recover.png) with
[B recovery](evidence/mimic-style/B-recover.png).

`tools/harness/mimic-fight.mjs` records the separate normal-input proof. The
four matched full-HUD close-fight recordings are committed here:

| | 1920×1080 | 3434×1270 |
| --- | --- | --- |
| A polygonal | [fight](evidence/mimic-style/videos/A-1920x1080.webm) | [fight](evidence/mimic-style/videos/A-3434x1270.webm) |
| B block built | [fight](evidence/mimic-style/videos/B-1920x1080.webm) | [fight](evidence/mimic-style/videos/B-3434x1270.webm) |

Each run starts from the comparison fixture,
accepts one charge hit, strikes with the Mallet, finishes with the Air Cannon,
grabs the physical watermelon, walks to the orchard pad, and sells with `E`.

The separate ranged alternative uses the Air Cannon twice from the open lane,
starting with the Mimic about nine metres away. Both runs finish at full
health, then chase the rolling reward and sell it through normal controls:
[A ranged fight](evidence/mimic-style/videos/A-1920x1080-air-only.webm) and
[B ranged fight](evidence/mimic-style/videos/B-1920x1080-air-only.webm).
Matched gameplay frames show the [A mid-distance attack](evidence/mimic-style/A-ranged.png)
and [B mid-distance attack](evidence/mimic-style/B-ranged.png) with the full HUD.

The six [raw run reports](evidence/mimic-style/reports/) record positions,
health, tool events, pickup, sale, and browser errors. Additional full-HUD
stills are in the ignored local `capture/mimic-comparison` directories. No
debug phase, teleport, synthetic input, or forced reward is used during any
of these recordings. Reproduce them with `RIPE_URL` pointed at this
branch's dedicated Vite server and `MIMIC_VIDEO=1`, then run
`node tools/harness/mimic-fight.mjs A 1920 1080` (change style/size for the
other three matched cells), or add `air` as the fourth argument for the ranged
route.

## Static render comparison

`tools/harness/mimic-metrics.mjs` measured 72 sequential settled frames at
the same paused warning pose for each cell, DPR 1. Renderer:
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.
Median/p95 frame values below are milliseconds.

| Style | Viewport | Draw calls | Triangles | Geometries | Render submit median/p95 | Total frame median/p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A polygonal | 1920×1080 | 163 | 923,690 | 108 | 1.9 / 2.2 | 3.0 / 3.7 |
| B block built | 1920×1080 | 149 | 924,126 | 101 | 1.7 / 2.2 | 2.8 / 3.6 |
| A polygonal | 3434×1270 | 163 | 923,690 | 108 | 2.0 / 2.4 | 3.2 / 3.9 |
| B block built | 3434×1270 | 149 | 924,126 | 101 | 1.8 / 2.1 | 2.9 / 3.8 |

The renderer is headless software SwiftShader. These CPU-side measurements
are useful for a controlled A/B comparison, but they are not GPU time, actual
hardware frame rate, or a promise of playable ultrawide performance. The
numbers include the existing orchard; the extra enemy geometry changes the
whole-scene totals only slightly. [Raw metrics](evidence/mimic-style/metrics.json)
are committed and can be regenerated with the metrics script.

## Verification on this branch

- All four normal-input fight videos completed with one charge hit, a Mallet
  strike, Air Cannon finish, physical watermelon pickup, and sale by `E`.
  Health finished at 72/100; reward was $80 for the encounter plus $105 for
  the sale in each run. Browser error lists were empty.
- The two additional Air Cannon-only recordings proved a distinct route:
  two shots from distance, 100/100 health, rolling-prize recovery, and the
  same $80 plus $105 payouts in both styles. Their browser error lists were
  also empty.
- The preview check passed style matching, reset, save isolation, pad sale,
  and solo retry. `npm test` passed 20/20 gameplay scenarios.
- `node --test tools/harness/encounters.test.mjs tools/harness/mimic-visual.test.mjs`
  passed 21/21 focused tests, including the solid orchard rail and stopped
  charge impact. `node tools/harness/action-coop.mjs` passed 10/10 two-page
  authority checks. `npm run build` passed, with a Vite chunk-size
  advisory. `git diff --check` passed.
- Representative frames of the committed videos and the matched stills were
  inspected at the game camera. Hardware GPU timing, a physical ultrawide
  display run, and the user's aesthetic choice remain unverified.

## Evidence gate

- Record four full-HUD normal-input short fights: A/B at 16:9 and ultrawide.
  Initial spawn may be a fixture, but fighting, recovery, pickup, travel and
  sale use controls; no debug kill or teleport during acceptance.
- Include close and mid-distance stills of disguise, wind-up, lunge, hit and
  recovery. Compare equal states and camera positions.
- Report draw calls, geometry count, triangles and median/p95 measured frame
  time for both styles at both sizes. State viewport, DPR and renderer string;
  label headless SwiftShader figures as software rendering.
- Run the build, affected gameplay tests, and the real two-page authority
  checks. Preserve raw failures and do not relax assertions to make a pass.
- Commit and push the branch. Stop for the user's A/B choice before restyling
  Snapjaw or the island.

## Deferred Snapjaw findings

Snapjaw currently stacks cylinders, cones, ellipsoids and torus parts. Its
warning depends strongly on a large ground ring; most pose motion is in the
upper jaw and glow. Nonlethal hits have no distinct reaction and defeat hides
the mesh immediately. The existing orchard screenshot obscures much of it.
These are recorded issues, not changes in this branch.
