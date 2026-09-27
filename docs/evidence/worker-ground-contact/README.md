# Worker ground contact evidence

The browser captures here predate the final collider fit. No browser or game
session was run after the user reported mouse interference; the final shape
change has **offline evidence only** and still needs a safe gameplay check.

- `before/`: first two-peer capture, before physical ragdoll pose transport and
  collider work. The flat contact/settling mesh penetrated terrain by about
  0.22/0.17 m.
- `after-flat/`: focused flat capture after the first hand/boot colliders. The
  flat contact and settling minima were about +0.04 m, but this single pose did
  not expose the later hover case.
- `after/`: broader flat/slope capture with physical pose transport and the
  original box contact shapes. Flat settling was +0.096 m above terrain in the
  remote mesh, and slope settling put `Backpack_1` about 0.130 m below terrain.
  The local and remote pose agreed within 0.022 m at slope settling, showing the
  remaining error was contact geometry rather than packet transport. This run
  stopped at its slope-settling assertion, so it has no slope recovery capture.
- `offline-contact-physics.json`: Rapier-only drops of the saved local mesh
  orientations against a flat plane and an 18.1-degree plane. Rotation was
  locked to isolate contact shape fit; these are **not jointed gameplay runs**.
  For the flat-settling right glove, the old box left +0.164 m versus +0.048 m
  with the rounded palm. The flat floor-contact backpack changed from -0.105 m
  to +0.053 m, and the slope-settling backpack changed from -0.122 m to
  +0.037 m with its fitted collider. A sole-only flat-settling sample still
  shows +0.099 m; in the captured full pose, the glove is the closer support.

`tools/harness/worker-ground-contact.mjs` generated the two-peer browser
captures. `tools/harness/worker-boot-envelope.mjs` measures the GLB mesh in each
physical body frame. `tools/harness/worker-contact-offline.mjs` reconstructs
the saved pose, and `tools/harness/worker-contact-physics.mjs` performs the
isolated Rapier drops. From the repository root, reproduce the saved drop
table without opening a browser or starting Vite:

```powershell
node tools/harness/worker-contact-physics.mjs docs/evidence/worker-ground-contact/after/report.json
```

The script prints the same 24 rows as `offline-contact-physics.json` for four
saved poses, three physical parts, and the old/fitted colliders. Run only the
offline tools until normal browser/game QA can resume without affecting the
user's mouse.
