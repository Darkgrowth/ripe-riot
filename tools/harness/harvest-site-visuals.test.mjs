import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const { EncounterVisual } = await importBundled('src/enemies/EncounterVisuals.ts','expedition-site-visuals');
test('dormant Mimic remains hidden after the existing rig updates; activation reveals it', () => {
  const visual = new EncounterVisual('mimic',new THREE.Scene(),'voxel');
  const state = {kind:'mimic',position:[0,0,0],heading:0,phase:'idle',health:3,timeLeft:0,baited:false,
    capturedVictimId:null,captureTimeLeft:0,dormant:true};
  visual.update(state,0,1/60);
  assert.equal(visual.root.visible,false);
  visual.update({...state,dormant:false,phase:'warn'},0,1/60);
  assert.equal(visual.root.visible,true);
  visual.dispose();
});
