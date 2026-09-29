# Sunpatch: complete first expedition

The user adopted the latest **Analyze Fishing Game** conversation on 2026-09-29.
This is the implementation brief for that request, continuing `d5ae411`.

## Outcome

A player starts without our explanation, understands that King Melon is the goal,
provokes an interesting early harvest, earns and uses an upgrade, can recover from
a mistake, completes the harvest and returns to a saved chapter ending. Aim for
20–30 minutes of varied first-time play; measure it, never pad travel or prices
to meet a duration. A bot completing the route does not establish human pacing.

Keep the bright moderately detailed voxel world, current mallet lifecycle,
starter tools, $110 Air Cannon, optional ropes, banked-money protection and co-op
authority. Do not add an island timer, a new enemy roster or mandatory purchases.
Ordinary apples remain safe; the dock remains a place to regroup.

## Authored harvests

1. A conspicuous overloaded crop beside the existing orchard Mimic responds to
   the first deliberate harvest action with movement, sound and a warning. A
   second distinct action releases valuable physical fruit and wakes the Mimic.
   One blast or held button cannot skip both beats. Its pursuit stays local,
   returns home when abandoned, and never heals or repeats rewards by leashing.
2. Snapjaw guards a visibly desirable crop beside its mouth, reachable from the
   existing east approach. Real bait, recovery windows and teammate distraction
   remain useful; solo has time to act sequentially.
3. The hillside Boulder Plum beside Spitter provides a rolling harvest and a
   reason to use range, cover or the alternate shoulder. Actual solid geometry
   blocks seeds. Cannon-reflected seeds travel back through the world before
   damaging a threat; apparent cover is not cosmetic.

One host owns site stages, prize release and defeat payout. Stable site identities
and consumed/released ledgers survive save/load and host migration. Old saved
victories silently restore defeated enemies. Cleared sites stay peaceful.

## Recovery and clarity

Distinguish ordinary ragdolls from downing. After revival/checkpoint restoration,
give two seconds to get clear. Explain the unsecured cargo left behind and the
money/equipment retained after evacuation. A safe dock restores health without
charging or forcing a purchase. Show carried value/risk and escape/rescue controls.
Never reward a defeat twice, including after reload or retry.

## Chapter shell and ending

Use a small title/pause/results shell with New Expedition, Continue, controls,
existing sound settings and a visible development build ID. Pause freezes solo
simulation; co-op menus release local input without freezing other players.

King Melon completion moves the objective to **return to the dock**. An explicit
interaction at the dock boat settles Merv's ledger once, shows the earned
results, makes a visible dock change and saves completion. Continue exploring is
available afterward. There is no prompt to travel to an unimplemented island.

New/replay expeditions use a separate save slot and a fresh boot. Preserve the
legacy auto save. Continuing and returning to menus never silently replaces a
save. The diagnostic `?fresh` path must not overwrite the auto save on unload.
Existing completed saves can finish the dock settlement without another payout.

## Acceptance

Use the existing managed worktree and leave the user's 5243 preview untouched.
Test on a new isolated port/build with headless browser input, including ultrawide
views. Verify unit/model, save/ownership, multiplayer and production regressions.
Record a normal-input run from arrival through settlement: no teleport, equipment
grant, direct defeat or progression writes. Fixtures remain useful for edge cases,
but are reported separately. Inspect the actual gameplay presentation and report
remaining human pacing/visual uncertainties honestly.
