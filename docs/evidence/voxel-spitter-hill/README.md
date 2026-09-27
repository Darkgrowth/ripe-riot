# Voxel Spitter and hill-path encounter pass

This successor to `9f47b7f` changes only the opt-in `?voxelPilot=1` visual path.
The Spitter now has a connected rooted stalk, a rear pressure bulb, a narrow
dark launch opening, and layered side leaves. The bulb swells while warning;
the head recoils on the phase that launches the shot, relaxes in recovery,
jerks on damage, and folds into a persistent wilted remnant on defeat. A loaded
defeated snapshot starts in the settled pose.

The flying shot is a pointed chartreuse voxel seed with a dorsal seam. Its
visible position follows the authoritative projectile position exactly, and
the head's muzzle origin matches the unchanged logical spawn at local Y=2.1.
The old polygon visual remains available outside the voxel pilot. The model's
timings, collision tolerance, damage, deflection, rewards, and snapshots were
not changed.

Around the fixed Spitter at world `(-31,-8)`, only existing dressing within
11m uses the voxel batches. The nearby Boulder Plum nest at `(-35,-11.5)` also
uses a low voxel leaf-and-stump shape. Seeded placements, path exclusions,
fruit sockets, collider metadata, harvest behavior, and baseline selection
are unchanged. Rocks in this mode were already voxelized; no rock placement
was added.

## Source-level geometry and draw objects

Counted by constructing each visual and summing mesh geometry index or vertex
counts; these are source-level counts, **not measured frame time**:

| Visual | Mesh draw objects | Triangles |
| --- | ---: | ---: |
| Voxel Spitter, including warning ring and lane | 6 | 7,718 |
| Previous polygon Spitter, including ring and lane | 20 | 606 |
| Voxel flying seed | 1 | 372 |
| Previous projectile and halo | 2 | 160 |

The new plant reduces mesh objects but raises triangle count. No FPS or GPU
timing is claimed.

## Verified offline

- The visual tests failed before implementation and pass after it.
- The encounter, Snapjaw, Spitter geometry/visual/environment, and opt-in mode
  suites pass **33/33** checks. They cover attack timing, projectile damage and
  deflection, pose transitions, loaded defeat, seed size/alignment, seeded
  dressing, fruit sockets, and unchanged collider metadata.
- `npm run build` and `git diff --check` pass. Vite reports its existing
  large-chunk advisory.

## Manual review still needed

No browser, game, mouse, pointer-lock, or preview-server interaction was run
during this pass because the user's port 5232 playtest was active. Normal-camera
appearance and attack legibility, a full Spitter fight and reward, co-op
presentation, and sustained performance remain unverified. Snapjaw's complete
fight, worker ground contact, and co-op also remain pending from earlier work.

To review this branch independently, run `npm run dev -- --host 127.0.0.1
--port 5233 --strictPort` from this worktree and open
`http://127.0.0.1:5233/?voxelPilot=1`. Port 5232 remains on the previous branch.
