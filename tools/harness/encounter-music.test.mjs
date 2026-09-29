import test from 'node:test';
import assert from 'node:assert/strict';
import { importBundled } from './import-bundled.mjs';
const audio = await importBundled('src/audio/AudioManager.ts','expedition-music');
const threat = (patch={}) => ({kind:'mimic',position:[0,0,0],phase:'warn',health:3,dormant:false,returning:false,...patch});
const trouble = (position, encounters, boss = null, safe = false) => audio.nearbyEncounterDanger?.(position,{encounters,projectiles:[]},boss,safe) ?? false;
test('actual nearby attack and recovery phases ask for existing trouble music', () => {
  for(const phase of ['warn','attack','stagger','recover']) assert.equal(trouble([0,0,4],[threat({phase})]),true);
  assert.equal(trouble([0,0,15],[threat({kind:'spitter'})]),true);
});
test('proximity alone, dormant, returning, defeated, far or safe-dock enemies stay out of combat music', () => {
  for(const patch of [{phase:'idle'},{dormant:true},{returning:true},{phase:'defeated',health:0}])
    assert.equal(trouble([0,0,4],[threat(patch)]),false);
  assert.equal(trouble([0,0,80],[threat()]),false);
  assert.equal(trouble([0,0,4],[threat()],null,true),false);
});
test('King Vine danger counts nearby but an idle/subdued/distant guardian does not', () => {
  for(const phase of ['telegraph','sweep','seed','recover'])
    assert.equal(trouble([0,0,20],[],{center:[0,0,0],phase,health:6}),true);
  for(const phase of ['idle','subdued'])
    assert.equal(trouble([0,0,20],[],{center:[0,0,0],phase,health:6}),false);
  assert.equal(trouble([0,0,60],[],{center:[0,0,0],phase:'seed',health:6}),false);
});
