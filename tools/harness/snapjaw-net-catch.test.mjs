import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';

const { MultiplayerAuthority } = await importBundled('src/net/MultiplayerAuthority.ts', 'snapjaw-net-catch');
const { CatchNet } = await importBundled('src/tools/Tools.ts', 'snapjaw-net-tool');
const { EncounterModel } = await importBundled('src/enemies/EncounterModel.ts', 'snapjaw-net-model');
const { EncounterSystem } = await importBundled('src/enemies/EncounterSystem.ts', 'snapjaw-net-system');

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
    state: 'active', busy: false, carrying: null, toolId: 'hand', hasPlayerPacket: true,
    flingId: 2 });
  net.authority = { holdingFor: () => ({ carried: -1, bought: new Set(['net']) }) };
  net.encounters = { flyingVictim: (victim, flingId) => victim === 'victim' && flingId === 2,
    canNetCatch: (victim, flingId) => victim === 'victim' && flingId === 2,
    finishNetCatch: (...args) => { caught.push(args); return true; } };
  net.sendSnapshot = () => {};
  return { net, sent, caught, cues };
}

const swing = { kind: 'netSwingStart', playerId: 'rescuer', rid: 1, swingId: 4 };
const catchIntent = { kind: 'netCatch', playerId: 'rescuer', rid: 2,
  catch: { victimId: 'victim', flingId: 2, swingId: 4,
    origin: [0, 1.7, 0], aim: [0, 0, 1] } };

test('host reserves one equipped, aimed catch and finishes it after victim acknowledgement', () => {
  const { net, sent, caught } = fixture();
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  net.applyIntent({ ...catchIntent, rid: 3 }, 'rescuer');
  assert.deepEqual(caught, []);
  assert.deepEqual(sent.filter(s => s.packet.t === 'netCaught').map(s => s.to), ['victim']);
  const command = sent.find(s => s.packet.t === 'netCaught').packet;
  assert.equal(command.flingId, 2);
  assert.ok(Number.isSafeInteger(command.catchId) && command.catchId > 0);
  assert.equal(sent.find(s => s.packet.kind === 'netCatch' && s.packet.rid === 2).packet.ok, true);
  net.onMessage({ t: 'netCatchAck', from: 'victim', catchId: command.catchId,
    flingId: 2, stopped: true });
  net.onMessage({ t: 'netCatchAck', from: 'victim', catchId: command.catchId,
    flingId: 2, stopped: true });
  assert.deepEqual(caught, [['victim', 2]]);
});

test('a host rescuer celebrates only after the victim confirms its flight actually stopped', () => {
  for (const stopped of [false, true]) {
    const { net, cues, sent, caught } = fixture();
    net.remotes.get('rescuer').targetPos.set(10, 0, 0);
    net.g.player.position.set(0, 0, 0);
    net.tools = { activeId: 'net', owned: new Set(['net']) };
    net.interaction = { carried: null };
    assert.equal(net.beginNetSwing(4), true);
    net.g.clock.elapsed = 10.13;
    assert.equal(net.hostTryNetCatch('host', catchIntent.catch), true);
    const catchId = sent.find(message => message.packet.t === 'netCaught').packet.catchId;
    assert.deepEqual(caught, []);
    assert.equal(cues.some(([name, cue]) => name === 'ui:toast'
      && cue.text === 'Teammate caught!'), false);
    net.onMessage({ t: 'netCatchAck', from: 'victim', catchId, flingId: 2, stopped });
    assert.equal(cues.filter(([name, cue]) => name === 'ui:toast'
      && cue.text === 'Teammate caught!').length, stopped ? 1 : 0);
    assert.equal(caught.length, stopped ? 1 : 0);
  }
});

