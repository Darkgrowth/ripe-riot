# RIPE RIOT connected asset overhaul — design

26 September 2026. Design for review. Base: `codex/mimic-style-comparison` at
`5c53928`. The existing A/B comparison and its B preview remain available.

## Intent and art rule

The whole game should look authored rather than assembled from unrelated
primitives. For an organic character, creature, hand, trunk, stalk, or root,
surfaces that are anatomically continuous must share a modeled junction and
deform together. A hidden overlap, a geometry merge that leaves disconnected
islands, or a larger part covering a gap does not satisfy this rule. The test
is the visible form at normal play distance and in motion, backed by source
mesh inspection where continuity matters.

Real construction and articulation retain real seams. A helmet, backpack,
tool, plank, roof panel, tooth, leaf, or opening jaw may be a separate mesh
when its attachment is physically legible. Separate parts are not a visual
defect by themselves; unsupported or accidental gaps and intersections are.
Use A's expressive polygonal look as the working direction. Do not convert
Sunpatch to voxels or treat the current A Mimic as finished art. Preserve the
bright island palette, recognizable produce, co-op comedy, route, combat,
fruit handling, and existing save data.

## Approaches considered

1. **Connected authored meshes with skeletons — selected.** Make a low-poly
   source mesh and editable rig for hero organic assets, export GLB, then let
   Three.js bones deform it. This directly addresses the mannequin and
   stick-root appearance. It costs more modeling and an asset-loading path,
   but gives deliberate silhouette, topology, and animation.
2. **Code-built continuous geometry.** A useful local option for simple
   trunks, stalks, or roots when the shape can be described as rings/branches
   with shared vertices. It is harder to art-direct a full worker or expressive
   creature this way. It must meet the same junction and animation standard.
3. **Merge or overlap the existing primitives.** This reduces object count
   but leaves the visible assembly and disconnected topology. It does not
   meet the user's requirement and is excluded as a character solution.

Voxel art is a separate art direction with no gameplay need established by
the comparison. B stays as comparison evidence, not the overhaul target.

## Rig and render architecture

Separate visual skin from gameplay physics. Keep the player's six Rapier
ragdoll bodies, five joints, collision layers, camera anchor, recovery rules,
and network state. Replace the six visible rigid body meshes in `PlayerRig`
with one continuous body surface driven by a small skeleton. Accessories may
remain separate, attached to bones. Define one named pose interface for torso,
head, arms, and legs. The ordinary co-op animation and ragdoll both feed that
interface; the ragdoll adapter converts body world transforms to the bones'
local transforms. Physics never depends on the render mesh. A failed visual
load must be reported clearly and keep gameplay running, but a fallback
primitive avatar is not acceptable as a shipped result.

The character's costume colors continue to use the current suit presets.
One authored body and palette assignment serve all presets, rather than five
divergent models. Preserve current size, facing, eye height, limb reach,
carry/tool attachment points, collision proxies, and readable co-op silhouette.
First-person hands are a separate view asset for framing, but each glove's
palm, fingers, thumb, and wrist must form a convincing connected hand. The
first-person and co-op models share costume shape and color language.

Use editable source assets with stable export settings. Runtime loading,
reuse, ownership, and disposal must be explicit so joins/leaves and repeated
knockdowns do not leak mesh, material, or skeleton resources. Do not put
render-specific geometry into host-authoritative combat or network packets.

## Rollout and stopping points

The broad rule needs a bounded first proof before many assets are rebuilt.
Order follows the most recent conversation's player-first recommendation:

1. **Player proof.** Model and rig the co-op worker as a connected organic
   body; fit helmet, gloves, boots, and pack as deliberate construction or
   clothing seams. Connect first-person hands. Show idle, walk, carry, tool
   use, knockdown, ragdoll, recovery, and two players with different suit
   presets. Stop for visual approval at game camera scale before applying
   the pipeline to enemies.
2. **Mimic Melon.** Continue A. A connected lower rind and tapered,
   weight-bearing roots replace cylinder legs and boot feet. Roots tuck under
   a low disguise, then plant and spread during reveal. A modeled rind split
   permits a separate hinged upper jaw; flesh, teeth, and stem have legible
   attachments. Preserve warning, lunge, stagger, recovery, defeat, collision,
   damage, rewards, and the B comparison. Stop for visual approval of idle
   disguise and the complete normal-control fight.
3. **Snapjaw and plant threats.** Give Snapjaw a connected rooted base and
   distinct moving jaw, visible hit response and non-instant defeat. Then
   inspect Spitter and King Vine stalk/root/branch junctions and repair only
   weak forms. Preserve their encounter timings and co-op authority.
4. **Whole-game cohesion audit.** Review every visible asset family at the
   gameplay camera: player, first-person tools/hands, enemies, residents,
   trees/plants, fruit, worksite props, buildings, and equipment. Record each
   family as accepted, repaired, or needing a separate art pass, with a
   screenshot and reason. Fix unsupported contacts and visible primitive
   assembly; retain already convincing constructed props. This is a visual
   audit and targeted redesign, not a blanket single-mesh conversion.
5. **Opening-route integration.** Recheck the normal fresh-save route from
   dock through Mimic, Snapjaw, Spitter, and King Vine, including earning and
   buying the Air Cannon, physical prize handling, rescue, and King Melon
   extraction. The comparison fixture's free equipment and temporary pad
   cannot stand in for this route.

Each completed stage is committed and pushed on the isolated branch. The
dirty `J:\RIPE RIOT` checkout, real save slot, and active B preview stay
untouched. No stage may claim user art approval from code or screenshot tests.

## Acceptance and verification

For each organic asset, inspect the source junctions and compare close-up and
normal-height game-camera views. Check front, side, rear, idle, moving,
articulated, and hit/downed states as applicable. A continuous surface must
remain convincing while it bends: no detached shoulder, floating finger,
root/fruit gap, collapsed skin, or obvious clipping. Use matching capture
positions when comparing against the current A and prior player assets.

Player checks cover rest pose, gait, carry, tool reach, ragdoll collision and
recovery, camera clearance, suit colors, first-person framing, remote joins,
two-page co-op pose synchronization, and repeated avatar creation/disposal.
Mimic and later enemy checks cover the full normal-control encounter and the
current host-authoritative combat assertions. Run affected tests, TypeScript
and production build, plus actual gameplay captures at the standard camera.
Use a quiet isolated browser session while the user is playing; no focus
stealing, reload, or control of their active preview. Measure draw calls and
frame times against the same scene/view settings; headless software results
remain distinct from real hardware performance. Report any unverified visual
or hardware gate explicitly.

The first implementation plan covers only the player proof. Later stages
start from its reviewed result, keeping this spec as the quality rule for
the full game.
