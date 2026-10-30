import { useEffect, useRef, useState } from 'react';

// The Playground's way in: a paper playground fading into the page, and a hologram that
// shows one space at a time (X, Instagram, Rein). Hover or tap the pill to switch; click, or
// tap the shown one again, to peek inside and step in. The logos are the official files,
// still and unaltered (Meta's and X's brand rules); only Rein's own mark moves.
//
// three.js loads only on this screen, the drawing pauses off screen, and people who turn
// off motion get still frames.

type Id = 'x' | 'ig' | 'rein';
const INFO: Record<Id, { name: string; what: string; path: string }> = {
  x: { name: 'X', what: 'Narrate an X profile, post by post.', path: 'x' },
  ig: { name: 'Instagram', what: 'Plan your Instagram grid, post by post.', path: 'instagram' },
  rein: { name: 'Rein', what: 'Find what is rising in your niche.', path: 'rein' },
};
const ORDER: Id[] = ['x', 'ig', 'rein'];

/** The hologram stage. Talks to the page through callbacks; owns its own three.js scene. */
type Stage = { choose: (id: Id) => void; peek: (id: Id, done: () => void) => void; dispose: () => void };

async function makeStage(canvas: HTMLCanvasElement, holder: HTMLElement, reduce: boolean, onShown: (id: Id) => void): Promise<Stage> {
  const THREE = await import('three');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 1.0, 5);
  camera.lookAt(0, 1.0, 0);

  const holoColor = new THREE.Color();
  const glyphColor = new THREE.Color();
  const night = () => document.querySelector('.bl-root')?.getAttribute('data-theme') === 'night';
  const mats: InstanceType<typeof THREE.ShaderMaterial>[] = [];
  const tone = () => {
    const n = night();
    holoColor.set(n ? '#e0bd74' : '#0f9d90');
    glyphColor.set(n ? '#ffffff' : '#111716');
    mats.forEach((m) => (m.uniforms.uDay.value = n ? 0 : 1));
  };

  const vert = `varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv;
    void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0); vY = wp.y; vec4 mv = viewMatrix*wp; vV = -mv.xyz; vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv; }`;
  const frag = `uniform vec3 uColor; uniform vec3 uGlyph; uniform float uTime; uniform float uScan; uniform float uYMin; uniform float uYMax;
    uniform float uFlick; uniform float uUseMap; uniform float uDay; uniform sampler2D uMap;
    varying vec3 vN; varying vec3 vV; varying float vY; varying vec2 vUv;
    void main(){
      float h = clamp((vY - uYMin)/(uYMax - uYMin), 0.0, 1.0);
      if (h > uScan) discard;
      float edge = (uScan < 0.999) ? smoothstep(0.08, 0.0, uScan - h) : 0.0;
      float lines = 0.5 + 0.5*sin(vY*160.0 - uTime*4.0);
      float sweep = smoothstep(0.0, 0.06, 0.06 - abs(fract(vY*0.45 - uTime*0.22) - 0.5));
      vec3 col; float a; float ta = 1.0;
      if (uUseMap > 0.5) {
        vec4 t = texture2D(uMap, vUv);
        ta = t.a;
        a = t.a * (0.74 + 0.14*lines + 0.25*sweep);
        col = mix(uGlyph, uColor, 0.18 + 0.4*sweep);
      } else {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        a = (0.2 + fres*0.85) * (0.72 + 0.28*lines) + 0.25*sweep;
        col = mix(uColor, vec3(1.0), fres*0.25);
      }
      a *= uFlick;
      col = mix(col, uColor, edge);
      a = max(a, edge * 0.9 * ta);
      gl_FragColor = vec4(col, a);
    }`;
  const mat = (yMin: number, yMax: number, map?: InstanceType<typeof THREE.Texture>) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: holoColor }, uGlyph: { value: glyphColor }, uTime: { value: 0 }, uScan: { value: 1 }, uYMin: { value: yMin }, uYMax: { value: yMax },
        uFlick: { value: 1 }, uUseMap: { value: map ? 1 : 0 }, uMap: { value: map ?? null }, uDay: { value: 0 },
      },
    });
    mats.push(m);
    return m;
  };
  tone();

  const loader = new THREE.TextureLoader();
  const plane = (m: InstanceType<typeof THREE.ShaderMaterial>) => {
    const g = new THREE.Group();
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), m);
    p.position.y = 1.0;
    g.add(p);
    g.userData.mats = [m];
    return g;
  };
  const logo = (src: string) => {
    const t = loader.load(src);
    t.anisotropy = 4;
    return plane(mat(0.05, 1.95, t));
  };

  // Rein's mark: her radar from the app, wearing headphones. Ours, so the sweep may turn.
  const rc = document.createElement('canvas');
  rc.width = rc.height = 512;
  const reinTex = new THREE.CanvasTexture(rc);
  const drawRein = (angle: number) => {
    const g = rc.getContext('2d');
    if (!g) return;
    const c = 256;
    g.clearRect(0, 0, 512, 512);
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineCap = 'round';
    g.lineWidth = 22;
    g.beginPath();
    g.arc(c, c + 30, 150, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 16;
    g.beginPath();
    g.arc(c, c + 30, 82, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 0.55;
    g.beginPath();
    g.moveTo(c, c + 30);
    g.arc(c, c + 30, 150, angle - 1.2, angle);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(c, c + 30, 20, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 26;
    g.beginPath();
    g.arc(c, c + 30, 205, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
    for (const s of [-1, 1]) {
      const x = c + s * 196;
      g.beginPath();
      if (g.roundRect) g.roundRect(x - 26, c, 52, 110, 22);
      else g.rect(x - 26, c, 52, 110);
      g.fill();
    }
    reinTex.needsUpdate = true;
  };
  drawRein(-0.8);

  const items: Record<Id, InstanceType<typeof THREE.Group>> = { x: logo('/brand/x-logo-white.png'), ig: logo('/brand/instagram-glyph-white.png'), rein: plane(mat(0.05, 1.95, reinTex)) };
  for (const k of ORDER) {
    items[k].visible = k === 'x';
    scene.add(items[k]);
  }

  // Peeks: a quick see-through look inside before stepping in.
  const peeks = {} as Record<Id, InstanceType<typeof THREE.Group>>;
  for (const kind of ORDER) {
    const g = new THREE.Group();
    const m = mat(0.05, 1.95);
    const parts: InstanceType<typeof THREE.Mesh>[] = [];
    if (kind === 'ig') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const k = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), m);
        k.position.set((c - 1) * 0.58, 1.58 - r * 0.58, 0);
        g.add(k);
        parts.push(k);
      }
    } else if (kind === 'x') {
      for (let i = 0; i < 3; i++) {
        const k = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), m);
        k.position.set(0, 1.58 - i * 0.58, 0);
        g.add(k);
        parts.push(k);
      }
    } else {
      [0.5, 0.72, 0.64, 1.12, 1.6].forEach((h, i) => {
        const k = new THREE.Mesh(new THREE.BoxGeometry(0.26, h, 0.26), m);
        k.position.set((i - 2) * 0.38, 0.2 + h / 2, 0);
        k.userData.h = h;
        g.add(k);
        parts.push(k);
      });
    }
    g.visible = false;
    g.userData = { mats: [m], parts, kind };
    scene.add(g);
    peeks[kind] = g;
  }

  const setScan = (o: InstanceType<typeof THREE.Group>, v: number) => (o.userData.mats as InstanceType<typeof THREE.ShaderMaterial>[]).forEach((m) => (m.uniforms.uScan.value = v));
  const showPeek = (id: Id, k: number) => {
    const p = peeks[id];
    p.visible = k > 0;
    setScan(p, 1);
    (p.userData.parts as InstanceType<typeof THREE.Mesh>[]).forEach((part, i) => {
      const local = Math.max(0, Math.min(1, k * 1.6 - i * 0.08));
      if (id === 'rein') {
        part.scale.set(1, Math.max(0.001, local), 1);
        part.position.y = 0.2 + ((part.userData.h as number) * local) / 2;
      } else part.scale.setScalar(Math.max(0.001, local));
    });
  };

  let current: Id = 'x';
  let sw: { from: Id; to: Id; t0: number; start: number } | null = null;
  let pk: { id: Id; t0: number; done: () => void } | null = null;
  const OUT = 240;
  const BEAT = 200;
  const IN = 480;

  function choose(id: Id) {
    if (pk) return;
    if (id === (sw ? sw.to : current)) return;
    // Only one item may be on screen: whatever is showing scans out from where it is.
    let from: Id = current;
    if (sw) from = items[sw.to].visible ? sw.to : sw.from;
    for (const k of ORDER) if (k !== from) { items[k].visible = false; setScan(items[k], 1); }
    if (reduce || !items[from].visible) {
      items[from].visible = false;
      items[id].visible = true;
      setScan(items[id], 1);
      current = id;
      sw = null;
      onShown(id);
      render();
      return;
    }
    sw = { from, to: id, t0: performance.now(), start: (items[from].userData.mats[0] as InstanceType<typeof THREE.ShaderMaterial>).uniforms.uScan.value };
  }
  function peek(id: Id, done: () => void) {
    if (pk) return;
    if (reduce) {
      done();
      return;
    }
    if (sw) {
      for (const k of ORDER) items[k].visible = k === id;
      setScan(items[id], 1);
      current = id;
      sw = null;
    }
    pk = { id, t0: performance.now(), done };
  }

  const resize = () => {
    const w = holder.clientWidth;
    const h = holder.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (reduce) render();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(holder);
  resize();
  let onScreen = true;
  const io = new IntersectionObserver((e) => (onScreen = e[0].isIntersecting));
  io.observe(holder);

  let raf = 0;
  let last = performance.now();
  let flick = 1;
  let dip = 0;
  let reinAngle = -0.8;
  let reinFrame = 0;
  function render() {
    renderer.render(scene, camera);
  }
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!onScreen) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    tone();
    if (dip <= 0 && Math.random() < (sw ? 0.18 : 0.004)) dip = 0.04 + Math.random() * 0.07;
    const target = dip > 0 ? 0.72 + Math.random() * 0.12 : 0.95 + Math.sin(t * 6.1) * 0.025 + Math.sin(t * 11.7) * 0.02;
    flick += (target - flick) * 0.5;
    dip -= dt;
    mats.forEach((m) => {
      m.uniforms.uTime.value = t;
      m.uniforms.uFlick.value = flick;
    });
    if (items.rein.visible) {
      reinAngle += dt * 1.6;
      if ((reinFrame = (reinFrame + 1) % 2) === 0) drawRein(reinAngle);
    }
    if (sw) {
      const e = now - sw.t0;
      if (e < OUT) setScan(items[sw.from], sw.start * (1 - e / OUT));
      else if (e < OUT + BEAT) {
        items[sw.from].visible = false;
        setScan(items[sw.from], 1);
      } else if (e < OUT + BEAT + IN) {
        items[sw.to].visible = true;
        setScan(items[sw.to], 1 - Math.pow(1 - (e - OUT - BEAT) / IN, 3));
      } else {
        setScan(items[sw.to], 1);
        current = sw.to;
        const id = sw.to;
        sw = null;
        onShown(id);
      }
    }
    if (pk) {
      const e = now - pk.t0;
      const it = items[pk.id];
      if (e < 220) setScan(it, 1 - e / 220);
      else if (e < 1500) {
        it.visible = false;
        showPeek(pk.id, Math.min(1, (e - 220) / 600));
      } else {
        const done = pk.done;
        peeks[pk.id].visible = false;
        it.visible = true;
        setScan(it, 1);
        pk = null;
        done();
      }
    }
    render();
  }
  if (reduce) {
    tone();
    render();
  } else raf = requestAnimationFrame(frame);

  return {
    choose,
    peek,
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => {
        const mesh = o as InstanceType<typeof THREE.Mesh>;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      mats.forEach((m) => {
        (m.uniforms.uMap.value as InstanceType<typeof THREE.Texture> | null)?.dispose();
        m.dispose();
      });
      renderer.dispose();
    },
  };
}

