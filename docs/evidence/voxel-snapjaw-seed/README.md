# Snapjaw seed readability follow-up

The user's normal-camera playtest showed the exposed seed reading as a large,
pale shape between the ivory fangs. The source used similarly light yellow for
both, pushed the seed forward, enlarged it during recovery, and gave it strong
emission. This pass changes only the opt-in voxel Snapjaw presentation:

- Amber, shaded seed colors separate it from the ivory teeth.
- The seed rests farther inside the mouth and stays smaller during recovery.
- A restrained recovery pulse still marks the strike window.

The encounter rules, hit window, collision, reward, shop and baseline polygon
Snapjaw are unchanged.

## Verified without taking over the live game

- The two focused seed checks failed before the implementation and passed after.
- The encounter, voxel Snapjaw and visual-mode suites passed 25/25 checks.
- `npm run build` and `git diff --check` passed. Vite still reports its
  existing large-chunk advisory.

The user's original playtest frame was inspected locally; it is not copied into
this repository. The adjusted seed still needs the user's normal-camera visual
review during a real Snapjaw recovery. Full capture/rescue/defeat/reward flow,
co-op play and worker ground contact were not exercised in this pass.
