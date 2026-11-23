// The collection as a 3D wall of covers that sorts itself into crate stacks.
// Loaded lazily (three.js is ~150KB) only when somebody opens this view.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { wallLayout, crateLayout } from '../lib/crateWallLayout.js';

const FOV = 40;
const TRANSITION = 1.6;   // seconds for the sort, start to last piece landing

// Covers in Supabase storage and inline data URLs are usable by WebGL as they
// are; Discogs refuses cross-origin reads, so those go through our own proxy.
function textureUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:') || url.includes('.supabase.co/storage/')) return url;
  if (/^https:\/\/(i|img|st)\.discogs\.com\//.test(url) || url.startsWith('https://i.scdn.co/')) return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  return url;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * u * (u * (6 * u - 15) + 10); };

export default function CrateWall({ records, onSelect, accentRGB }) {
  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const [mode, setMode] = useState('wall');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !records.length) return;
    const n = records.length;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const fg = (getComputedStyle(document.documentElement).getPropertyValue('--fg') || '240,240,235').trim();

    // ---- renderer, scene, camera
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const W = () => mount.clientWidth, H = () => mount.clientHeight;
    renderer.setSize(W(), H());
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, W() / H(), 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.rotateSpeed = 0.6;
    controls.maxPolarAngle = Math.PI * 0.62;

    // ---- one sheet holding every cover, and one batched mesh drawing them all
    const grid = Math.ceil(Math.sqrt(n));
    const cellPx = Math.max(32, Math.min(128, Math.floor(4096 / grid)));
    const atlas = document.createElement('canvas');
    atlas.width = atlas.height = grid * cellPx;
    const ctx = atlas.getContext('2d');
    ctx.fillStyle = '#17171a'; ctx.fillRect(0, 0, atlas.width, atlas.height);
    const tex = new THREE.CanvasTexture(atlas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const frac = 1 / grid;
    const material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCell = { value: frac };
      shader.vertexShader = 'attribute vec2 aOffset;\nuniform float uCell;\n' + shader.vertexShader.replace(
        '#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = uv * uCell + aOffset;\n#endif');
    };
    const geo = new THREE.PlaneGeometry(1, 1);
    const offsets = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const c = i % grid, r = Math.floor(i / grid);
      offsets[i * 2] = c * frac; offsets[i * 2 + 1] = 1 - (r + 1) * frac;
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);

    // placeholders first: initials on a dark tile, replaced as each cover arrives
    records.forEach((r, i) => {
      const x = (i % grid) * cellPx, y = Math.floor(i / grid) * cellPx;
      ctx.fillStyle = `rgba(${accentRGB},0.10)`; ctx.fillRect(x + 1, y + 1, cellPx - 2, cellPx - 2);
      ctx.fillStyle = `rgba(${fg},0.45)`; ctx.font = `${Math.round(cellPx * 0.28)}px ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(r.artist || '?').slice(0, 2).toUpperCase(), x + cellPx / 2, y + cellPx / 2);
    });

    // ---- layouts
    const wall = wallLayout(n, W() / H());
    const crates = crateLayout(records, W() < 640 ? 3 : 5);
    const labelMeshes = crates.labels.map((l) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 64;
      const g = c.getContext('2d');
      g.font = '600 26px "JetBrains Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
      g.fillStyle = `rgba(${fg},0.85)`; g.textAlign = 'left';
      g.fillText(l.name.toUpperCase().slice(0, 22), 4, 32);
      g.fillStyle = `rgb(${accentRGB})`; g.textAlign = 'right'; g.fillText(String(l.count), 508, 32);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(l.width, l.width / 8), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false }));
      m.position.set(l.x, l.y, l.z);
      scene.add(m);
      return m;
    });

    // ---- cameras that frame each layout
    const fit = (w, h) => {
      const t = Math.tan((FOV / 2) * Math.PI / 180);
      return Math.max(h / 2 / t, w / 2 / (t * camera.aspect)) * 1.08;
    };
    const wallCam = () => ({ pos: new THREE.Vector3(0, 0, fit(wall.width, wall.height)), tgt: new THREE.Vector3(0, 0, 0) });
    const crateCam = () => {
      // a low, slightly raised eye on the middle of the stacks, so they fill
      // the frame instead of floating at the top of it
      const d = fit(crates.width, crates.maxH + 1.5) + crates.depth * 0.35;
      const tgt = new THREE.Vector3(0, crates.maxH * 0.5, -crates.depth * 0.4);
      return { pos: new THREE.Vector3(0, tgt.y + d * 0.12, tgt.z + d), tgt };
    };

    // ---- state of the sort
    let progress = 0, from = 0, to = 0, startAt = 0, animating = false;
    const dummy = new THREE.Object3D();
    const delay = records.map((_, i) => {
      const p = crates.pos[i];
      return Math.min(0.55, (p[1] / Math.max(1, crates.maxH)) * 0.35 + ((crates.piece[i] * 37) % 100) / 100 * 0.2);
    });
    const place = (k) => {
      for (let i = 0; i < n; i++) {
        const a = wall.pos[i], b = crates.pos[i];
        const u = smooth((k * (1 + 0.55) - delay[i]) / 1);
        const lift = Math.sin(Math.PI * u) * 2.2;
        dummy.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u + lift);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      labelMeshes.forEach((m) => { m.material.opacity = Math.max(0, (k - 0.7) / 0.3); });
      const A = wallCam(), B = crateCam(), e = smooth(k);
      camera.position.lerpVectors(A.pos, B.pos, e);
      controls.target.lerpVectors(A.tgt, B.tgt, e);
      camera.lookAt(controls.target);
    };

    let raf = 0;
    const render = () => renderer.render(scene, camera);
    const tick = (now) => {
      raf = 0;
      if (animating) {
        const u = reduced ? 1 : Math.min(1, (now - startAt) / (TRANSITION * 1000));
        progress = from + (to - from) * u;
        place(progress);
        if (u >= 1) animating = false;
      }
      controls.update();
      render();
      if (animating) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    controls.addEventListener('change', kick);

    place(0); render();

    apiRef.current = {
      go(target) {
        from = progress; to = target === 'crates' ? 1 : 0;
        if (from === to) return;
        startAt = performance.now(); animating = true; kick();
      },
    };

    // ---- covers stream in, a few at a time; the sheet re-uploads at most once a frame
    let alive = true, dirty = false;
    const flush = () => { if (dirty) { tex.needsUpdate = true; dirty = false; kick(); } };
    const queue = records.map((r, i) => [i, textureUrl(r.coverUrl)]).filter(([, u]) => u);
    const worker = async () => {
      while (alive && queue.length) {
        const [i, src] = queue.shift();
        try {
          const im = await loadImage(src);
          if (!alive) return;
          const x = (i % grid) * cellPx, y = Math.floor(i / grid) * cellPx;
          const s = Math.min(im.naturalWidth, im.naturalHeight);
          ctx.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, x, y, cellPx, cellPx);
          dirty = true; requestAnimationFrame(flush);
        } catch { /* keep the placeholder */ }
      }
    };
    for (let k = 0; k < 6; k++) worker();

    // ---- tap a cover to open it (a drag is a turn, not a tap)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh)[0];
      if (hit && hit.instanceId != null) onSelect(records[hit.instanceId]);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const ro = new ResizeObserver(() => {
      renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); place(progress); kick();
    });
    ro.observe(mount);

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      labelMeshes.forEach((m) => { m.geometry.dispose(); m.material.map.dispose(); m.material.dispose(); });
      geo.dispose(); material.dispose(); tex.dispose(); renderer.dispose();
      mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  // onSelect is a fresh closure each render; rebuilding the scene for it would
  // reload every cover, so the scene is rebuilt only when the records change.
  }, [records, accentRGB]);

  useEffect(() => { apiRef.current?.go(mode); }, [mode]);

  const btn = (id, label) => (
    <button key={id} onClick={() => setMode(id)} className="px-3.5 py-1.5 text-[12px] font-mono tracking-[0.12em] uppercase transition-all"
      style={{ background: mode === id ? `rgb(${accentRGB})` : 'transparent', color: mode === id ? '#0d0c0a' : 'rgba(var(--fg),0.6)' }}>
      {label}
    </button>
  );

  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(var(--fg),0.08)', background: 'rgba(var(--fg),0.015)' }}>
      <div ref={mountRef} style={{ height: 'min(72vh, 760px)', minHeight: 420 }} role="img" aria-label={`3D view of ${records.length} records. Use the grid or list view to browse them with a keyboard or screen reader.`} />
      <div className="absolute top-3 left-3 flex rounded-full overflow-hidden" style={{ border: '1px solid rgba(var(--fg),0.12)', background: 'rgba(var(--bg),0.6)', backdropFilter: 'blur(6px)' }}>
        {btn('wall', 'Wall')}{btn('crates', 'Crates')}
      </div>
      <div className="absolute bottom-3 left-0 right-0 text-center text-[11px] font-mono tracking-[0.1em] pointer-events-none" style={{ color: 'rgba(var(--fg),0.42)' }}>
        DRAG TO TURN · PINCH TO ZOOM · TAP A COVER
      </div>
    </div>
  );
}
