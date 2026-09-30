# Sunpatch structured chaos evidence

## Gameplay-scale orchard pass

An isolated 1712 × 634 normal-input session walked from the dock into the
orchard, investigated the suspicious crop, took one Mimic hit, recovered,
struck its opening, detached and discovered Puff Melon, subdued the Mimic,
carried the prize to the real sell pad, and bought an Air Cannon. The run then
subdued Snapjaw and Spitter and reached King Vine; browser navigation ended
the run before the final extraction. See [the timestamped report](orchard-run-report.json).

| Beat | Capture |
| --- | --- |
| Deliberate harvest warning | [Orchard warning](orchard-warning.png) |
| Mimic collision with physically scattered fruit and discovered Puff Melon | [Mimic impact](mimic-impact.png) |
| Mimic defeat and harvest pressure Windfall cue | [Mimic defeated](mimic-defeated.png) |

These frames were captured before the later Snapjaw camera, throw-arc, held
avatar, Catch Net, and HUD changes. They verify the orchard shift, not those
later changes.

## Snapjaw status and limits

A separate normal-input solo run on an isolated static build proved a 38-damage
bite, 2.4-second hold, one numbered fling, active recovery without a downed
state, and no page errors. Gameplay-scale inspection found that the victim's
view filled with teeth and the throw traveled only about 3 m. The camera now
faces the aimed lane and the launch has a higher arc; these fixes have passed
browser-free tests and build but have **not** received a new gameplay-camera
capture because browser automation was stopped during the user's active play
session.
An actual Rapier player capsule on flat ground now reaches a 1.71 m apex and
travels 5.79 m with the new launch. The authored hill-farm terrain and camera
still need normal-play inspection.

A two-client run showed the host the held and flying teammate, but did **not**
confirm a timed Catch Net interception. Its first report's generic
"flight ended" result was insufficient; the actual `Teammate caught!` host
confirmation did not occur. The authoritative catch path passes focused
network tests, including a real numbered encounter flight through host swing
validation to the victim's stop packet, while normal-input co-op catch remains
unverified. The net hoop now glows when a flying teammate approaches it. The
host also requires the victim's current player packet to name that same live
flight, preventing a catch confirmation after the victim reports landing.
The host now reserves the flight until the victim acknowledges that its actual
motion stopped. A failed or expired acknowledgement produces no success cue
and leaves a still-live flight available for another swing.

The host now checks a remote Tree Shaker or Air Cannon request against the
peer's active state, equipped tool, ledger ownership, range and authored tool
cadence before changing fruit physics. One cannon blast can shake each nearby
plant once at the strength that shot earned, and its enemy or King Vine hit
must align with that blast. Two immediate full-charge shots remain valid when
the cannon still has enough recharge. Air Cannon shots add harvest pressure
only near attached or free fruit. If Snapjaw finds no dry, clear landing at
all, it now emits a release event rather than silently retiring the flight.
These changes have browser-free test and build proof only.

## Verification at this checkpoint

- `node --test` over all browser-free `*.test.mjs` files: 393 passed.
- `npm run build`: passed with the existing large-chunk warning.
- `npm test`: 19/20 scenarios passed before the save assertion was corrected.
  The King Melon check compared the restored position against a point recorded
  four simulated seconds before saving, so normal pad settling counted as a
  load error. It now compares against the position at save time; this corrected
  browser scenario still needs a rerun after active play.
- Browser input and pointer-lock checks are paused during active play under
  [the project desktop rule](../../../AGENTS.md). An isolated port and
  headless mode did not establish safe physical-cursor isolation here.
- The host's purchase ledger still imports client-reported saved equipment
  during co-op handoff. The tool checks above are gameplay authority checks;
  they do not prove resistance to a locally modified client claiming a saved
  purchase. A host-authenticated purchase handoff remains separate work.

Before calling the whole pass visually verified, capture the updated Snapjaw
hold and throw at gameplay scale, demonstrate a host-confirmed two-client
Catch Net catch, and complete the expedition through King Melon with normal
input when the user's play session is over.

The [solo proof](../../../tools/harness/snapjaw-solo-proof.mjs) and
[co-op proof](../../../tools/harness/snapjaw-coop-proof.mjs) scripts preserve
those routes. Both require an explicit `--allow-browser-input` flag and an
isolated `RIPE_URL` so they cannot be started accidentally during play.
The co-op proof now records the catch request, host decision, victim
acknowledgement, current flight IDs, swing window and geometry if the timed
interception misses again. Its
updated diagnostics have passed syntax validation but have not been run while
the user's play session is active.
The [full ordinary-input route](../../../tools/harness/sunpatch-expedition-playthrough.mjs)
also requires explicit browser-input opt-in. Its earlier chaos run lost the
page's execution context while approaching King Vine; the report does not
establish why it navigated. Run it against a frozen isolated build for the
remaining finale evidence after active play ends.
