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

| Solo beat | Gameplay-camera capture |
| --- | --- |
| Held player sees the throw lane and escape countdown | [Held lane](2026-10-01-snapjaw-held-lane.png) |
| Numbered solo fling, with 62 health remaining | [Solo fling](2026-10-01-snapjaw-solo-fling.png) |

A two-client run showed the host the held and flying teammate, but did **not**
initially confirm a timed Catch Net interception. Its first report's generic
"flight ended" result was insufficient. The isolated Linux proof later
confirmed a numbered flight, a real browser-input Catch Net swing, the host's
accepted request, the victim's `stopped: true` acknowledgement, and the
`Teammate caught!` host toast. The net hoop now glows when a flying teammate approaches it. The
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

## Initial checkpoint verification

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

The successful remote expedition described below closes dock settlement and
reload. Full visual approval, human pacing and physical-device feel remain
separate from its numerical gameplay proof.

The [solo proof](../../../tools/harness/snapjaw-solo-proof.mjs) and
[co-op proof](../../../tools/harness/snapjaw-coop-proof.mjs) scripts preserve
those routes. Both require an explicit `--allow-browser-input` flag and an
isolated `RIPE_URL`; neither flag makes local Windows browser input safe while
the user is playing.
The later two-client diagnostics found an actual hoop miss in the first setup.
With the rescuer moved into the throw lane, the observed victim had already
reported landing by the next swing, while the host's encounter flight window
was still open. Extending teammate detection to the Catch Net's existing
0.06–0.28-second active slice produced the confirmed catch on the remote
runner. The updated
[co-op proof](../../../tools/harness/snapjaw-coop-proof.mjs) records flight IDs,
hoop distance, catch requests, host decisions, and acknowledgements.

The user confirmed that stopping local Playwright stopped its interference
with the physical mouse. The new [remote gameplay workflow](../../../.github/workflows/sunpatch-gameplay-proof.yml)
runs on an isolated Linux runner and uploads reports and attempted gameplay
captures. [The successful co-op run](https://github.com/Darkgrowth/ripe-riot/actions/runs/36789764791)
has the catch and acknowledgement proof. Its post-action capture was inspected:
it renders the net and Snapjaw, but the camera points upward and the teammate
and success toast are outside the frame. It does not establish visual catch
readability. The harness now optionally freezes the rescuer view only after
the real success cue, then draws one frame for inspection.

## Complete remote expedition

[Run 36790610512](https://github.com/Darkgrowth/ripe-riot/actions/runs/36790610512),
commit `6e959de`, passed the expedition job in 437.92 seconds. The normal-input
route defeated all four enemies, cut all four vines, physically delivered King
Melon, settled at the dock, reloaded, and verified that settlement could not pay
twice. Money remained $9,883 after reload, including the $9,500 extraction
payout. The report's failure was null and its page-error list was empty.

Headless Linux mouse movement did not produce pointer-lock look deltas. The
expedition therefore runs headed Chromium inside Xvfb's virtual Linux display.
After boot, GPU draws are suppressed while real keyboard/mouse input, rAF,
fixed steps, physics, camera, UI and networking continue. The title Continue
button has a DOM fallback; gameplay movement and actions use browser input.
This closes route, reward and save validation. It is not continuous-rendering
or performance proof. No browser in this workflow accesses the user's Windows
desktop.

The same run exposed a Catch Net timing failure on a slow frame. Fixed systems
had shared the frame's completed elapsed time, and a newly pressed net received
one unelapsed timestep of phase credit. The fix gives each fixed substep its
own simulated timestamp and derives net phase from the recorded swing start.
Its regression exercises real input dispatch, Catch Net and host timing with
1-, 6- and 15-step frames. Guest nominations delivered during host wind-up are
also bounded and deferred until the host's active window; current flight,
equipment, geometry and line of sight are checked again before reservation.

## Fixed-clock and both catch roles verified

- `node --test`: all 410 browser-free tests passed on `f7f0e4d`.
- `npm run build`: passed; the existing large-chunk warning remains.
- [Run 36902554188](https://github.com/Darkgrowth/ripe-riot/actions/runs/36902554188):
  the full expedition and 20/20 browser scenarios passed on that runtime.
- [Run 36904955417](https://github.com/Darkgrowth/ripe-riot/actions/runs/36904955417),
  `4f6753e`: host and guest rescuers each passed all ten checks, including their
  actual host/guest roles. Both caught numbered flight 1 with real input swing
  3 and displayed the success cue only after the victim's flight stopped. The
  remote victim acknowledged its stop; the host victim stopped locally before
  confirming the guest's catch. The 20/20 scenario job also passed.

| Rescuer role | Inspected capture |
| --- | --- |
| Host catches guest | [Host net catch](2026-10-01-snapjaw-net-catch.png) |
| Guest catches host | [Guest net catch](2026-10-01-snapjaw-guest-net-catch.png) |

The inspected 1712 × 634 captures show the teammate inside the hoop, Snapjaw
behind them, and the success toast. The test pauses only after confirmed stop
and renders that preserved view once. It stages position, equipment and aim,
then requires real mouse input and the normal host validation. Software WebGL
reported four GPU readback warnings; this is not a performance benchmark.

Remote snapshot delay and a browser-generated recenter required a later
interception point for the guest fixture. Staged aim clears only camera deltas;
primary input, physics and authority remain unchanged. These runs retain strict
catch/stop/confirmation gates; an ordinary landing never counts as a catch.
Condensed durable results live in
[remote-proof-summary.json](remote-proof-summary.json).

## Final delivery

All four jobs in [run 36904955417](https://github.com/Darkgrowth/ripe-riot/actions/runs/36904955417)
passed on `4f6753e`: full expedition, host catch, guest catch, and 20/20 browser
scenarios. The final expedition passed all 26 route beats in 438.55 seconds,
retained $9,883 through reload, refused a repeat payout, and reported no page
errors. Both latest co-op captures above were visually inspected.

The production runtime was unchanged after its 410-test and build pass;
subsequent commits refine only the remote proof fixture. Local Windows browser
automation stayed off throughout this continuation. A frozen, browser-free
preview server is available at <http://127.0.0.1:5284/> while this local session
remains open. The user can open it manually when ready.

Human pacing, comedic impact and physical-device feel remain unverified. The
earlier boss-frame rectangle and held-player enemy visibility remain recorded
visual polish notes; these checks do not claim the user's final art approval.
