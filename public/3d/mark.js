/**
 * The VINTAGE mark in three dimensions: the serif V from the app icon, cut
 * in espresso ink and extruded, with its rule beneath, turning slowly on
 * cream. Made on Claude Design; this file is that scene, mounted onto a
 * <vintage-stage minimal>.
 *
 *   import { mountVintageMark } from '/3d/mark.js';
 *   await mountVintageMark(document.querySelector('vintage-stage'), { fill: 2.2 });
 *
 * `fill` sets how much of the stage the mark takes: the camera stands back
 * so the frame's half-height is `fill` × the mark's radius (larger number,
 * smaller mark). The mark spins about its own axis unless the visitor has
 * asked for reduced motion.
 */
export async function mountVintageMark(stage, options = {}) {
  const fill = options.fill ?? 2.2;
  const speed = options.speed ?? 0.35;
  const { THREE } = await stage.ready;

  // Outline traced from the icon (image px, y down), converted to metres centred on the mark.
  const S = 1 / 1000, CX = 629, CY = 652;
  const P = (x, y) => [(x - CX) * S, (CY - y) * S];

  const v = new THREE.Shape();
  v.moveTo(...P(333, 350));
  v.lineTo(...P(560, 350));
  v.lineTo(...P(560, 357));
  v.quadraticCurveTo(...P(497, 360), ...P(500, 400));
  v.lineTo(...P(651, 772));
  v.lineTo(...P(803, 440));
  v.quadraticCurveTo(...P(830, 362), ...P(748, 357));
  v.lineTo(...P(748, 350));
  v.lineTo(...P(925, 350));
  v.lineTo(...P(925, 357));
  v.quadraticCurveTo(...P(880, 360), ...P(852, 405));
  v.lineTo(...P(627, 890));
  v.lineTo(...P(601, 890));
  v.lineTo(...P(405, 420));
  v.quadraticCurveTo(...P(385, 362), ...P(333, 357));
  v.closePath();

  const bar = new THREE.Shape();
  bar.moveTo(...P(507, 947));
  bar.lineTo(...P(745, 947));
  bar.lineTo(...P(745, 956));
  bar.lineTo(...P(507, 956));
  bar.closePath();

  const depth = 0.07;
  const opts = { depth, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0015, bevelSegments: 3, curveSegments: 32 };
  const ink = new THREE.MeshStandardMaterial({ name: 'espresso', color: 0x473d35, roughness: 0.45, metalness: 0.15 });

  const group = new THREE.Group();
  group.name = 'vintage-mark';
  for (const [name, shape] of [['letter_v', v], ['underline', bar]]) {
    const g = new THREE.ExtrudeGeometry(shape, opts);
    g.translate(0, 0, -depth / 2);
    const m = new THREE.Mesh(g, ink);
    m.name = name;
    group.add(m);
  }

  stage.setObject(group);

  // Stand the camera back so the mark sits in the frame at the size asked for.
  const cam = stage._camera, ctr = stage._controls;
  const r = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere()).radius;
  const reframe = () => {
    const aspect = (stage.clientWidth || 1) / (stage.clientHeight || 1);
    const halfH = Math.max(fill * r, r / (0.45 * aspect));
    const dist = halfH / Math.tan((cam.fov * Math.PI) / 360);
    const dir = cam.position.clone().sub(ctr.target).normalize();
    cam.position.copy(ctr.target).add(dir.multiplyScalar(dist));
    cam.far = dist * 100;
    cam.updateProjectionMatrix();
    ctr.update();
  };
  reframe();
  new ResizeObserver(reframe).observe(stage);
  requestAnimationFrame(() => { stage.fit && stage.fit(); reframe(); });

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = performance.now();
  (function spin(t) {
    const dt = Math.min((t - last) / 1000, 0.1);
    last = t;
    if (!reduce && stage.isConnected) group.rotation.y += dt * speed;
    requestAnimationFrame(spin);
  })(last);

  return group;
}
