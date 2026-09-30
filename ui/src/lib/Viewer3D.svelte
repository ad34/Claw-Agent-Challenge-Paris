<script lang="ts">
  import gsap from "gsap";
  import { onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
  import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
  import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
  import { ensureModel, hdriUrl, modelFileUrl, type ModelScene } from "../api";

  // Viewer 3D temps réel du rendu : le GLB exporté par Blender (produit + socle, matériaux de la recette),
  // éclairé comme la recette (même HDRI, mêmes lumières), caméra de départ = celle du packshot.
  let { renderId }: { renderId: number } = $props();

  let host: HTMLDivElement;
  let phase = $state<"export" | "load" | "ready" | "failed">("export");
  let progress = $state(0);
  let error = $state("");
  let spinning = $state(true);
  let hint = $state(true);
  let resetView = () => {};
  let controlsRef: OrbitControls | null = null;

  // Blender : azimut 0 = devant (-Y), Z en haut. glTF / three : devant = +Z, Y en haut.
  const spherical = (t: THREE.Vector3, d: number, azDeg: number, elDeg: number) => {
    const az = THREE.MathUtils.degToRad(azDeg);
    const el = THREE.MathUtils.degToRad(elDeg);
    return new THREE.Vector3(t.x + d * Math.sin(az) * Math.cos(el), t.y + d * Math.sin(el), t.z + d * Math.cos(az) * Math.cos(el));
  };

  // Ombre de contact douce sous le produit (dégradé radial), en plus de l'ombre portée de la lumière principale.
  function contactShadow(size: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.22)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.001;
    return mesh;
  }

  onMount(() => {
    let alive = true;
    let raf = 0;
    const disposables: { dispose(): void }[] = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.AgXToneMapping; // même transformée de vue que Blender
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.className = "absolute inset-0 h-full w-full outline-none transition-opacity duration-700";
    renderer.domElement.style.opacity = "0";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = spinning;
    controls.autoRotateSpeed = 1.1;
    controlsRef = controls;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(88); // jamais sous le sol
    let idle: ReturnType<typeof setTimeout> | undefined;
    controls.addEventListener("start", () => {
      hint = false;
      controls.autoRotate = false;
      clearTimeout(idle);
    });
    // La rotation automatique reprend après quelques secondes sans interaction.
    controls.addEventListener("end", () => (idle = setTimeout(() => (controls.autoRotate = spinning), 4000)));

    let sensorHalf = 18; // capteur 36 mm sur le grand côté (sensor_fit AUTO de Blender)
    let focal = 70;
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(((sensorHalf / focal) * h) / Math.max(w, h)));
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };

    (async () => {
      let sc: ModelScene;
      try {
        sc = await ensureModel(renderId, () => alive);
      } catch (err) {
        phase = "failed";
        error = (err as Error).message;
        return;
      }
      if (!alive) return;
      phase = "load";

      // --- Studio : fond uni de la couleur du cyclo, sol invisible qui ne garde que les ombres.
      const bg = new THREE.Color(sc.background?.color ?? "#d8d8d8");
      scene.background = bg;
      renderer.toneMappingExposure = Math.pow(2, sc.exposure ?? 0);

      // --- Environnement : l'HDRI de la recette (reflets + lumière ambiante), sinon une pièce neutre.
      const pmrem = new THREE.PMREMGenerator(renderer);
      disposables.push(pmrem);
      try {
        if (!sc.hdri) throw new Error("no hdri");
        const hdr = await new HDRLoader().loadAsync(hdriUrl(sc.hdri));
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const env = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        scene.environment = env;
        scene.environmentIntensity = 0.35 + sc.hdri_strength * 0.9;
        scene.environmentRotation.y = THREE.MathUtils.degToRad(sc.hdri_rotation_deg ?? 0);
        disposables.push(env);
      } catch {
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.6;
      }
      if (!alive) return;

      // --- Produit
      const gltf = await new GLTFLoader().loadAsync(modelFileUrl(renderId), (e) => {
        if (e.total) progress = Math.round((e.loaded / e.total) * 100);
      });
      if (!alive) return;
      const product = gltf.scene;
      product.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      scene.add(product);
      const box = new THREE.Box3().setFromObject(product);
      // Cadrage comme dans Blender : sur le produit seul, socle exclu.
      const productBox = new THREE.Box3();
      product.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !/pedestal/i.test(o.name) && !/pedestal/i.test(o.parent?.name ?? "")) productBox.expandByObject(o);
      });
      const sphere = (productBox.isEmpty() ? box : productBox).getBoundingSphere(new THREE.Sphere());
      const target = sphere.center.clone();
      const radius = sphere.radius;

      const ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 7, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = box.min.y;
      ground.receiveShadow = true;
      scene.add(ground);
      const blob = contactShadow(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.9);
      blob.position.y = box.min.y + 0.001;
      scene.add(blob);

      // --- Lumières de la recette (softbox = lumière directionnelle ; la plus forte porte l'ombre).
      const lights = (sc.lights ?? []).filter((l) => l.power > 0);
      const maxPower = Math.max(1, ...lights.map((l) => l.power));
      lights.forEach((l, i) => {
        const d = new THREE.DirectionalLight(l.color ?? "#ffffff", 2.4 * (l.power / maxPower));
        d.position.copy(spherical(target, radius * 6, l.azimuth, l.elevation));
        d.target.position.copy(target);
        scene.add(d, d.target);
        if (l.power === maxPower && l.elevation > 5 && !lights.slice(0, i).some((o) => o.power === maxPower)) {
          d.castShadow = true;
          d.shadow.mapSize.set(2048, 2048);
          d.shadow.radius = 8 + (l.size ?? 1.2) * 6; // softbox large = ombre plus douce
          d.shadow.blurSamples = 16;
          d.shadow.bias = -0.0004;
          const cam = d.shadow.camera;
          // Frustum large : son bord ne doit jamais tomber dans le champ (il laisserait un trait sur le sol).
          cam.left = cam.bottom = -radius * 8;
          cam.right = cam.top = radius * 8;
          cam.near = radius;
          cam.far = radius * 14;
        }
      });

      // --- Caméra du packshot : même focale, même cadrage (le produit occupe `fill` du petit côté).
      const cr = sc.camera ?? { azimuth: 20, elevation: 12, focal_mm: 70 };
      focal = cr.focal_mm ?? 70;
      resize();
      // Le produit occupe `fill` du petit côté du viewer, comme dans l'image.
      const ratio = Math.min(host.clientWidth, host.clientHeight) / Math.max(host.clientWidth, host.clientHeight) || 0.8;
      const dist = radius / ((cr.fill ?? 0.62) * ((sensorHalf / focal) * ratio));
      const lookAt = target.clone().add(new THREE.Vector3(0, (cr.look_offset_z ?? 0) * radius, 0));
      const home = spherical(lookAt, dist, cr.azimuth ?? 20, cr.elevation ?? 12);
      home.y = Math.max(home.y, box.min.y + 0.02);
      controls.target.copy(lookAt);
      controls.minDistance = radius * 1.3;
      controls.maxDistance = dist * 3;

      const fly = (from: THREE.Vector3, duration: number) => {
        controls.enabled = false;
        const p = { t: 0 };
        const start = from.clone().sub(lookAt);
        const end = home.clone().sub(lookAt);
        const s0 = new THREE.Spherical().setFromVector3(start);
        const s1 = new THREE.Spherical().setFromVector3(end);
        if (s1.theta - s0.theta > Math.PI) s0.theta += 2 * Math.PI;
        if (s0.theta - s1.theta > Math.PI) s1.theta += 2 * Math.PI;
        gsap.to(p, {
          t: 1,
          duration,
          ease: "power3.inOut",
          onUpdate: () => {
            const s = new THREE.Spherical(
              THREE.MathUtils.lerp(s0.radius, s1.radius, p.t),
              THREE.MathUtils.lerp(s0.phi, s1.phi, p.t),
              THREE.MathUtils.lerp(s0.theta, s1.theta, p.t),
            );
            camera.position.copy(lookAt).add(new THREE.Vector3().setFromSpherical(s));
            camera.lookAt(lookAt);
          },
          onComplete: () => void (controls.enabled = true),
        });
      };
      resetView = () => fly(camera.position.clone(), 1.1);

      // Entrée : on part de loin et de côté, on atterrit sur le cadrage exact du rendu.
      camera.position.copy(spherical(lookAt, dist * 1.9, (cr.azimuth ?? 20) - 70, (cr.elevation ?? 12) + 25));
      camera.lookAt(lookAt);
      phase = "ready";
      loop();
      requestAnimationFrame(() => (renderer.domElement.style.opacity = "1"));
      fly(camera.position.clone(), 1.8);
    })().catch((err) => {
      if (!alive) return;
      phase = "failed";
      error = (err as Error).message;
    });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(idle);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of [m.material ?? []].flat()) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  });

  function toggleSpin() {
    spinning = !spinning;
    if (controlsRef) controlsRef.autoRotate = spinning;
  }
