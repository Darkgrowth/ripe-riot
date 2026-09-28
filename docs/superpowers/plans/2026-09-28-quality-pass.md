# Sunpatch quality pass

## Evidence and boundaries

The user's 30-second playtest recording shows repeat rounded orchard canopies, a rigid mallet and small detached-looking gloves at normal play scale, and the Mimic crowding the camera. The Mimic is subdued during the clip, so damage does register; the visible strike and feedback still need work. The recording has no third-person worker view.

This branch starts from `7b45468` in a separate worktree. The user's 5236 game, browser tab, pointer, save, and server stay untouched. No browser or game automation runs during this pass. The existing first island, economy, fruit sockets, player rig contract, combat rewards, and co-op authority stay in place. New enemies and systems are outside scope.

## Work slices

1. **Melee feel:** queue one follow-up after contact instead of dropping recovery clicks; check host-authoritative contact across the active interval while allowing at most one result and damage per swing; keep the Mimic's lunge body clear of the camera; propagate a distinct defeat result and visible contact cue. Use offline lifecycle, encounter, and host tests.
2. **First-person hands and tools:** make the mallet head cross the aim area near the 0.18 s contact beat, with connected, chunkier arm/grip silhouettes and moving support hand. Preserve aim visibility, tool IDs, carry exclusion, swap behavior, and other tool poses. Add code-native pose assertions.
3. **Tree kit:** reshape the three existing voxel visual variants into broad pruned, tall open, and asymmetrical wind-shaped fruit-tree archetypes, then carry them through the Old Orchard, Hill Farm, and Cave Orchard. Preserve seeded plants, fruit attach points, colliders, sway, and instanced batching. Add socket/geometry/coverage checks.
4. **Third-person worker:** improve active idle and walk body pose with relaxed arm/elbow stance, slight weight shift, and clearer foot lift. Preserve the authored bone rig, standing height and boot calibration, network state, and physics ragdoll pose. Add active-pose invariants.

## Integration gates

Run focused offline tests after each slice, then all offline Node tests, typecheck, and production build. Review the complete branch diff before separate coherent commits and push. Compare the new geometry to the supplied game-scale recording using offline evidence where possible. Game feel, visual approval at runtime, co-op latency, and hardware performance remain pending until the user plays the new isolated build.
