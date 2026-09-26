# Stage 1 detailed voxel clearing proof

26 September 2026, branch `codex/detailed-voxel-clearing`. Run the pilot with `?voxelPilot=1`; ordinary gameplay and `mimicCompare=A/B` retain their baseline visual path. This is the first orchard clearing of the proposed whole-game overhaul, awaiting the user's visual decision before expansion.

## Playable route

The following videos use real keyboard and mouse input in fresh solo games. Their reports record `synthetic: false`, RTX 4070 Ti Direct3D11 WebGL, all nine required beats, and zero page errors or warnings. Both walks start at the dock, read the Mimic warning, take one 28-point hit, resume, defeat it with three Mallet strikes, pick up watermelon prize 686 with E, return to the real pad, and sell it with E. Health ends at 72; money rises from 0 to 185 ($80 defeat reward plus $105 sale).

| View | Continuous proof | Event/report proof | Selected stills |
| --- | --- | --- | --- |
| 1920×1080 | [38.88-second WebM](normal-loop/1920x1080-final/normal-loop.webm) | [report](normal-loop/1920x1080-final/report.json) | [orchard entry](normal-loop/1920x1080-final/02-orchard-entry.png), [warning video frame](normal-loop/1920x1080-final/02-warning-video-frame.png), [carried prize](normal-loop/1920x1080-final/06-prize-carried.png), [sale pad](normal-loop/1920x1080-final/07-real-sell-pad.png) |
| 3434×1270 | [40.58-second WebM](normal-loop/3434x1270-revised/normal-loop.webm) | [report](normal-loop/3434x1270-revised/report.json) | [orchard entry](normal-loop/3434x1270-revised/02-orchard-entry.png), [warning video frame](normal-loop/3434x1270-revised/02-warning-video-frame.png), [carried prize](normal-loop/3434x1270-revised/06-prize-carried.png), [sale pad](normal-loop/3434x1270-revised/07-real-sell-pad.png) |

The final sale frames report 244 calls/1.63 million triangles at 1920 and 248 calls/1.63 million triangles at ultrawide. Orchard combat peaks near 1.86 million scene triangles in these runs. These are renderer counters in headless Chromium on the named GPU, not sustained frame-rate measurements.

## Character and first-person presentation

- [Connected peer walk and ragdoll WebM](worker-in-game/worker-coop-motion.webm), with [front](worker-in-game/worker-front.png), [side](worker-in-game/worker-side.png), [rear](worker-in-game/worker-rear.png), [walk](worker-in-game/worker-walk.png), and [ragdoll](worker-in-game/worker-ragdoll.png) stills. [Manifest](worker-in-game/manifest.json) records one connected remote peer and no page errors. This is a visual co-op capture: synthetic remote movement and a debug ragdoll trigger were used to stage it. The walk is short and somewhat distant; the final fallen pose appears slightly above the slope. These frames do not conclusively establish planted feet or fully settled ground contact.
- [1920 Mallet](first-look/mallet-first-person-1920x1080.png), [1920 Air Cannon](first-look/aircannon-first-person-1920x1080.png), [ultrawide Mallet](first-look/mallet-first-person-3434x1270.png), and [ultrawide Air Cannon](first-look/aircannon-first-person-3434x1270.png). These are staged framing captures using the debug camera and tool grant. The Mallet, hands, carried watermelon, and normal combat are also visible in the playable-route videos. The Air Cannon was not earned or fired in those route recordings.
- [Editable worker source reviews](../detailed-voxel-worker/source-review/) include front, side, rear, and bent poses. Blender 5.2 validation confirms the 17-bone rig, one manifold connected `WorkerBody`, connected fitted sections and grip meshes, and tested bent-pose overlaps. Four named grip meshes export to the versioned hands GLB.

## Regression checks

- `node --test` on the focused detailed-voxel, worker, hands, mode, and Mimic tests: **44/44 passed**.
- `npm test`: **20/20 gameplay scenarios passed**.
- `npm run build`: TypeScript and Vite production build passed.
- Blender 5.2 `tools/assets/validate_detailed_voxel_worker.py`: passed.
- [Save round trip](save-roundtrip.json): baseline fresh save → voxel resume → baseline resume, with money 0 → 321 → 654, schema version 1, identical serialized system keys, and no browser errors.
- One independent reviewer inspected code and final captures. The reviewer found and verified fixes for the banana plant collider omission, detached Mimic eyes, and disconnected banana fronds. No further blocking finding remained.

## Later visual decision

The later 52-second gameplay clip led to a choice to continue the moderately detailed voxel direction; see the [27 September art review](../voxel-art-polish/README.md). This original Stage 1 evidence remains a record of the pilot. The first clearing still sits beside baseline assets elsewhere on the island. Continuous animation, full ragdoll contact, and sustained hardware performance need a closer user or hardware playtest; automated checks alone do not grant approval of each asset.
