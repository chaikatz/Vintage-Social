/**
 * <vintage-stage> — the small three.js viewer behind the VINTAGE mark.
 *
 * Trimmed from the Claude Design 3D stage the mark was made on: WebGL
 * renderer, neutral studio light with a soft ground shadow, orbit controls
 * (drag to turn, wheel to zoom), a camera framed to the object, resize
 * handling, and a slow turntable until the visitor touches it. With the
 * `minimal` attribute the object simply stands head-on with no shadow and
 * no hand controls, and spins itself. No export toolbar, no messages to
 * any parent window — nothing leaves the page.
 *
 * three.js arrives through the page's <script type="importmap">, which
 * points at this site's own copy (public/3d/vendor, r184) — nothing is
 * fetched from anyone else's server. The page must carry that map before
 * any module runs. If three.js cannot load — an old browser, WebGL off —
 * the stage shows the wordmark in type instead and fires a `stage-error`
 * event, so the page still reads.
 *
 *   <vintage-stage background="#f9f5ec" minimal></vintage-stage>
 *   <script type="module">
 *     const stage = document.querySelector('vintage-stage');
 *     const { THREE } = await stage.ready;
 *     stage.setObject(model);
 *   </script>
 */
(() => {
  const stylesheet = `
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      background: var(--stage-bg, #000);
      overflow: hidden;
    }
    canvas { display: block; outline: none; touch-action: pan-y; }
    .fallback {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      font: 400 clamp(28px, 4vw, 40px)/1 Georgia, "Times New Roman", serif;
      letter-spacing: .32em;
      color: var(--stage-ink, #473D35);
      user-select: none;
    }
  `;

  class VintageStage extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = stylesheet;
      root.appendChild(style);
      this._fallback = document.createElement('div');
      this._fallback.className = 'fallback';
      this._fallback.textContent = 'VINTAGE';
      root.appendChild(this._fallback);
      /** Resolves with { THREE } once the scene is live. */
      this.ready = new Promise((resolve, reject) => {
        this._readyResolve = resolve;
        this._readyReject = reject;
      });
    }

    connectedCallback() {
      if (this._booted) {
        if (this._renderer) {
          this._renderer.setAnimationLoop(this._loop);
          this._ro && this._ro.observe(this);
        }
        return;
      }
      this._booted = true;
      this._boot().catch((err) => {
        this._fallback.style.display = 'flex';
        this.dispatchEvent(new CustomEvent('stage-error', { detail: err }));
        this._readyReject(err);
      });
    }

    async _boot() {
      const bg = this.getAttribute('background');
      if (bg) this.style.setProperty('--stage-bg', bg);
      const ink = this.getAttribute('ink');
      if (ink) this.style.setProperty('--stage-ink', ink);
      const minimal = this.hasAttribute('minimal');
      this._minimal = minimal;
      const [THREE, controlsMod] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
      ]);
      this._THREE = THREE;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this._renderer = renderer;
      this.shadowRoot.insertBefore(renderer.domElement, this._fallback);

      const scene = new THREE.Scene();
      this._scene = scene;

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
      camera.position.set(3, 2.2, 4);
      this._camera = camera;

      const controls = new controlsMod.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      this._controls = controls;

      scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(4, 7, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0002;
      this._key = key;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
      fill.position.set(-5, 3, -4);
      scene.add(fill);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.ShadowMaterial({ opacity: 0.18 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this._ground = ground;
      scene.add(ground);

      if (minimal) {
        ground.visible = false;
        controls.enableZoom = false;
        controls.enablePan = false;
        controls.enableRotate = false;
      }
      controls.autoRotate = this.hasAttribute('autorotate');
      controls.autoRotateSpeed = 1.2;
      controls.addEventListener('start', () => {
        controls.autoRotate = false;
      });

      const fit = () => {
        const w = this.clientWidth || 1;
        const h = this.clientHeight || 1;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      this.fit = fit;
      fit();
      this._ro = new ResizeObserver(fit);
      this._loop = () => {
        controls.update();
        renderer.render(scene, camera);
      };
      if (this.isConnected) {
        this._ro.observe(this);
        renderer.setAnimationLoop(this._loop);
      }
      this._readyResolve({ THREE });
    }

    disconnectedCallback() {
      if (this._renderer) this._renderer.setAnimationLoop(null);
      if (this._ro) this._ro.disconnect();
    }

    /** Show the object: shadows on, rested on the ground, camera framed to it. */
    setObject(object) {
      const THREE = this._THREE;
      if (!THREE) throw new Error('vintage-stage: not ready — await stage.ready first');
      if (this._object) this._scene.remove(this._object);
      this._object = object;
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const box = new THREE.Box3().setFromObject(object);
      if (!box.isEmpty()) {
        this._ground.position.y = box.min.y;
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const dist = (sphere.radius / Math.tan((this._camera.fov * Math.PI) / 360)) * (this._minimal ? 2.6 : 1.35);
        const dir = this._minimal ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0.55, 1.25).normalize();
        this._camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
        this._camera.near = Math.max(dist / 100, 0.01);
        this._camera.far = dist * 100;
        this._camera.updateProjectionMatrix();
        this._controls.target.copy(sphere.center);
        this._controls.update();
        const span = sphere.radius * 3;
        this._key.shadow.camera.left = -span;
        this._key.shadow.camera.right = span;
        this._key.shadow.camera.top = span;
        this._key.shadow.camera.bottom = -span;
        this._key.shadow.camera.updateProjectionMatrix();
      }
      this._scene.add(object);
    }
  }

  if (!customElements.get('vintage-stage')) customElements.define('vintage-stage', VintageStage);
})();
