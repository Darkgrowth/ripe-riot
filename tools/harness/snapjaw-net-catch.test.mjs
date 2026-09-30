import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'snapjaw-net-catch');
const { CatchNet } = await importBundled('src/tools/Tools.ts', 'snapjaw-net-tool');

function fixture() {
  const sent = [], caught = [], cues = [];
  const net = new MultiplayerAuthority();
  net.isHost = true; net.connected = true;
  net.transport = { id: 'host', send: (packet, to) => sent.push({ packet, to }) };
  net.g = { clock: { elapsed: 10 }, player: { state: 'active',
    position: new THREE.Vector3(10, 0, 0), eyeHeight: 1.7, body: {} },
    physics: { raycast: () => null }, bus: { emit: (...args) => cues.push(args) } };
  net.remotes.set('rescuer', { targetPos: new THREE.Vector3(0, 0, 0), height: 1.7,
    state: 'active', busy: false, carrying: null, toolId: 'net', hasPlayerPacket: true });
  net.remotes.set('victim', { targetPos: new THREE.Vector3(0, .8, 2.8), height: 1.7,
    state: 'active', busy: false, carrying: null, toolId: 'hand', hasPlayerPacket: true });
  net.authority = { holdingFor: () => ({ carried: -1, bought: new Set(['net']) }) };
  net.encounters = { flyingVictim: (victim, flingId) => victim === 'victim' && flingId === 2,
    tryNetCatch: (...args) => { caught.push(args); return true; } };
  net.sendSnapshot = () => {};
  return { net, sent, caught, cues };
}

const swing = { kind: 'netSwingStart', playerId: 'rescuer', rid: 1, swingId: 4 };
const catchIntent = { kind: 'netCatch', playerId: 'rescuer', rid: 2,
  catch: { victimId: 'victim', flingId: 2, swingId: 4,
    origin: [0, 1.7, 0], aim: [0, 0, 1] } };

test('host confirms one equipped, aimed catch in the swing window and stops the victim', () => {
  const { net, sent, caught } = fixture();
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  net.applyIntent({ ...catchIntent, rid: 3 }, 'rescuer');
  assert.deepEqual(caught, [['victim', 2, 'rescuer']]);
  assert.deepEqual(sent.filter(s => s.packet.t === 'netCaught').map(s => s.to), ['victim']);
  assert.equal(sent.find(s => s.packet.t === 'netCaught').packet.flingId, 2);
  assert.equal(sent.find(s => s.packet.kind === 'netCatch' && s.packet.rid === 2).packet.ok, true);
});

test('host rejects stale flight, wrong swing, spoofed origin, distance, tool, and occlusion', () => {
  const variants = [
    { name: 'flight', patch: { catch: { ...catchIntent.catch, flingId: 1 } } },
    { name: 'swing', patch: { catch: { ...catchIntent.catch, swingId: 3 } } },
    { name: 'origin', patch: { catch: { ...catchIntent.catch, origin: [9, 1.7, 0] } } },
    { name: 'distance', setup: net => net.remotes.get('victim').targetPos.set(0, .8, 9) },
    { name: 'tool', setup: net => { net.remotes.get('rescuer').toolId = 'hand'; } },
    { name: 'occlusion', setup: net => { net.g.physics.raycast = () => ({ distance: .5 }); } },
  ];
  for (const { name, patch = {}, setup } of variants) {
    const { net, caught } = fixture();
    net.applyIntent(swing, 'rescuer');
    net.g.clock.elapsed = 10.13;
    setup?.(net);
    net.applyIntent({ ...catchIntent, ...patch }, 'rescuer');
    assert.equal(caught.length, 0, name);
  }
});

test('host refuses a self catch, late swing, and an unowned net', () => {
  const cases = [
    { setup: net => {}, intent: { ...catchIntent, catch: { ...catchIntent.catch, victimId: 'rescuer' } } },
    { setup: net => { net.g.clock.elapsed = 10.4; }, intent: catchIntent },
    { setup: net => { net.authority.holdingFor = () => ({ carried: -1, bought: new Set() }); }, intent: catchIntent },
  ];
  for (const { setup, intent } of cases) {
    const { net, caught } = fixture();
    net.applyIntent(swing, 'rescuer');
    net.g.clock.elapsed = 10.13;
    setup(net);
    net.applyIntent(intent, 'rescuer');
    assert.equal(caught.length, 0);
  }
});

test('only a current host confirmation damps the matching victim flight', () => {
  const stops = [];
  const net = new MultiplayerAuthority();
  net.isHost = false; net.hostId = 'host'; net.transport = { id: 'victim' };
  net.g = { player: { stopChaosFlight: id => { stops.push(id); return true; } },
    bus: { emit() {} } };
  net.onMessage({ t: 'netCaught', from: 'old-host', flingId: 2 });
  net.onMessage({ t: 'netCaught', from: 'host', flingId: 2 });
  assert.deepEqual(stops, [2]);
});

test('the replicated flight and avatar position expose a nearby catch candidate', () => {
  const { net } = fixture();
  net.encounters.snapshot = () => ({ flights: [{ victimId: 'victim', flingId: 2, remaining: 1.2 }] });
  assert.deepEqual(net.flyingPeerAtHoop(new THREE.Vector3(0, 1.7, 2.8), 1.1),
    { id: 'victim', flingId: 2 });
  net.remotes.get('victim').state = 'captured';
  assert.equal(net.flyingPeerAtHoop(new THREE.Vector3(0, 1.7, 2.8), 1.1), null);
});

test('one real swing requests a teammate catch when the aim hoop crosses their flight', () => {
  const requests = [];
  const game = { player: { state: 'active', eyePosition: new THREE.Vector3(0, 1.7, 0),
    lookDir: out => out.set(0, 0, 1) },
    has: name => name === 'net', get: () => ({
      flyingPeerAtHoop: () => ({ id: 'victim', flingId: 2 }),
      requestNetCatch: (...args) => { requests.push(args); return true; },
    }) };
  const tool = new CatchNet();
  tool.ctx = { game, fruit: { fruits: new Map() }, interaction: {} };
  tool.phase = 'swing'; tool.phaseT = .18; tool.swings = 4;
  tool.sweep(); tool.sweep();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].slice(0, 3), ['victim', 2, 4]);
});