</script>

<div bind:this={host} class="@container relative h-full w-full overflow-hidden">
  {#if phase !== "ready"}
    <div class="absolute inset-0 z-10 grid place-items-center">
      <div class="flex flex-col items-center gap-3 text-sm text-base-content/60">
        {#if phase === "failed"}
          <span class="text-error">3D view unavailable</span>
          <span class="max-w-md text-center text-xs text-base-content/45">{error}</span>
        {:else}
          <span class="loading loading-ring loading-lg text-primary"></span>
          {phase === "export" ? "Exporting the scene from Blender…" : `Loading 3D model${progress ? ` · ${progress}%` : "…"}`}
        {/if}
      </div>
    </div>
  {:else}
    <div class="absolute top-3 right-3 z-10 flex gap-1.5">
      <button class="btn btn-sm border-white/15 bg-black/45 text-white/90 hover:bg-black/60" class:btn-active={spinning} onclick={toggleSpin} aria-pressed={spinning}>
        <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        {spinning ? "Auto-rotate" : "Rotate off"}
      </button>
      <button class="btn btn-sm border-white/15 bg-black/45 text-white/90 hover:bg-black/60" onclick={() => resetView()}>Render camera</button>
    </div>
    {#if hint}
      <span class="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs whitespace-nowrap text-white/80">
        Drag to orbit · scroll to zoom · right-drag to pan
      </span>
    {/if}
    <span class="pointer-events-none absolute top-3 left-3 z-10 hidden rounded-full @xl:inline bg-black/40 px-2.5 py-1 text-[11px] text-white/70 num">Real-time 3D</span>
  {/if}
</div>
