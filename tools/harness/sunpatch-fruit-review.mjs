// Authoring view of the actual cached meshes used by FruitRenderer and carry.
import { writeFileSync, mkdirSync } from 'node:fs';
import { withGame, ROOT } from './driver.mjs';
import path from 'node:path';

const out = path.join(ROOT, 'docs/evidence/sunpatch-finish/fruit');
mkdirSync(out, { recursive: true });
await withGame(async g => {
  await g.pause(true);
  const evidence = await g.page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { voxelFruitGeometry, VOXEL_FRUIT_SPECIES } = await import('/src/art/voxel/VoxelFruit.ts');
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#304957');
    const light = new THREE.DirectionalLight(0xfff3d9, 3.3); light.position.set(-3,6,6);
    scene.add(light, new THREE.HemisphereLight(0xe0f2ff,0x635443,2.2));
    const material = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8});
    const labels = [];
    VOXEL_FRUIT_SPECIES.forEach((species,i) => {
      const mesh = new THREE.Mesh(voxelFruitGeometry(species),material);
      mesh.position.set((i%5-2)*1.4, i<5? .85 : -.9, 0);
      mesh.rotation.y = -.4;
      scene.add(mesh);
      labels.push({species,triangles:mesh.geometry.getAttribute('position').count/3});
    });
    const camera = new THREE.PerspectiveCamera(40,16/9,.1,50);
    camera.position.set(0,2.2,9.5); camera.lookAt(0,0,0);
    const renderer = window.__GAME.renderer.renderer;
    renderer.autoClear = true;
    renderer.setViewport(0,0,1600,900);
    renderer.render(scene,camera);
    const image = renderer.domElement.toDataURL('image/png');
    material.dispose();
    return {image,labels};
  });
  writeFileSync(path.join(out,'fruit-family.png'),Buffer.from(evidence.image.split(',')[1],'base64'));
  writeFileSync(path.join(out,'manifest.json'),JSON.stringify({
    note:'Authoring fixture, near meshes. Row 1: apple, orange, watermelon, coconut, banana. Row 2: puffmelon, vinebomb, boulderplum, gluefruit, spikefruit.',
    ...{labels:evidence.labels}
  },null,2));
}, { width:1600,height:900,headless:true,quiet:true });
console.log(out);
