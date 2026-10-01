import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../../src/enemies/FruitThreatContacts.ts').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
function tracker() {
  assert.equal(typeof module.FruitThreatContacts, 'function', 'physical cargo must have a swept threat bridge');
  return new module.FruitThreatContacts();
}
const threat = (kind = 'mimic', x = 0) => ({ kind, position: [x, 0, 0], phase: 'idle', dormant: false });
const fruit = (x, overrides = {}) => ({ id: 10, species: 'boulderplum', state: 'free',
  hasBody: true, stuck: false, position: [x, .6, 0], radius: .5,
  velocity: [30, 0, 0], ...overrides });

test('a fast fruit crossing a whole threat between samples produces one surface contact', () => {
  const t = tracker();
  assert.deepEqual(t.step(.016, [fruit(-5)], [threat()], () => false), []);
  const hits = t.step(.016, [fruit(5)], [threat()], () => false);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].fruitId, 10);
  assert.equal(hits[0].kind, 'mimic');
  assert.ok(hits[0].point[0] < -.9 && hits[0].point[0] > -2);
  assert.deepEqual(hits[0].direction, [1, 0, 0]);
});

test('a moving enemy crossing moving cargo is caught by relative motion', () => {
  const t = tracker();
  t.step(.1, [fruit(0)], [threat('mimic', -5)], () => false);
  assert.equal(t.step(.1, [fruit(.1)], [threat('mimic', 5)], () => false).length, 1);
});

test('resting overlap cannot drain enemy health in successive fixed steps', () => {
  const t = tracker();
  t.step(.016, [fruit(-3)], [threat()], () => false);
  assert.equal(t.step(.016, [fruit(-1)], [threat()], () => false).length, 1);
  for (let i = 0; i < 120; i++)
    assert.equal(t.step(.016, [fruit(-1)], [threat()], () => false).length, 0);
});

test('a new collision is allowed after separation and the contact cooldown', () => {
  const t = tracker();
  t.step(.016, [fruit(-3)], [threat()], () => false);
  t.step(.016, [fruit(-1)], [threat()], () => false);
  assert.equal(t.step(.1, [fruit(-4)], [threat()], () => false).length, 0);
  assert.equal(t.step(.1, [fruit(-1)], [threat()], () => false).length, 0);
  t.step(1, [fruit(-4)], [threat()], () => false);
  assert.equal(t.step(.016, [fruit(-1)], [threat()], () => false).length, 1);
});

test('a solid between the previous position and contact blocks the cargo hit', () => {
  const t = tracker();
  t.step(.016, [fruit(-5)], [threat()], () => false);
  assert.equal(t.step(.016, [fruit(5)], [threat()], () => true).length, 0);
});

test('the first touched enemy wins when cargo traverses two threats', () => {
  const t = tracker();
  const targets = [threat('snapjaw', 2), threat('mimic', -2)];
  t.step(.016, [fruit(-8)], targets, () => false);
  const hits = t.step(.016, [fruit(8)], targets, () => false);
  assert.deepEqual(hits.map(h => h.kind), ['mimic']);
});

test('a contact requires free moving host cargo and a live awake threat', () => {
  for (const overrides of [
    { velocity: [0, 0, 0] }, { state: 'carried' }, { hasBody: false },
    { stuck: true }, { species: 'apple' }, { position: [-5, 8, 0] },
    { velocity: [NaN, 0, 0] },
  ]) {
    const t = tracker();
    t.step(.016, [fruit(-5, overrides)], [threat()], () => false);
    const moving = fruit(5, overrides);
    if (overrides.position) moving.position = [5, 8, 0];
    assert.equal(t.step(.016, [moving], [threat()], () => false).length, 0);
  }
  for (const state of [{ dormant: true }, { phase: 'defeated' }]) {
    const t = tracker();
    t.step(.016, [fruit(-5)], [{ ...threat(), ...state }], () => false);
    assert.equal(t.step(.016, [fruit(5)], [{ ...threat(), ...state }], () => false).length, 0);
  }
});

test('Gluefruit has a lower contact speed and can stay recoverable after a hit', () => {
  const t = tracker();
  const glue = x => fruit(x, { species: 'gluefruit', radius: .3, velocity: [2.4, 0, 0] });
  t.step(.016, [glue(-3)], [threat()], () => false);
  const sample = glue(0);
  const hits = t.step(.016, [sample], [threat()], () => false);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].species, 'gluefruit');
  assert.equal(sample.state, 'free', 'contact detection cannot destroy or bank physical cargo');
});

test('a newly recreated body is seeded without inventing a long phantom trajectory', () => {
  const t = tracker();
  t.step(.016, [fruit(-5)], [threat()], () => false);
  t.step(.016, [], [threat()], () => false);
  assert.equal(t.step(.016, [fruit(5)], [threat()], () => false).length, 0);
});
