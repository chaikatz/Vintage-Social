/**
 * The VINTAGE mark in three dimensions: a Polaroid — paper card, black
 * photo window, the word "vintage" set in it, and an orange seven-segment
 * date stamp in the corner, slanted like a camera's LED imprint. Made on
 * Claude Design; this file is that scene, mounted onto a <vintage-stage>.
 *
 *   import { mountVintageMark } from '/3d/mark.js';
 *   await mountVintageMark(document.querySelector('vintage-stage'));
 *
 * The wordmark's glyphs are cut from a real font (Tinos, metric-compatible
 * Times) with opentype.js, which the page loads as a plain script first.
 */
export async function mountVintageMark(stage, options = {}) {
  const fontUrl = options.fontUrl || '/3d/Tinos-Regular.ttf';
  const stampDigits = String(options.stamp || '16');
  const distance = options.distance || 6.0;
  const spin = options.autoRotateSpeed ?? 0.8;

  const { THREE } = await stage.ready;
  const opentype = window.opentype;
  if (!opentype) throw new Error('opentype.js must be loaded before the mark');
  const serif = opentype.parse(await (await fetch(fontUrl)).arrayBuffer());

  const cream = new THREE.MeshStandardMaterial({ name: 'cream', color: 0xF3EBDD, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  const paper = new THREE.MeshStandardMaterial({ name: 'paper', color: 0xF4F2EC, roughness: 0.85, metalness: 0 });
  const emulsion = new THREE.MeshStandardMaterial({ name: 'emulsion', color: 0x080808, roughness: 0.55, metalness: 0 });

  function shapesFor(font, text) {
    const sp = new THREE.ShapePath();
    font.getPath(text, 0, 0, 1000).commands.forEach((c) => {
      if (c.type === 'M') sp.moveTo(c.x, -c.y);
      else if (c.type === 'L') sp.lineTo(c.x, -c.y);
      else if (c.type === 'Q') sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'C') sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
      else if (c.type === 'Z') sp.currentPath.autoClose = true;
    });
    return sp.toShapes();
  }

  function glyphMesh(font, text, material, name, depth) {
    const geo = new THREE.ExtrudeGeometry(shapesFor(font, text), {
      depth, bevelEnabled: true, bevelThickness: depth * 0.05,
      bevelSize: depth * 0.04, bevelSegments: 3, curveSegments: 24,
    });
    geo.computeBoundingBox();
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    return m;
  }

  // --- the Polaroid: white card, black photo window, the wordmark inside it ---
  const CARD_W = 2.60, CARD_H = 3.14, CARD_D = 0.09, PHOTO = 2.16, PHOTO_Y = 0.26;

  const card = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, CARD_D), paper);
  card.name = 'polaroid-card';

  const photo = new THREE.Mesh(new THREE.BoxGeometry(PHOTO, PHOTO, 0.02), emulsion);
  photo.name = 'photo-window';
  photo.position.set(0, PHOTO_Y, CARD_D / 2 + 0.001);

  const word = glyphMesh(serif, 'vintage', cream, 'wordmark', 60);
  {
    const b = word.geometry.boundingBox;
    const minX = b.min.x, maxX = b.max.x;
    // The x-height band, ignoring the g's descender, so the word sits centred.
    const xh = glyphMesh(serif, 'vintae', cream, 'metric', 10).geometry.boundingBox;
    const s = 1.62 / (maxX - minX);
    word.geometry.scale(s, s, s);
    word.geometry.translate(-(minX + maxX) / 2 * s, PHOTO_Y - (xh.min.y + xh.max.y) / 2 * s, CARD_D / 2 + 0.012);
  }

  // --- the seven-segment date stamp, bottom-right of the frame ---
  const stampMat = new THREE.MeshStandardMaterial({
    name: 'date-stamp', color: 0xE8761A, emissive: 0xE8761A, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0,
  });
  const SEG_W = 0.098, SEG_H = 0.185, SEG_T = 0.016, SEG_D = 0.022, GAP = 0.020, PITCH = 0.175;
  const HB = SEG_W - SEG_T - GAP;
  const VB = SEG_H / 2 - SEG_T - GAP;
  const SEGMENTS = {
    a: [0, SEG_H / 2, HB, SEG_T], d: [0, -SEG_H / 2, HB, SEG_T], g: [0, 0, HB, SEG_T],
    f: [-SEG_W / 2, SEG_H / 4, SEG_T, VB], b: [SEG_W / 2, SEG_H / 4, SEG_T, VB],
    e: [-SEG_W / 2, -SEG_H / 4, SEG_T, VB], c: [SEG_W / 2, -SEG_H / 4, SEG_T, VB],
  };
  const DIGITS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  const NUDGE = { 1: -SEG_W / 2 }; // centre the 1's stem in its cell
  function segDigit(d) {
    const g = new THREE.Group();
    g.name = 'stamp-' + d;
    for (const key of DIGITS[d] || '') {
      const [x, y, w, hh] = SEGMENTS[key];
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, SEG_D), stampMat);
      bar.name = 'seg-' + d + '-' + key;
      bar.position.set(x + (NUDGE[d] || 0), y, 0);
      g.add(bar);
    }
    return g;
  }
  const stamp = new THREE.Group();
  stamp.name = 'date-stamp';
  const tick = new THREE.Mesh(new THREE.BoxGeometry(SEG_T, SEG_H * 0.26, SEG_D), stampMat);
  tick.name = 'stamp-apostrophe';
  tick.position.set(0, SEG_H * 0.40, 0);
  stamp.add(tick);
  stampDigits.split('').forEach((d, i) => {
    const digit = segDigit(d);
    digit.position.x = PITCH * (i + 1);
    stamp.add(digit);
  });
  // slant the whole stamp like a camera's LED date imprint (baked into geometry)
  const shear = new THREE.Matrix4().set(1, 0.14, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  stamp.updateMatrixWorld(true);
  stamp.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.translate(o.position.x + o.parent.position.x, o.position.y + o.parent.position.y, 0);
    g.applyMatrix4(shear);
    o.geometry = g;
    o.position.set(0, 0, 0);
  });
  stamp.children.forEach((c) => c.position.set(0, 0, 0));
  stamp.position.set(0.92 - PITCH * stampDigits.length, -0.60, CARD_D / 2 + 0.014);

  const model = new THREE.Group();
  model.name = 'vintage-mark';
  model.add(card, photo, word, stamp);
  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));

  stage.setObject(model);

  // flat, even light: one solid cream tone with only a faint facet break
  stage._scene.add(new THREE.AmbientLight(0xffffff, 2.0));
  const front = new THREE.DirectionalLight(0xffffff, 0.9);
  front.position.set(-2, 1.5, 4);
  front.name = 'front-fill';
  stage._scene.add(front);
  stage._key.intensity = 0.35;
  stage._ground.visible = false;

  // face the mark head-on, then turn it slowly on its own axis
  const controls = stage._controls;
  const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  controls.target.copy(centre);
  stage._camera.position.set(centre.x, centre.y, centre.z + distance);
  controls.update();
  controls.autoRotateSpeed = spin;
  controls.addEventListener('end', () => {
    clearTimeout(stage.__resumeSpin);
    stage.__resumeSpin = setTimeout(() => { controls.autoRotate = true; }, 2500);
  });

  // the stage measured itself before layout settled — re-fit to the real box
  requestAnimationFrame(() => stage.fit && stage.fit());
  return model;
}