test('a guest rescuer receives success only after the victim acknowledges its stop', () => {
  const { net, sent } = fixture();
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  const result = sent.find(message => message.packet.kind === 'netCatch')?.packet;
  assert.equal(result?.ok, true);
  const cues = [];
  const rescuer = new MultiplayerAuthority();
  rescuer.isHost = false; rescuer.hostId = 'host';
  rescuer.transport = { id: 'rescuer' };
  rescuer.g = { bus: { emit: (...args) => cues.push(args) } };
  rescuer.onMessage({ ...result, from: 'host' });
  assert.equal(cues.some(([name, cue]) => name === 'ui:toast'
    && cue.text === 'Teammate caught!'), false);
  const catchId = sent.find(message => message.packet.t === 'netCaught').packet.catchId;
  net.onMessage({ t: 'netCatchAck', from: 'victim', catchId, flingId: 2, stopped: true });
  const confirmation = sent.find(message => message.packet.t === 'netCatchConfirmed');
  assert.equal(confirmation?.to, 'rescuer');
  rescuer.onMessage({ ...confirmation.packet, from: 'host' });
  rescuer.onMessage({ ...confirmation.packet, from: 'host' });
  assert.equal(cues.filter(([name, cue]) => name === 'ui:toast'
    && cue.text === 'Teammate caught!').length, 1);
});

test('a failed victim stop leaves the flight available for another swing', () => {
  const { net, sent, caught } = fixture();
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  const first = sent.find(message => message.packet.t === 'netCaught').packet;
  net.onMessage({ t: 'netCatchAck', from: 'victim', catchId: first.catchId,
    flingId: 2, stopped: false });
  assert.deepEqual(caught, []);
  net.g.clock.elapsed = 10.5;
  net.applyIntent({ ...swing, rid: 3, swingId: 5 }, 'rescuer');
  net.g.clock.elapsed = 10.63;
  net.applyIntent({ ...catchIntent, rid: 4,
    catch: { ...catchIntent.catch, swingId: 5 } }, 'rescuer');
  const commands = sent.filter(message => message.packet.t === 'netCaught');
  assert.equal(commands.length, 2);
  assert.ok(commands[1].packet.catchId > first.catchId);
});

test('host ignores an acknowledgement from the wrong peer or for the wrong catch', () => {
  const { net, sent, caught } = fixture();
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  const catchId = sent.find(message => message.packet.t === 'netCaught').packet.catchId;
  for (const packet of [
    { from: 'rescuer', catchId, flingId: 2 },
    { from: 'victim', catchId: catchId + 1, flingId: 2 },
    { from: 'victim', catchId, flingId: 1 },
  ]) net.onMessage({ t: 'netCatchAck', stopped: true, ...packet });
  assert.deepEqual(caught, []);
  net.onMessage({ t: 'netCatchAck', from: 'victim', catchId,
    flingId: 2, stopped: true });
  assert.deepEqual(caught, [['victim', 2]]);
});

test('an acknowledgement after timeout cannot claim success or prevent a retry', () => {
  const { net, sent, caught, cues } = fixture();
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  const first = sent.find(message => message.packet.t === 'netCaught').packet;
  net.g.clock.elapsed = 11.5;
  net.expireNetCatchAcks();
  net.onMessage({ t: 'netCatchAck', from: 'victim', catchId: first.catchId,
    flingId: 2, stopped: true });
  assert.deepEqual(caught, []);
  assert.equal(cues.some(([name, cue]) => name === 'ui:toast'
    && cue.text === 'Teammate caught!'), false);
  net.applyIntent({ ...swing, rid: 3, swingId: 5 }, 'rescuer');
  net.g.clock.elapsed = 11.63;
  net.applyIntent({ ...catchIntent, rid: 4,
    catch: { ...catchIntent.catch, swingId: 5 } }, 'rescuer');
  assert.equal(sent.filter(message => message.packet.t === 'netCaught').length, 2);
});

