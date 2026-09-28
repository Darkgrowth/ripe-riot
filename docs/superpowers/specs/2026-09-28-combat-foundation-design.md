# RIPE RIOT Combat Foundation Design

## Purpose and boundary

The player should be able to trust a mallet swing: a click with free hands starts visible motion, contact is checked while that motion crosses the aim, and the response explains a miss, cover, protected rind, or damage. The three existing threats should teach different responses to that same reliable attack. The broader Sunpatch art conversion waits for the user's combat review.

This work starts from `b3db5c2` and stays in a separate worktree. The open 5235 build, mouse, saves, and preview server remain untouched. No browser or game automation runs during the user's play session. Existing economy, progression, rescue, cargo ownership, and once-only rewards remain intact.

## Controls and state

With the Picking Mallet selected and hands free, left-click always begins a swing when ready. Fruit picking and contextual actions use E; right-click stows held fruit and has no empty-hand pickup fallback. With fruit held, left-click keeps its deliberate charge-and-throw behavior, right-click stows, and Q drops subject to Gluefruit restrictions. Combat never silently discards fruit or shows a striking tool through a held large fruit.

The mallet has one fixed-step state machine: wind-up, active contact, recovery. Timing constants drive the viewmodel and host cadence. One press near the end of recovery can buffer one following swing. Switching tools, carrying fruit, capture, downing, and opening a menu cancel the current attack and queued press. The visible swing completes even when it misses.

## Contact and authority

During the active portion, the mallet samples a small horizontal sweep ahead of the current eye/look transform. Each enemy has bounded contact volumes matched to its visible body. The contact calculation returns distance to the first surface; an eye close to or inside that body has distance zero. Ground, props, plants, and vehicles can block the route to that surface. These bounds are local to melee; Air Cannon range and projectile deflection retain their existing behavior.

One monotonically increasing swing ID identifies each committed local swing. The host rejects repeated or stale IDs, impossible origins, inactive/busy/carrying actors, and implausibly fast starts before it can award damage. A client may animate immediately, but only the host applies damage, defeat, payout, or rescue release. The host returns a compact outcome for feedback. An encounter in contact takes precedence over the distant guardian; one mallet swing cannot damage two targets.

The result is `whoosh`, `blocked`, `protected`, or `hit`. Audio and brief visual response use that result. A rejected/duplicate request never plays a confirmed impact. Diagnostic counters retain short reason codes for misses and rejections without flooding normal logs.

## Existing enemies

- Mimic keeps its committed charge, readable warning, and short stagger/punish window after a solid hit. The attack result should make that interruption clear.
- Snapjaw stays protected outside its recovery opening; contact on a closed jaw gives a clear resistant response. During recovery, the broad exposed mouth counts, without seed-only aim.
- Spitter's firing tell and shot origin must correspond to its actual projectile. Its recovery accepts a clear melee hit; Air Cannon deflection continues to work.

No health inflation, new enemy roster, boss redesign, or widened scenery pass belongs in this deliverable.

## Verification and review

Offline tests cover real mallet input/state behavior, moving and close targets, slope and range boundaries, obstruction, protected/open phases, rapid and buffered presses, cargo, cancellation, and host replay rejection. The production build must pass. Existing browser scenarios will be updated to the new controls but will not be run or used to drive the live game without permission. Visual feel, co-op latency, and hardware performance remain for manual playtest. Combat is presented for the user's review before any Stage 3 scenery work.
