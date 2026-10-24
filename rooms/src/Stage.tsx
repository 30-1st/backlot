import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  FrontSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TorusKnotGeometry,
  WebGLRenderer,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Look } from './archetypes';

// The room's 3D object: one per archetype, built from code (no model files, no images),
// lit by a generated studio so metal and glass read. It turns slowly, can be dragged to
// spin, spins faster while Kris is thinking and gives a small bounce when she answers.
// Pauses when the page is hidden; holds still for people who ask for reduced motion.

export type Mood = 'idle' | 'thinking' | 'answered';

function buildObject(look: Look, accent: string): Group {
  const g = new Group();
  const color = new Color(accent);
  const main = new MeshStandardMaterial({ color, metalness: look.metal, roughness: look.rough, side: look.object === 'crown' ? DoubleSide : FrontSide });
  const ink = new MeshStandardMaterial({ color: new Color(look.dark ? '#f5ece2' : '#141218'), metalness: 0.2, roughness: 0.4 });

  switch (look.object) {
    case 'crown': {
      const band = new Mesh(new CylinderGeometry(1, 1.05, 0.55, 64, 1, true), main);
      g.add(band);
      const rim = new Mesh(new TorusGeometry(1.03, 0.06, 16, 80), main);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.27;
      g.add(rim);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const spike = new Mesh(new CylinderGeometry(0, 0.17, 0.55, 4), main);
        spike.position.set(Math.cos(a) * 1, 0.52, Math.sin(a) * 1);
        spike.rotation.y = -a;
        g.add(spike);
        const pearl = new Mesh(new SphereGeometry(0.08, 20, 16), ink);
        pearl.position.set(Math.cos(a) * 1, 0.84, Math.sin(a) * 1);
        g.add(pearl);
      }
      const coin = new Mesh(new CylinderGeometry(0.42, 0.42, 0.07, 64), main);
      coin.rotation.z = Math.PI / 2;
      coin.position.set(1.65, -0.5, 0.3);
      coin.name = 'orbit';
      g.add(coin);
      g.scale.setScalar(0.95);
      break;
    }
    case 'ribbon': {
      g.add(new Mesh(new TorusKnotGeometry(0.85, 0.24, 220, 32, 2, 3), main));
      break;
    }
    case 'dice': {
      const pip = (die: Mesh, x: number, y: number, z: number) => {
        const p = new Mesh(new SphereGeometry(0.075, 16, 12), ink);
        p.position.set(x, y, z);
        die.add(p);
      };
      const make = (n: number) => {
        const die = new Mesh(new RoundedBoxGeometry(1, 1, 1, 6, 0.18), main);
        const d = 0.51;
        const spots: Record<number, Array<[number, number]>> = {
          1: [[0, 0]], 2: [[-0.22, -0.22], [0.22, 0.22]], 3: [[-0.24, -0.24], [0, 0], [0.24, 0.24]],
          4: [[-0.22, -0.22], [0.22, 0.22], [-0.22, 0.22], [0.22, -0.22]],
          5: [[-0.24, -0.24], [0.24, 0.24], [-0.24, 0.24], [0.24, -0.24], [0, 0]],
          6: [[-0.22, -0.26], [-0.22, 0], [-0.22, 0.26], [0.22, -0.26], [0.22, 0], [0.22, 0.26]],
        };
        spots[n].forEach(([a, b]) => pip(die, a, b, d));
        spots[7 - n].forEach(([a, b]) => pip(die, a, b, -d));
        spots[2].forEach(([a, b]) => pip(die, d, a, b));
        spots[5].forEach(([a, b]) => pip(die, -d, a, b));
        spots[3].forEach(([a, b]) => pip(die, a, d, b));
        spots[4].forEach(([a, b]) => pip(die, a, -d, b));
        return die;
      };
      const a = make(5);
      a.position.set(-0.62, 0.15, 0);
      a.rotation.set(0.5, 0.6, 0.2);
      const b = make(3);
      b.position.set(0.66, -0.35, 0.2);
      b.rotation.set(-0.3, -0.8, 0.4);
      b.name = 'orbit';
      g.add(a, b);
      break;
    }
    case 'shard': {
      const geo = new IcosahedronGeometry(1.05, 1);
      const pos = geo.attributes.position;
      // A fixed jagged pattern, so every visit sees the same shard.
      for (let i = 0; i < pos.count; i++) {
        const s = 0.72 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
        pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 1.35, pos.getZ(i) * s);
      }
      geo.computeVertexNormals();
      main.flatShading = true;
      g.add(new Mesh(geo, main));
      break;
    }
    case 'rings': {
      for (let i = 0; i < 3; i++) {
        const ring = new Mesh(new TorusGeometry(1.05 - i * 0.18, 0.035, 16, 120), main);
        ring.rotation.set(Math.PI / 2 + i * 0.6, i * 0.9, i * 0.3);
        ring.name = i === 1 ? 'orbit' : '';
        g.add(ring);
      }
      g.add(new Mesh(new SphereGeometry(0.28, 40, 30), ink));
      break;
    }
    case 'heart': {
      const s = new Shape();
      s.moveTo(0, -0.9);
      s.bezierCurveTo(0.9, -0.2, 1.05, 0.55, 0.55, 0.85);
      s.bezierCurveTo(0.25, 1.02, 0.02, 0.85, 0, 0.6);
      s.bezierCurveTo(-0.02, 0.85, -0.25, 1.02, -0.55, 0.85);
      s.bezierCurveTo(-1.05, 0.55, -0.9, -0.2, 0, -0.9);
      const geo = new ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.18, bevelSegments: 10, curveSegments: 48 });
      geo.center();
      g.add(new Mesh(geo, main));
      break;
    }
  }
  return g;
}