test('a host change discards an unacknowledged catch from the former authority', () => {
  const { net, sent, caught } = fixture();
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  const catchId = sent.find(message => message.packet.t === 'netCaught').packet.catchId;
  assert.equal(net.pendingNetCatches.size, 1);
  net.encounters.clearBaitFlights = () => {};
  net.authority.reset = () => {};
  net.hostId = 'new-host';
  net.applyHost();
  assert.equal(net.pendingNetCatches.size, 0);
  net.onMessage({ t: 'netCatchAck', from: 'victim', catchId,
    flingId: 2, stopped: true });
  assert.deepEqual(caught, []);
});

test('a host victim confirms a guest rescue only if its own flight stops', () => {
  for (const stopped of [false, true]) {
    const { net, sent, caught } = fixture();
    net.g.player.position.set(0, .8, 2.8);
    net.g.player.catchableFlingId = 2;
    net.g.player.stopChaosFlight = () => stopped;
    net.encounters.flyingVictim = (victim, flingId) => victim === 'host' && flingId === 2;
    net.encounters.canNetCatch = net.encounters.flyingVictim;
    net.applyIntent(swing, 'rescuer');
    net.g.clock.elapsed = 10.13;
    net.applyIntent({ ...catchIntent,
      catch: { ...catchIntent.catch, victimId: 'host' } }, 'rescuer');
    assert.equal(sent.some(message => message.packet.t === 'netCaught'), false);
    assert.equal(sent.filter(message => message.packet.t === 'netCatchConfirmed').length,
      stopped ? 1 : 0);
    assert.equal(caught.length, stopped ? 1 : 0);
    assert.equal(sent.find(message => message.packet.kind === 'netCatch')?.packet.ok, stopped);
  }
});

