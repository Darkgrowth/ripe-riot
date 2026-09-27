# Snapjaw clearing voxel candidate

This focused successor to `2ddfbfe` keeps the existing encounter model, reward,
collision, save state and co-op authority. Only the opt-in `?voxelPilot=1` mode
uses the new Snapjaw visual. The baseline visual remains on its previous path.

The creature now has a connected tapered stalk and planted roots, broad leaf
jaws, dark mouth lining, stepped fangs, ember eyes and an exposed seed. Its pose
opens and pulls back during the warning, closes through the bite, opens in
recovery, jerks on a nonlethal hit, and folds into a persistent wilted remnant
after defeat. A defeated state loaded from a save or network snapshot starts in
that settled visual pose. A few shallow, noncolliding roots tie the base to the
voxel foliage already present around the hill path. Merv's large board again
names the shop; a separate selling instruction hangs over the actual pad.

## Verified without browser control

- `npm run build` passed, with the existing large-chunk warning.
- `node --test --test-concurrency=1 tools/harness/encounters.test.mjs tools/harness/voxel-snapjaw.test.mjs tools/harness/voxel-visual-mode.test.mjs`
  passed 23/23 checks, including Snapjaw bait, capture, rescue, defeat,
  connected geometry and voxel pose transitions.
- `git diff --check` passed.

## Manual playtest pending

No browser capture, scripted game control, normal-input route, co-op session or
GPU timing was run for this pass. The user can review the opt-in build at the
preview URL supplied with this branch. Follow the orchard and hill path to
Snapjaw, then check its warning, bite, exposed recovery, hit reaction and
defeat at the normal camera. The worker ground-contact candidate also still
needs a normal gameplay fall, settlement and recovery review. These are visual
acceptance checks, not claimed results of the non-browser tests above.
