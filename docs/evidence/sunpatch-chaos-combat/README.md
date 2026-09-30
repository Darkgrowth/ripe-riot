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

## 1 October normal-input continuation

On the frozen isolated build, the 1712 × 634 normal-input run passed Mimic,
Snapjaw, Spitter, and King Vine. It cut all four vines with E, physically
pushed King Melon down the ridge into the receiver, and awarded the $9,500
extraction payout. The user reported Windows cursor interference during the
return walk, so the local Playwright process was stopped before dock settlement
and reload. The run has no final report and must not count as a complete loop.

| Beat | Gameplay-camera capture |
| --- | --- |
| Snapjaw guarding the Puff Melon cache | [Hill encounter](2026-10-01-snapjaw-hill.png) |
| King Vine subdued with ordinary mallet input | [Subdued boss](2026-10-01-king-vine-subdued.png) |
| Physical King Melon extraction and payout | [Delivered melon](2026-10-01-king-melon-extracted.png) |

The subdued-boss frame contains a black rectangular shape in the sky that
deserves a later visual inspection. The extraction frame proves payout but
not dock settlement or save/reload in this run.

## Snapjaw status and limits

A fresh normal-input solo run on the frozen build proved a 38-damage bite,
2.4-second hold, one numbered fling, active recovery without a downed state,
and no page errors. The player traveled roughly 5.7 m on the hill terrain.
The corrected victim camera faces the throw lane without filling the view with
teeth. In still captures Snapjaw itself is hard to see during the hold; that
readability remains a visual concern.

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
- `npm test`: 20/20 browser scenarios passed on the isolated build before the
  user reported cursor interference. Its last King Melon haul uses a placed
  fruit fixture, so it is not full ordinary-input route proof.
- Local browser input and pointer-lock checks are stopped during active play
  under [the project desktop rule](../../../AGENTS.md). The user directly
  confirmed that stopping local Playwright restored normal mouse behavior.
- The host's purchase ledger still imports client-reported saved equipment
  during co-op handoff. The tool checks above are gameplay authority checks;
  they do not prove resistance to a locally modified client claiming a saved
  purchase. A host-authenticated purchase handoff remains separate work.

Before calling the whole pass visually verified, demonstrate a host-confirmed
two-client Catch Net catch and finish dock settlement and reload with normal
input on an isolated remote runner. Review its gameplay-scale screenshots and
video as well as its counters.

The [solo proof](../../../tools/harness/snapjaw-solo-proof.mjs) and
[co-op proof](../../../tools/harness/snapjaw-coop-proof.mjs) scripts preserve
those routes. Both require an explicit `--allow-browser-input` flag and an
isolated `RIPE_URL`; neither flag makes local Windows browser input safe while
the user is playing.
The later two-client diagnostics found an actual hoop miss in the first setup.
With the rescuer moved into the throw lane, the observed victim had already
reported landing by the next swing, while the host's encounter flight window
was still open. A live teammate catch remains **unverified**. The updated
[co-op proof](../../../tools/harness/snapjaw-coop-proof.mjs) records flight IDs,
hoop distance, catch requests, host decisions, and acknowledgements.

The user confirmed that stopping local Playwright stopped its interference
with the physical mouse. The new [remote gameplay workflow](../../../.github/workflows/sunpatch-gameplay-proof.yml)
runs the same proof scripts on an isolated Linux runner and saves videos and
reports as artifacts. Its first run is pending; remote screenshots and video
need inspection before any visual completion claim.
