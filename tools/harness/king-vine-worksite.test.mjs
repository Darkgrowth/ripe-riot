import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importBundled } from './import-bundled.mjs';
const [{KingVine},{Terrain}]=await Promise.all([
  importBundled('src/boss/KingVine.ts','king-vine-worksite'),
  importBundled('src/world/Terrain.ts','king-vine-worksite-terrain'),
]);

test('default King Vine has ground-level starter-mallet access on every side of the worksite',()=>{
  const terrain=new Terrain(),world={terrain,kingMelonPos:new THREE.Vector3(8,38.8535,-62)};
  const boss=new KingVine();
  boss.init({get:()=>world,renderer:{scene:new THREE.Scene()}});
  boss.phase='recover';
  const [x,y,z]=boss.center;
  for(const[dx,dz]of[[3.5,0],[-3.5,0],[0,3.5],[0,-3.5]]){
    const floor=terrain.height(x+dx,z+dz),normal=terrain.normal(x+dx,z+dz);
    const eye=new THREE.Vector3(x+dx,floor+1.6,z+dz);
    const dir=new THREE.Vector3(x,y+1.7,z).sub(eye).normalize();
    assert.ok(normal.y>=Math.cos(45*Math.PI/180),'worksite approach must be stable walkable ground');
    assert.equal(boss.canStrike(eye,dir,'melee'),true,'starter mallet must reach the exposed core');
  }
  assert.deepEqual(world.kingMelonPos.toArray(),[8,38.8535,-62], 'grounding the guardian preserves its prize');
});
