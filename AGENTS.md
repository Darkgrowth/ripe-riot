# RIPE RIOT shared desktop

The user may be playing the game on this Windows desktop while Codex works.
During an active play session, keep their game tab and physical cursor untouched.

- Use an isolated worktree and port for code work.
- Do not run Playwright, CUA, or other browser or desktop input automation,
  including headless tests that click, move a mouse, or request pointer lock.
- Do not run `npm test` during active play; its scenario driver launches a
  browser. Use browser-free `node --test` checks and `npm run build` instead.
- Resume gameplay-camera browser checks only when the user says their play
  session is over. A separate port or a headless browser alone does not prove
  that the real cursor will remain unaffected on this machine.