export function Stage({ look, accent, mood, still }: { look: Look; accent: string; mood: Mood; still?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const moodRef = useRef<Mood>(mood);
  moodRef.current = mood;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      el.dataset.fallback = 'true';
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.add(new HemisphereLight(0xffffff, look.dark ? 0x221018 : 0xb8b8c8, look.dark ? 0.6 : 1.1));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 4, 5);
    scene.add(key);

    const camera = new PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0.15, 6.6);
    const obj = buildObject(look, accent);
    obj.rotation.set(0.25, 0, 0.08);
    scene.add(obj);
    const orbit = obj.getObjectByName('orbit');

    const size = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Portrait stages are narrow: step back so the whole object fits.
      camera.position.z = w / h < 0.8 ? 9.2 : w / h < 1.3 ? 7.6 : 6.6;
      camera.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    // Drag to spin, with a little momentum.
    let vx = 0;
    let vy = 0;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      vy = (e.clientX - drag.x) * 0.004;
      vx = (e.clientY - drag.y) * 0.003;
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      drag = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let bounce = 0;
    let lastMood: Mood = moodRef.current;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = moodRef.current;
      if (m === 'answered' && lastMood !== 'answered') bounce = 1;
      lastMood = m;
      if (!reduce || drag) {
        t += dt;
        const speed = reduce ? 0 : look.spin * (m === 'thinking' ? 4 : 1);
        obj.rotation.y += speed * dt + vy;
        obj.rotation.x += vx;
        vx *= 0.92;
        vy *= 0.94;
        obj.position.y = reduce ? 0 : Math.sin(t * 1.3) * look.bob;
        if (orbit && !reduce) orbit.rotation.x += dt * (m === 'thinking' ? 3 : 0.8);
      }
      bounce = Math.max(0, bounce - dt * 2.2);
      obj.scale.setScalar((look.object === 'crown' ? 0.95 : 1) * (1 + Math.sin(bounce * Math.PI) * 0.08 * bounce + (m === 'thinking' && !reduce ? Math.sin(t * 8) * 0.015 : 0)));
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && document.visibilityState === 'visible' && !still) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const vis = () => (document.visibilityState === 'visible' ? start() : stop());
    document.addEventListener('visibilitychange', vis);
    renderer.render(scene, camera);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', vis);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      obj.traverse((o) => {
        const mesh = o as Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as Material | Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [look, accent, still]);

  return <div ref={host} className="r-stage" aria-hidden="true" />;
}

