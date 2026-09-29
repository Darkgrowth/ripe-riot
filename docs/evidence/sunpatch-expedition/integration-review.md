# Independent integration review

Review against `d5ae411` by the integration reviewer. The initial production
co-op used `main-d39M4TwA` on isolated port 5244; the lead reran all 20 checks
on the final `main-C44TejzQ` build, also passing. No source changes resulted
from this independent review.

- Real BroadcastChannel co-op: 20/20 checks, no browser errors. Promotion before
  dock settlement retained 10437 lifetime earnings, 17 fruit sold, 320 best sale
  and 9500 King Melon payout. Settling twice did not pay again. See `coop.log`.
- Painted hill route, actual 1.5 m collision triangles across +/-1 m walking
  width: maximum 45.24 degrees, below the controller's 53 degree limit.
- Western ravine walkout: actual collision centerline maximum 44.57 degrees;
  +/-0.6 m maximum 47.43 degrees. The core is walkable.
- Its steep outside margin is inherited. At (-19.088, -62.410), analytical
  slope changed from 63.56 to 62.70 degrees. At the -1 m edge near
  (-19.29, -57.99), a collision triangle changed from 57.96 to 60.66 degrees;
  this edge was already outside the climb limit. Stay on the worn track.
- Grounded King Vine and the pinned original melon anchors showed no concrete
  regression. The four anchor feet and critical drop/landing height samples
  match the previous rig; see `terrain-anchor-regression.json`.

This review complements the ordinary-input expedition recording. Numeric
slopes and fixtures alone do not establish a complete playable route or
subjective visual/fun approval.

## Final ridge and receiving-area review

The subsequent real-input run exposed a legitimate slow-cut landing on the
northern ridge. A marked western farm access path and visible timber receiver
now support that physical recovery. An independent read-only review found no
new blocker in the receiver, separate continuous extraction dwell, submerged
retry or snapshot/promotion handling. Extraction remains radius 15 with the
original vertical bounds. Promotion during failure restarts the bounded
25-second retry, without paying again.

The ridge route's actual Float32 collision triangles peak at 44.37 degrees
across +/-1.35 m (38.63 degrees on the centerline), below the 53-degree climb
limit. Recovery, save and route checks passed 16/16. The lead's two additional
real-physics checks passed: a 2600 kg sphere stops inside the extraction volume,
and the game's standing capsule passes beneath the rails on the eastern exit.

An additional promotion regression follows real host failure, snapshot,
client adoption, authority promotion and game-time retry through the production
methods. It confirms one regrowth after 25 seconds, the actual King Vine stays
subdued, and neither money nor a completion event repeats. Recovery tests are
8/8; the complete offline suite is 279/279.
