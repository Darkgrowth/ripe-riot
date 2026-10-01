# Orchard Extraction Prototype

## Intent and authorization

The user asked to read the latest **Analyze Fishing Game** conversation and do its recommendation. Its latest proposal replaces linear enemy checkpoints with harvest, escalation, improvisation and physical extraction. This document implements its explicitly recommended first checkpoint: one dense clearing and a $500 extraction objective. The earlier chaos-combat route is the source of reusable mechanics; extending that route would not satisfy this request.

## Scope

A separate playable Orchard Run, reached from the game menu and a direct `?orchardRun=1` link. One compact orchard with a safe extraction crate, overloaded normal-fruit trees, several Puff Melons, Gluefruit, Boulder Plums, one Mimic and one Snapjaw. No boss, quest progression, tool shopping, permanent timer or new island content. Keep the approved rounded voxel art and physical fruit valuation. The full 15–25 minute island expedition redesign follows only after this slice is playtested.

Players start with mallet/hand picker, Air Cannon, Catch Net and basket. Number keys select the three active tools; E picks, shakes trunks and banks held/basket fruit at the crate. Loose fruit settling inside the crate also banks through the existing validated sale path. $500 is a team target, not a mandatory departure: bank smaller hauls, push for more, or finish at the crate whenever desired. Completion reports actual banked value and elapsed play, with an explicit replay action.

## World and rhythm

Use a compact Sunpatch orchard terrace with a short safe approach and several mutually visible harvest pockets. A nearby low bank lets Boulder Plums roll into the clearing. No distant legendary fruit or mission infrastructure is constructed in this mode. The extraction bin has an open approach, physical boards, a readable sign and visible cargo as value is secured. The safe zone is bounded and never a source of attacks.

Ordinary picking is quiet. Shaking loaded trees, detaching unusual fruit and useful cannon blasts create local agitation. Warn through shaking plants and rustling, then wake nearby threats. After a burst and a period without new disturbance, threats rest and pressure decays. No random rush-order payout. Killing threats does not bank money or advance the objective.

## Systemic interactions

Reuse host-owned Mimic launches, tree collisions, fruit scattering, Puff inflation, Snapjaw capture/fling, mallet interruption and acknowledged net rescue. Add swept free-fruit contact with enemies: a moving Boulder Plum damages and knocks an enemy; thrown Gluefruit temporarily gums/stuns it and interrupts capture. Air Cannon redirects/interrupts enemies in this mode without deleting them in one shot. Gluefruit stays recoverable cargo. Bound launch/stun effects and prevent repeated damage while a fruit overlaps a target. Enemy snapshot state communicates effects to peers.

## Authority, failure and persistence

The existing fruit authority owns picking, loose simulation and selling. A dedicated extraction ledger counts host accepted, deduplicated `fruit:sold` values. Snapshot it to guests and carry it through host promotion. Do not infer quota from wallet balance, enemy kills, debug money or locally predicted sales. Isolate mode storage keys and transport channels so different planting layouts never share IDs or overwrite the original expedition save.

Use existing downed/revival and limited solo recovery. On evacuation, unsecured held/basket cargo is forfeited through the authoritative destroy path; already banked money/cargo stays. Loose fruit still in the clearing can be recovered. End/replay controls preserve previous saved run until a deliberate new run starts.

## Acceptance

Browser-free checks cover bank counting/deduplication, quota boundaries, malformed snapshots, storage and room isolation, safe-zone boundaries, fruit swept contact and cooldown, host-only effects, interrupted capture and enemy state replication. Typecheck and production build pass. Remote Linux ordinary-input proof must pick real authored fruit, travel to the crate, bank it, verify no enemy cash reward, complete/finish and reload without duplicate value; co-op checks must show shared banking and net rescue. Render gameplay-scale images of the clearing, cargo, interaction and results. Report fixture-assisted mechanics separately from ordinary-input route proof. Human judgment decides fun, pacing and whether the full pivot is worth pursuing.

## Desktop constraint

No local Playwright, CUA, browser input, pointer lock automation or `npm test` while the user may be playing Warcraft. Use browser-free checks locally and remote Linux browser proof.
