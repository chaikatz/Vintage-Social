/**
 * The VINTAGE mark for the app.
 *
 * The iOS app cannot run the web stage directly, so it carries this scene
 * inside a small transparent web view instead: the same three.js, the same
 * V (buildVintageMark, from mark.js), the same light and turn as on
 * vintagesocial.app — bundled into one file by scripts/build-mark.mjs, so
 * it works with no network at all. Nothing is fetched; nothing leaves the
 * view except one word to the app: "ready", once the first frame is drawn.
 *
 * The page's <body data-fill="…"> sets how much of the view the mark takes
 * (the frame's half-height is fill × the mark's radius), as `fill` does on
 * the web stage.
 */
import * as THREE from './vendor/three.module.js';
import { buildVintageMark, spinVintageMark } from './mark.js';

const fill = parseFloat(document.body.dataset.fill) || 1.3;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);

// The web stage's studio light, without the ground shadow the minimal stage hides.
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 7, 5);
scene.add(key);
const soft = new THREE.DirectionalLight(0xfff4e6, 0.5);
soft.position.set(-5, 3, -4);
scene.add(soft);

const group = buildVintageMark(THREE);
// Start where the still (assets/brand/mark-v.png) was taken, so a swap from it is seamless.
group.rotation.y = 0.42;
scene.add(group);

const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());

const fit = () => {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const halfH = Math.max(fill * sphere.radius, sphere.radius / (0.45 * camera.aspect));
  const dist = halfH / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(sphere.center.x, sphere.center.y, sphere.center.z + dist);
  camera.lookAt(sphere.center);
  camera.near = Math.max(dist / 100, 0.01);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
};

// For looking at the scene from outside (tests, a debugger); nothing in the app reads it.
window.__vintageMark = { renderer, camera, group, sphere };
fit();
window.addEventListener('resize', fit);

let told = false;
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  if (!told) {
    told = true;
    // Tell the app the mark is drawn, so it can show this view in place of the still.
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('ready');
  }
});

// Turn only while the view is on screen; a hidden page should not spend the battery.
let visible = !document.hidden;
document.addEventListener('visibilitychange', () => {
  visible = !document.hidden;
  renderer.setAnimationLoop(visible ? () => renderer.render(scene, camera) : null);
});
spinVintageMark(group, 0.35, () => true);