export function PlaygroundHologram({ go }: { go: (p: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [shown, setShown] = useState<Id>('x');
  const [picked, setPicked] = useState<Id>('x');
  const [failed, setFailed] = useState(false);
  const [says, setSays] = useState(false);
  const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let alive = true;
    if (!canvas.current || !holder.current) return;
    makeStage(canvas.current, holder.current, reduce, (id) => alive && setShown(id)).then(
      (s) => {
        if (alive) stage.current = s;
        else s.dispose();
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      stage.current?.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    if (shown !== 'rein') return;
    setSays(true);
    const t = window.setTimeout(() => setSays(false), 2600);
    return () => window.clearTimeout(t);
  }, [shown]);

  function choose(id: Id) {
    setPicked(id);
    setSays(false);
    stage.current?.choose(id);
  }
  function stepIn(id: Id) {
    if (!stage.current || failed) return go(INFO[id].path);
    stage.current.peek(id, () => go(INFO[id].path));
  }

  return (
    <div className="bl-holo">
      <div className="bl-holo-stage" ref={holder}>
        <canvas ref={canvas} role="img" aria-label={picked === 'rein' ? 'Hologram of Rein' : `Hologram showing the ${INFO[picked].name} logo`} />
        {failed && (
          <img className="bl-holo-still" src={picked === 'ig' ? '/brand/instagram-glyph-white.png' : '/brand/x-logo-white.png'} alt="" hidden={picked === 'rein'} />
        )}
        <div className={`bl-holo-says${says ? ' on' : ''}`} aria-live="polite">
          {says ? 'Let’s see what’s rising.' : ''}
        </div>
      </div>
      <div className="bl-holo-pill" role="group" aria-label="Choose a space">
        {ORDER.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={picked === id}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') choose(id);
            }}
            onClick={(e) => {
              const mouse = (e.nativeEvent as PointerEvent).pointerType === 'mouse' || (canHover && (e.nativeEvent as PointerEvent).pointerType !== 'touch');
              if (mouse) {
                if (picked !== id) choose(id);
                stepIn(id);
              } else if (picked === id) stepIn(id);
              else choose(id);
            }}
          >
            {id === 'ig' ? 'IG' : id.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="bl-holo-what">{INFO[picked].what}</p>
      <p className="bl-holo-how">{canHover ? 'Hover to preview, click to step in.' : 'Tap to preview, tap again to step in.'}</p>
    </div>
  );
}

/** The paper playground: cut paper in Backlot's colors, fading into the page at every edge. */
export function PaperPlayground() {
  const seat = useRef<SVGGElement>(null);
  const back = useRef<SVGGElement>(null);
  const front = useRef<SVGGElement>(null);
  const chute = useRef<SVGPathElement>(null);
  const ball = useRef<SVGCircleElement>(null);
  const layers = useRef<SVGGElement[]>([]);
  const state = useRef({ swingAmp: 7, swingT: 0, merryTh: 0, merryW: 0, ballT: -1 });

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const NS = 'http://www.w3.org/2000/svg';
    const posts = [0, 1, 2, 3].map(() => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('width', '3');
      r.setAttribute('height', '18');
      r.setAttribute('rx', '1.5');
      r.setAttribute('class', 'pp-ink');
      return r;
    });
    const s = state.current;
    const draw = (dt: number) => {
      s.swingT += dt * 1.9;
      s.swingAmp += (7 - s.swingAmp) * Math.min(1, dt * 0.45);
      seat.current?.setAttribute('transform', `rotate(${(Math.sin(s.swingT) * s.swingAmp).toFixed(2)} 88 60)`);
      s.merryTh += s.merryW * dt;
      s.merryW *= Math.pow(0.35, dt);
      back.current?.replaceChildren();
      front.current?.replaceChildren();
      posts.forEach((p, i) => {
        const a = s.merryTh + (i * Math.PI) / 2;
        const z = Math.sin(a);
        p.setAttribute('x', (186 + Math.cos(a) * 30 - 1.5).toFixed(2));
        p.setAttribute('y', (134 + z * 6).toFixed(2));
        p.setAttribute('opacity', z < 0 ? '0.55' : '1');
        (z < 0 ? back.current : front.current)?.appendChild(p);
      });
      if (s.ballT >= 0 && chute.current && ball.current) {
        s.ballT += dt * 0.9;
        const k = Math.min(1, s.ballT);
        const pt = chute.current.getPointAtLength(k * k * chute.current.getTotalLength());
        ball.current.setAttribute('cx', pt.x.toFixed(2));
        ball.current.setAttribute('cy', (pt.y - 5).toFixed(2));
        if (s.ballT > 1.25) {
          s.ballT = -1;
          ball.current.setAttribute('cx', '-20');
        }
      }
    };
    draw(0);
    if (reduce) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      draw(Math.min(0.05, (now - last) / 1000));
      last = now;
    };
    raf = requestAnimationFrame(tick);
    const move = (e: PointerEvent) => {
      const px = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
      const py = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
      layers.current.forEach((l) => {
        const d = Number(l.dataset.depth);
        l.style.transform = `translate(${(-px * 7 * d).toFixed(2)}px, ${(-py * 3 * d).toFixed(2)}px)`;
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  const act = (what: 'swing' | 'merry' | 'slide') => {
    const s = state.current;
    if (what === 'swing') s.swingAmp = 34;
    if (what === 'merry') s.merryW = 7;
    if (what === 'slide' && s.ballT < 0) s.ballT = 0;
  };
  const piece = (what: 'swing' | 'merry' | 'slide', label: string) => ({
    className: 'pp-piece',
    tabIndex: 0,
    role: 'button',
    'aria-label': label,
    onClick: () => act(what),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        act(what);
      }
    },
  });
  const layer = (i: number) => (el: SVGGElement | null) => {
    if (el) layers.current[i] = el;
  };

  return (
    <div className="bl-paper">
      <svg viewBox="0 0 360 200" role="group" aria-label="The playground: tap the swing, the merry-go-round or the slide">
        <defs>
          <filter id="pp-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
          <radialGradient id="pp-spot" cx="50%" cy="0%" r="90%">
            <stop offset="0%" className="pp-spot-a" />
            <stop offset="100%" className="pp-spot-b" />
          </radialGradient>
        </defs>
        <g ref={layer(0)} className="pp-layer" data-depth="0.25">
          <path d="M110 -10 L250 -10 L330 160 L30 160 Z" fill="url(#pp-spot)" opacity="0.7" />
          <path className="pp-mist" d="M-10 150 C50 118 110 126 170 116 C240 104 300 122 370 108 L370 200 L-10 200 Z" />
          <path className="pp-hi" d="M-10 150 C50 118 110 126 170 116 C240 104 300 122 370 108" opacity="0.7" />
        </g>
        <g ref={layer(1)} className="pp-layer" data-depth="0.5">
          <path className="pp-paper" d="M-10 168 C90 158 270 158 370 166 L370 200 L-10 200 Z" />
          <path className="pp-hi" d="M-10 168 C90 158 270 158 370 166" />
          <ellipse className="pp-line" cx="88" cy="172" rx="52" ry="5" opacity="0.6" />
          <ellipse className="pp-line" cx="186" cy="174" rx="40" ry="5" opacity="0.6" />
          <ellipse className="pp-line" cx="306" cy="172" rx="40" ry="5" opacity="0.6" />
        </g>
        <g ref={layer(2)} className="pp-layer" data-depth="1">
          <g {...piece('swing', 'Swing')}>
            <path className="pp-ink" d="M44 172 L77 60 L84 60 L53 172 Z" />
            <path className="pp-ink" d="M132 172 L99 60 L92 60 L123 172 Z" />
            <rect className="pp-ink" x="66" y="55" width="44" height="8" rx="3" />
            <path className="pp-hi" d="M68 56 L108 56" />
            <g ref={seat}>
              <line className="pp-rope" x1="80" y1="62" x2="80" y2="140" />
              <line className="pp-rope" x1="96" y1="62" x2="96" y2="140" />
              <rect className="pp-accent" x="73" y="138" width="30" height="7" rx="3.5" />
              <path className="pp-hi" d="M76 139 L100 139" />
            </g>
            <rect x="40" y="50" width="96" height="124" fill="transparent" />
          </g>
          <g {...piece('merry', 'Merry-go-round')}>
            <rect className="pp-line" x="183" y="150" width="6" height="22" rx="2" />
            <g ref={back} />
            <ellipse className="pp-edge" cx="186" cy="154" rx="38" ry="9" />
            <ellipse className="pp-wash" cx="186" cy="151" rx="38" ry="9" />
            <path className="pp-hi" d="M150 149 C170 141 202 141 222 149" />
            <rect className="pp-ink" x="184" y="118" width="4" height="34" rx="2" />
            <circle className="pp-accent" cx="186" cy="117" r="5" />
            <g ref={front} />
            <rect x="146" y="108" width="80" height="68" fill="transparent" />
          </g>
          <g {...piece('slide', 'Slide')}>
            <rect className="pp-ink" x="320" y="78" width="5" height="94" rx="2" />
            <rect className="pp-ink" x="336" y="78" width="5" height="94" rx="2" />
            <g className="pp-line">
              <rect x="322" y="92" width="16" height="3" rx="1.5" />
              <rect x="322" y="112" width="16" height="3" rx="1.5" />
              <rect x="322" y="132" width="16" height="3" rx="1.5" />
              <rect x="322" y="152" width="16" height="3" rx="1.5" />
            </g>
            <path className="pp-accent" d="M318 80 L328 80 C300 110 286 150 262 168 L248 168 C274 148 290 108 318 80 Z" />
            <path ref={chute} d="M322 82 C296 110 282 150 254 166" fill="none" stroke="none" />
            <path className="pp-hi" d="M319 82 C292 110 278 148 252 166" opacity="0.8" />
            <rect className="pp-ink" x="316" y="74" width="28" height="7" rx="3" />
            <circle ref={ball} className="pp-ball" r="5.5" cx="-20" cy="-20" />
            <rect x="244" y="70" width="104" height="104" fill="transparent" />
          </g>
        </g>
        <rect x="-10" y="-10" width="380" height="220" filter="url(#pp-grain)" fill="#000" pointerEvents="none" style={{ mixBlendMode: 'multiply' }} />
      </svg>
    </div>
  );
}