test('a real numbered encounter flight passes through host validation and stops the victim peer', () => {
  const model = new EncounterModel([{ kind: 'snapjaw', position: [0, 0, 0] }], () => 0);
  model.setTargets([{ id: 'victim', position: [0, 0, 1.6] }]);
  let fling = null;
  for (let i = 0; i < 100 && !fling; i++)
    fling = model.step(.05).find(event => event.type === 'fling') ?? null;
  assert.ok(fling, 'the actual jaw model must create the catchable flight');
  const encounter = Object.create(EncounterSystem.prototype);
  encounter.model = model;
  encounter.currentTargets = [{ id: 'rescuer', position: [0, 0, 0] },
    { id: 'victim', position: [0, .8, 2.8] }];
  encounter.net = { authoritative: true };
  const { net, sent } = fixture();
  net.encounters = encounter;
  net.remotes.get('victim').flingId = fling.flingId;
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent({ ...catchIntent, catch: {
    ...catchIntent.catch, flingId: fling.flingId } }, 'rescuer');
  assert.equal(model.isFlying('victim', fling.flingId), true);
  const confirmation = sent.find(message => message.to === 'victim'
    && message.packet.t === 'netCaught');
  assert.equal(confirmation?.packet.flingId, fling.flingId);
  const stopped = [];
  const guest = new MultiplayerAuthority();
  const acknowledgements = [];
  guest.isHost = false; guest.hostId = 'host'; guest.transport = { id: 'victim',
    send: (packet, to) => acknowledgements.push({ packet, to }) };
  guest.g = { player: { stopChaosFlight: id => { stopped.push(id); return true; } },
    bus: { emit() {} } };
  guest.onMessage({ ...confirmation.packet, from: 'host' });
  assert.deepEqual(stopped, [fling.flingId]);
  assert.equal(acknowledgements[0]?.packet.stopped, true);
  net.onMessage({ ...acknowledgements[0].packet, from: 'victim' });
  assert.equal(model.isFlying('victim', fling.flingId), false);
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

test('host rejects a catch after the victim has landed but the encounter flight is still live', () => {
  const { net, caught, sent } = fixture();
  net.remotes.get('victim').flingId = 0;
  net.applyIntent(swing, 'rescuer');
  net.g.clock.elapsed = 10.13;
  net.applyIntent(catchIntent, 'rescuer');
  assert.equal(caught.length, 0);
  assert.equal(sent.some(message => message.packet.t === 'netCaught'), false);
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
  const stops = [], sent = [];
  const net = new MultiplayerAuthority();
  net.isHost = false; net.hostId = 'host'; net.transport = { id: 'victim',
    send: (packet, to) => sent.push({ packet, to }) };
  net.g = { player: { stopChaosFlight: id => { stops.push(id); return true; } },
    bus: { emit() {} } };
  net.onMessage({ t: 'netCaught', from: 'old-host', catchId: 1, flingId: 2 });
  net.onMessage({ t: 'netCaught', from: 'host', catchId: 1, flingId: 2 });
  assert.deepEqual(stops, [2]);
  assert.deepEqual(sent, [{ packet: { t: 'netCatchAck', catchId: 1,
    flingId: 2, stopped: true },
    to: 'host' }]);
});

test('the replicated flight and avatar position expose a nearby catch candidate', () => {
  const { net } = fixture();
  net.encounters.snapshot = () => ({ flights: [{ victimId: 'victim', flingId: 2, remaining: 1.2 }] });
  assert.deepEqual(net.flyingPeerAtHoop(new THREE.Vector3(0, 1.7, 2.8), 1.1),
    { id: 'victim', flingId: 2 });
  net.remotes.get('victim').state = 'captured';
  assert.equal(net.flyingPeerAtHoop(new THREE.Vector3(0, 1.7, 2.8), 1.1), null);
  net.remotes.get('victim').state = 'active';
  net.remotes.get('victim').flingId = 0;
  assert.equal(net.flyingPeerAtHoop(new THREE.Vector3(0, 1.7, 2.8), 1.1), null,
    'a landed player should not be shown as catchable');
});

test('player packets update the victim flight identity and clear it after landing', () => {
  const { net } = fixture();
  const remote = net.remotes.get('victim');
  net.isHost = false;
  net.ensureRemote = () => remote;
  const packet = { from: 'victim', x: 0, y: .8, z: 2.8, yaw: 0,
    h: 1.7, s: 'active', tool: 'hand', fi: 2 };
  net.applyPlayerPacket(packet);
  assert.equal(remote.flingId, 2);
  net.applyPlayerPacket({ ...packet, fi: 0 });
  assert.equal(remote.flingId, 0);
  net.applyPlayerPacket({ ...packet, fi: 2, s: 'downed' });
  assert.equal(remote.flingId, 0);
});

test('player packets send the local catchable flight identity', () => {
  const sent = [];
  const net = new MultiplayerAuthority();
  net.transport = { send: packet => sent.push(packet) };
  net.g = { player: { position: new THREE.Vector3(), yaw: 0,
    height: 1.82, state: 'active', catchableFlingId: 2 },
    has: name => name === 'book',
    get: () => ({ open: false }) };
  net.interaction = { carried: null };
  net.tools = { activeId: 'hand', owned: new Set() };
  net.fruitSys = { nodeSeq: 0 };
  net.purchasedList = () => '';
  net.shellOpen = () => false;
  net.sendPlayerPacket();
  assert.equal(sent[0].fi, 2);
});

test('Catch Net hoop warns when a flying teammate approaches its catch lane', () => {
  const { net } = fixture();
  net.encounters.snapshot = () => ({ flights: [
    { victimId: 'victim', flingId: 2, remaining: 1.2 }] });
  const tool = new CatchNet();
  tool.ctx = { game: { has: name => name === 'net', get: () => net },
    fruit: { fruits: new Map() }, interaction: {} };
  const hoop = new THREE.Vector3(0, 1.7, 2.8);
  net.remotes.get('victim').targetPos.z = 1.3;
  assert.equal(net.flyingPeerAtHoop(hoop, tool.catchRadius), null,
    'the warning should appear before the victim reaches the catch volume');
  assert.ok(tool.threat(hoop) > .5);
  net.remotes.get('victim').state = 'captured';
  assert.equal(tool.threat(hoop), 0);
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
