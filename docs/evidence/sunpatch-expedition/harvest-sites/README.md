# Authored harvest site focused evidence

Target: isolated Vite development server `http://127.0.0.1:5245`, hardware Chromium headless. The live 5243 production game was not touched. These are focused fixtures, separate from the complete ordinary-input expedition run.

## Runtime result

`RIPE_URL=http://127.0.0.1:5245 RIPE_HARDWARE=1 node tools/harness/harvest-sites-runtime.mjs` passed 11/11 assertions with zero page exceptions. [Raw output](runtime.log) and [measured state](report.json) are retained.

Teleporting and aiming establish the fixture at the existing orchard. Both harvest actions are real keyboard E presses with synthetic input disabled: first E warns and leaves every melon attached; a second E after the warning yields a real 22 kg melon and wakes the Mimic. The cluster has three ordinary fixed-size melons, with no randomized jackpot variant.

The persistence fixture records a released prize, drops it with Q, restores the encounter save, retrieves the fruit, then teleports to the real sale pad and presses E. The normal sale pays $163 and records consumption. Restoring that consumed save twice leaves the prize absent and does not increase money. Debug pickup/teleport/save restoration are fixture operations; this is not an ordinary-input walk to the dock or a full-island run.

Screenshots: [before disturbance](orchard-before.png), [warning](orchard-warning.png), [active and carrying](orchard-active.png). Warning presentation was inspected at 1280x720. An initial dormant rig visibility override and incorrectly encoded punctuation were caught visually and corrected before these final captures.

## Model and physical checks

- `harvest-sites.test.mjs`: safe ordinary crops, two distinct actions, repeated blast-node calls cannot skip warning, released/consumed mirror and malformed state filtering.
- `harvest-fruit-gate.test.mjs`: actual FruitSystem detachment gate, one check per multi-fruit shake, physical body replacement on restore.
- `expedition-encounters.test.mjs`: dormant activation, bounded Mimic return without healing, silent persistent victories, cover, real reflected seed travel and impact.
- `expedition-cover.test.mjs`: real Rapier world trimesh through the production EncounterSystem collision query blocks Spitter acquisition and an already flying seed. This is a controlled physics fixture, not a claim that every hillside cover edge has been explored.
- `harvest-site-visuals.test.mjs`: dormant Mimic stays hidden even after its existing rig updates.

Existing combat and thrown-bait tests remain part of the focused regression run. No damage/recovery timings were extended. Full multiplayer transport and normal-input expedition acceptance are reported by the lead separately.
