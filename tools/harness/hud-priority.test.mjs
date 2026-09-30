import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';

const { UIManager } = await importBundled('src/ui/UIManager.ts', 'hud-priority-ui');
const { IslandEventView } = await importBundled('src/ui/IslandEventView.ts', 'hud-priority-event');

test('the toast rail keeps only the two newest notices during a busy encounter', () => {
  const previousDocument = globalThis.document;
  const children = [];
  globalThis.document = {
    createElement: () => ({ className: '', innerHTML: '',
      remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); } }),
  };
  try {
    const ui = new UIManager();
    ui.els = { toasts: { appendChild(node) { children.push(node); } } };
    for (const label of ['old discovery', 'old warning', 'boss advice', 'latest action'])
      ui.toast(label);
    assert.deepEqual(children.map(node => node.innerHTML), ['boss advice', 'latest action']);
  } finally {
    globalThis.document = previousDocument;
  }
});

function eventFixture() {
  const event = { id: 1, kind: 'windfall', phase: 'active', remaining: 10,
    species: [], progress: 1, goal: 6, reward: 0, result: '', plants: [], at: [0, 0, 0] };
  const boss = { phase: 'telegraph', subdued: false, center: [0, 0, 0] };
  const ui = new UIManager();
  ui.els = { celebrate: { innerHTML: '', className: '' } };
  const progress = { chapterState: 'active' };
  const shell = { open: false };
  const view = new IslandEventView();
  view.hud = { hidden: false, classList: { toggle() {} } };
  view.title = { textContent: '' };
  view.detail = { textContent: '' };
  view.timer = { textContent: '' };
  view.leaves = { visible: false };
  view.g = {
    player: { position: { x: 4, z: 0 } },
    has: name => ['kingVine', 'legendary', 'progress', 'expeditionShell'].includes(name),
    get(name) {
      if (name === 'director') return { getPresentation: () => event };
      if (name === 'shop' || name === 'book') return { open: false };
      if (name === 'kingVine') return boss;
      if (name === 'legendary') return { phase: 'prepare' };
      if (name === 'ui') return ui;
      if (name === 'progress') return progress;
      if (name === 'expeditionShell') return shell;
      throw new Error(`unexpected ${name}`);
    },
  };
  return { view, event, boss, ui, progress, shell };
}

test('a nearby King Vine encounter takes priority over the Windfall card', () => {
  const { view, boss } = eventFixture();
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, true);
  boss.subdued = true;
  boss.phase = 'subdued';
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, false);
});

test('an idle King Vine does not hide a nearby fruit event', () => {
  const { view, boss } = eventFixture();
  boss.phase = 'idle';
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, false);
});

test('a milestone celebration temporarily takes priority over the Windfall card', () => {
  const { view, boss, ui } = eventFixture();
  boss.center = [200, 0, 0];
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, false);
  ui.celebrate('NEW FRUIT', 'MELON', 'discovery');
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, true);
});

test('a celebration does not hide the final seconds of a rush order', () => {
  const { view, event, boss, ui } = eventFixture();
  boss.center = [200, 0, 0];
  Object.assign(event, { kind: 'order', phase: 'active', remaining: 8,
    species: ['apple'], progress: 4, goal: 6, reward: 60 });
  ui.celebrate('BEST SALE YET', '$400', 'record');
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, false);
});

test('the return and results beats hide an old event card, then free play restores it', () => {
  const { view, boss, progress, shell } = eventFixture();
  boss.center = [200, 0, 0];
  progress.chapterState = 'return';
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, true);
  progress.chapterState = 'settled';
  shell.open = true;
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, true);
  shell.open = false;
  view.frameUpdate(0.016);
  assert.equal(view.hud.hidden, false);
});

test('final return also clears the old world event warning markers', () => {
  const { view, event, progress } = eventFixture();
  Object.assign(event, { kind: 'coconuts', phase: 'warning' });
  progress.chapterState = 'return';
  view.frameUpdate(0.016);
  assert.equal(view.marks.visible, false);
});
