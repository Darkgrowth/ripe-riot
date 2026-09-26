# Voxel art review after the 52-second gameplay clip

27 September 2026. The clip in “Analyze Fishing Game” supports continuing the moderately detailed voxel direction. This is a visual refinement of the opt-in `?voxelPilot=1` branch, not a claim that the rest of Sunpatch is converted.

## Changed in this pass

- The worker body alone now uses the four-color palette texture. Its sleeves and legs use solid team-tinted materials, removing the unintended rusty patches caused by sampling the body map without UVs. The editable Blender source and exported worker GLB were rebuilt together.
- Orchard tree variants now have spreading, upright and windswept crowns. Their leaf color follows lobe shape rather than fixed horizontal height bands. Existing fruit positions, sway and trunk colliders remain unchanged.

## Evidence

- [Front](worker/worker-front.png), [rear](worker/worker-rear.png), [walk](worker/worker-walk.png), [remote fallen pose](worker/worker-ragdoll.png), and [recovery](worker/worker-ragdoll-settled.png) captures, plus the [co-op motion video](worker/worker-coop-motion.webm). The [manifest](worker/manifest.json) records the remote pose's visual bottom about 7 cm over the terrain at one early frame; this does not establish local physics ragdoll contact.
- [Orchard path](orchard-path.png), [crowns](orchard-crowns.png), and [return view](orchard-return.png) at 1920×1080.
- [Full normal-input loop](normal-loop/1920x1080/normal-loop.webm) and [report](normal-loop/1920x1080/report.json): dock → warning → 28-point hit → recovery → three Mallet strikes → physical prize → E pickup → real sell pad → E sale. All nine beats were recorded with no page errors.

## Still visible

The worker's remote down pose still appears above the slope. This is the remote display pose, not proof of a settled local physics ragdoll defect. Palms, faceted bushes/rocks and the older shop remain visibly mixed with the voxel clearing on the return path. Those surrounding assets are the next area conversion; their appearance is not approved by this pass.

The captures can be repeated against this branch's isolated server with `RIPE_URL=http://127.0.0.1:5205`; the co-op harness also accepts `RIPE_OUT=docs/evidence/voxel-art-polish/worker` and the normal-input loop accepts `--out docs/evidence/voxel-art-polish/normal-loop/1920x1080`.
