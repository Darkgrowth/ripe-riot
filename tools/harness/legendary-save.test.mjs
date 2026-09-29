import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { LegendaryHarvest } = await importBundled('src/systems/LegendaryHarvest.ts',
  'legendary-save');

function fixture() {
  const harvest = new LegendaryHarvest();
  const removed = [];
  const body = {
    at: { x: 0, y: 20, z: 0 },
    spin: { x: 0, y: 0, z: 0, w: 1 },
    translation() { return this.at; },
    rotation() { return this.spin; },
    setTranslation(p) { this.at = { ...p }; },
    setRotation(q) { this.spin = { ...q }; },
    setBodyType() {},
    setLinvel() {},
    setAngvel() {},
  };
  harvest.body = body;
  harvest.mesh = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  harvest.ropes = { remove: id => removed.push(id) };
  harvest.vines = [1, 2, 3, 4].map(id => ({ id }));
  harvest.vineIdx = [0, 1, 2, 3];
  harvest.extractionPad.set(25, 4, -30);
  return { harvest, body, removed };
}

test('completed harvest reloads at its saved extraction location without holding vines', () => {
  const { harvest, body, removed } = fixture();
  harvest.deserialize({ phase: 'complete', completedAt: 42, payout: 11_780,
    position: [24, 8, -31], rotation: [0, 0.5, 0, Math.sqrt(0.75)] });
  assert.equal(harvest.phase, 'complete');
  assert.equal(harvest.lastPayout, 11_780);
  assert.deepEqual(body.translation(), { x: 24, y: 8, z: -31 });
  assert.equal(harvest.vines.length, 0);
  assert.deepEqual(removed, [1, 2, 3, 4]);
});

test('completed harvest records its final transform for the next session', () => {
  const { harvest, body } = fixture();
  harvest.phase = 'complete';
  harvest.lastPayout = 11_780;
  body.setTranslation({ x: 24, y: 8, z: -31 });
  body.setRotation({ x: 0, y: 0.5, z: 0, w: Math.sqrt(0.75) });
  const saved = harvest.serialize();
  assert.deepEqual(saved.position, [24, 8, -31]);
  assert.deepEqual(saved.rotation, [0, 0.5, 0, Math.sqrt(0.75)]);
  assert.equal(saved.payout, 11_780);
});

test('older completed saves put the melon on the extraction pad', () => {
  const { harvest, body } = fixture();
  harvest.deserialize({ phase: 'complete', completedAt: 42 });
  assert.equal(body.translation().x, 25);
  assert.equal(body.translation().z, -30);
  assert.ok(body.translation().y > 4);
  assert.equal(harvest.lastPayout, 9500);
});

function remoteFixture() {
  const f = fixture(), events = [];
  f.harvest.net = { authoritative: false };
  f.harvest.g = { bus: { emit: (name, payload) => events.push({name,payload}) },
    playerCamera: { addShake: () => events.push({name:'camera-shake'}) } };
  const state = { ph:5, vm:0, p:[24,8,-31], q:[0,0,0,1], req:2, dtc:0, paid:9500, gen:0 };
  return {...f, events, state};
}

test('late joining an already completed harvest mirrors the world without replaying cuts or victory', () => {
  const {harvest,body,events,state} = remoteFixture();
  harvest.applyNet(state);
  assert.equal(harvest.phase,'complete');
  assert.equal(harvest.vines.length,0);
  assert.equal(harvest.lastPayout,9500);
  assert.deepEqual(body.translation(),{x:24,y:8,z:-31});
  assert.deepEqual(events,[], 'a first snapshot is history, not four new cuts and a new victory');
});

test('a live remote extraction still celebrates once', () => {
  const {harvest,events,state} = remoteFixture();
  harvest.applyNet({...state,ph:4,paid:0});
  events.length=0;
  harvest.applyNet(state); harvest.applyNet(state);
  assert.equal(events.filter(e=>e.name==='legendary:complete').length,1);
  assert.equal(events.filter(e=>e.name==='ui:celebrate').length,1);
});
