import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { build } from 'esbuild';

globalThis.THREE = THREE;
const bundled = await build({
  entryPoints: ['src/audio/AudioManager.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const { AudioManager, SOUND_NAMES } = await import(moduleUrl);

test('melee results play distinct, restrained sounds through the audio event listener', () => {
  const listeners = new Map();
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldStorage = globalThis.localStorage;
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {} };
  globalThis.localStorage = { getItem: () => null };
  try {
    const audio = new AudioManager();
    const played = [];
    audio.play = (name, opts) => played.push({ name, opts });
    audio.init({ bus: { on: (event, callback) => {
      listeners.set(event, callback);
      return () => {};
    } } });
    const onResult = listeners.get('tool:meleeResult');
    assert.equal(typeof onResult, 'function');
    for (const outcome of ['whoosh', 'blocked', 'protected', 'hit']) {
      onResult({ swingId: 1, outcome, target: 'snapjaw' });
    }
    assert.equal(played.length, 4);
    assert.equal(new Set(played.map(({ name }) => name)).size, 4);
    for (const { name, opts } of played) {
      assert.ok(SOUND_NAMES.includes(name), `${name} has a synthesized voice`);
      assert.ok(opts.volume > 0 && opts.volume <= 0.5, `${name} stays below full volume`);
    }
    assert.ok(played[0].opts.volume < played[3].opts.volume,
      'contact is more audible than empty air');
    onResult({ swingId: 2, outcome: 'hit', target: 'mimic', defeated: true });
    assert.notEqual(played.at(-1).name, played[3].name,
      'defeat is distinct from an ordinary damaging hit');
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    globalThis.localStorage = oldStorage;
  }
});
