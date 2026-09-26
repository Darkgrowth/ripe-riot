import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeBlockPatch, makeBlockWorker } from './BlockWorld.ts';

type View = 'normal' | 'close' | 'wide';
const canvas = document.querySelector<HTMLCanvasElement>('#proof-view')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9dcd8);
scene.fog = new THREE.Fog(0xa9dcd8, 24, 55);
const camera = new THREE.PerspectiveCamera(46, 1, .1, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .08;
controls.minDistance = 2;
controls.maxDistance = 32;
controls.maxPolarAngle = Math.PI * .47;
controls.minPolarAngle = .08;
scene.add(new THREE.HemisphereLight(0xfff4d0, 0x5e8f86, 2.1));
const sunlight = new THREE.DirectionalLight(0xffe2a3, 2.5);
sunlight.position.set(-5, 11, 7);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -15;
sunlight.shadow.camera.right = 15;
sunlight.shadow.camera.top = 15;
sunlight.shadow.camera.bottom = -15;
sunlight.shadow.camera.near = .5;
sunlight.shadow.camera.far = 32;
sunlight.shadow.bias = -.0003;
scene.add(sunlight);

const patch = makeBlockPatch();
scene.add(patch.group);
const worker = makeBlockWorker();
worker.mesh.position.set(0, patch.groundY(0, 2), 2);
worker.mesh.rotation.y = -.19;
scene.add(worker.mesh);

// Match study 01's camera, FOV and light for a fair style comparison.
const presets: Record<View, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  normal: { position: new THREE.Vector3(7.4, 5.4, 10.8), target: new THREE.Vector3(-.9, 1.05, -.4) },
  close: { position: new THREE.Vector3(2.3, 2.45, 5.4), target: new THREE.Vector3(0, 1.46, 2) },
  wide: { position: new THREE.Vector3(12.5, 12.6, 14.4), target: new THREE.Vector3(-.3, .8, -.6) },
};

function setView(view: View): void {
  camera.position.copy(presets[view].position);
  controls.target.copy(presets[view].target);
  controls.update();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });
  const query = new URLSearchParams(location.search);
  query.set('view', view);
  history.replaceState(null, '', `${location.pathname}?${query}`);
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
  button.addEventListener('click', () => setView(button.dataset.view as View));
});
function resize(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
const requestedView = new URLSearchParams(location.search).get('view') as View | null;
setView(requestedView && requestedView in presets ? requestedView : 'normal');
function animate(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
Object.assign(window, {
  __blockProofReady: true,
  __blockProof: {
    workerComponents: worker.connectedComponents,
    workerVoxels: worker.voxelCount,
    terrainVoxels: patch.voxelCount,
    drawObjects: patch.group.children.length + 1,
    setView,
  },
});
