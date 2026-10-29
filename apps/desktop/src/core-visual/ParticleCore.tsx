import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RunState } from '../../../../contracts';

const vertex = `
  attribute float seed;
  uniform float uTime; uniform float uEnergy; uniform float uAmplitude; uniform float uReduced;
  varying float vAlpha; varying float vDepth; varying float vScan;
  void main() {
    vec3 p = position;
    float motion = (1.0-uReduced) * (0.003 + uEnergy*0.018 + uAmplitude*0.035);
    float ripple = sin(uTime*2.7 - position.y*6.0 + seed*3.0);
    p += normal * (sin(uTime*1.6+seed*40.0) * motion + ripple*uEnergy*0.009*(1.0-uReduced));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.1+seed*1.5+uEnergy*0.45) * (3.0/-mv.z);
    vAlpha = 0.42 + seed*0.5 + sin(seed*100.0+uTime)*0.08;
    vDepth = p.z;
    vScan = exp(-pow((position.y - sin(uTime*1.1)*1.05)*7.0,2.0))*uEnergy*(1.0-uReduced);
  }
`;
const fragment = `
  uniform vec3 uColor; varying float vAlpha; varying float vDepth; varying float vScan;
  void main() {
    float d=length(gl_PointCoord-vec2(0.5));
    if(d>0.5) discard;
    float a = smoothstep(0.5,0.08,d) * vAlpha;
    gl_FragColor=vec4(mix(uColor,vec3(0.7,1.0,1.0),vScan*0.65)*(0.7+vDepth*0.5+vScan*0.45), min(1.0,a+vScan*0.15));
  }
`;

function Face({ state, count, reduced, amplitude, onQuality }: { state: RunState; count: number; reduced: boolean; amplitude: number; onQuality: (n: number) => void }) {
  const points = useRef<THREE.Points>(null);
  const frame = useRef({ samples: 0, time: 0, elapsed: 0 });
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), seeds = new Float32Array(count);
    let seed = 1701;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const gauss = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-((x-cx)**2/sx + (y-cy)**2/sy));
    for (let i = 0; i < count; i++) {
      const u = random(), angle = random() * Math.PI * 2;
      const y = 1 - 2 * u, ring = Math.sqrt(1 - y*y);
      const taper = 0.77 + 0.23 * Math.min(1, (y+1)*1.7);
      let x = Math.cos(angle) * ring * .68 * taper;
      let z = Math.sin(angle) * ring * .63;
      const py = y * 1.08;
      if (z > 0) {
        z += .28 * gauss(x, py, 0, -.02, .012, .12);
        z -= .13 * (gauss(x, py, -.24, .19, .018, .008) + gauss(x, py, .24, .19, .018, .008));
        z += .07 * (gauss(x, py, -.24, .32, .028, .006) + gauss(x, py, .24, .32, .028, .006));
        z -= .12 * gauss(x, py, 0, -.36, .065, .002);
        z += .05 * gauss(x, py, 0, -.31, .06, .007);
        z += .06 * gauss(x, py, 0, -.68, .08, .03);
      }
      positions.set([x, py, z], i*3);
      const normal = new THREE.Vector3(x, py, z).normalize();
      normals.set([normal.x, normal.y, normal.z], i*3); seeds[i] = random();
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    result.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    result.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    return result;
  }, [count]);
  const material = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 }, uAmplitude: { value: 0 }, uReduced: { value: 0 }, uColor: { value: new THREE.Color('#27b9ee') } },
  }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    if (!points.current) return;
    if (document.hidden) return;
    const f = frame.current;
    f.elapsed += Math.min(delta, .05);
    material.uniforms.uTime.value = reduced ? 0 : f.elapsed;
    material.uniforms.uAmplitude.value = amplitude;
    const targetEnergy = ['processing', 'executing'].includes(state) ? 1 : state === 'speaking' ? .4 : .1;
    material.uniforms.uEnergy.value = THREE.MathUtils.damp(material.uniforms.uEnergy.value, targetEnergy, 3.5, delta);
    material.uniforms.uReduced.value = reduced ? 1 : 0;
    material.uniforms.uColor.value.set(state === 'error' ? '#ff6870' : state === 'awaiting_approval' ? '#efbc61' : '#65cfff');
    points.current.rotation.y = .96 + (reduced ? 0 : Math.sin(f.elapsed * .12) * .1);
    points.current.rotation.x = -.03;
    points.current.scale.setScalar(1 + (reduced ? 0 : Math.sin(f.elapsed * 2.2) * .012 * material.uniforms.uEnergy.value));
    f.samples++; f.time += delta;
    if (f.samples === 180 && f.time > 7 && count > 4000) { geometry.setDrawRange(0, 4000); onQuality(4000); }
  });
  return <points ref={points} geometry={geometry} material={material} />;
}

class VisualBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function FlatFace() {
  return <svg className="flat-face" viewBox="0 0 250 300" aria-label="Núcleo visual 2D"><path d="M88 248C75 226 58 200 54 162C49 122 61 54 119 39C175 25 204 70 195 115L209 151L192 160L190 187L178 194L176 216L143 236L139 267M64 152L87 140L105 145M149 138L173 131M144 152L152 174L139 180M118 205L156 203" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="1 5" /></svg>;
}

export default function ParticleCore({ state, count = 8000, reduced = false, amplitude = 0 }: { state: RunState; count?: number; reduced?: boolean; amplitude?: number }) {
  const [actual, setActual] = useState(count);
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const quiet = reduced || systemReduced;
  useEffect(() => setActual(count), [count]);
  return <div className={`visual-core core-${state} ${quiet ? 'reduced' : ''}`}>
    <div className="core-halo" />
    <svg className="core-rings" viewBox="0 0 600 600" aria-hidden="true">
      <defs>
        <linearGradient id="core-sweep" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#05718c" stopOpacity="0"/><stop offset="65%" stopColor="#12bddc" stopOpacity=".5"/><stop offset="100%" stopColor="#a4f7ff"/></linearGradient>
        <filter id="core-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <circle className="ring-track" cx="300" cy="300" r="267" />
      <circle className="ring-a" cx="300" cy="300" r="267" />
      <circle className="ring-b" cx="300" cy="300" r="247" />
      <circle className="ring-c" cx="300" cy="300" r="279" />
      <circle className="ring-processing" cx="300" cy="300" r="229" />
      <g className="ring-ticks">{Array.from({ length: 60 }, (_, i) => {
        const a = i * Math.PI / 30, r = i % 5 === 0 ? 294 : 291;
        return <line key={i} x1={300 + Math.sin(a)*r} y1={300 + Math.cos(a)*r} x2={300 + Math.sin(a)*287} y2={300 + Math.cos(a)*287} opacity={i%5===0 ? .8 : .22} />;
      })}</g>
      <path d="M300 12v15M300 573v15M12 300h15M573 300h15" />
      <path className="crosshair" d="M280 300h40M300 280v40" />
    </svg>
    <div className="face-canvas">
      <VisualBoundary fallback={<FlatFace />}>
        <Suspense fallback={<FlatFace />}>
          <Canvas camera={{ position: [0, 0, 3.8], fov: 42 }} frameloop={quiet ? 'demand' : 'always'} dpr={[1, 1.5]} gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }} fallback={<FlatFace />}>
            <Face state={state} count={count} reduced={quiet} amplitude={amplitude} onQuality={setActual} />
          </Canvas>
        </Suspense>
      </VisualBoundary>
    </div>
    {['processing', 'executing'].includes(state) && <div className="core-thinking-tag"><i/><span>{state === 'processing' ? 'ANALISANDO' : 'EXECUTANDO'}</span><i/></div>}
    <span className="core-caption">VISUAL CORE <span>·</span> {(actual / 1000).toFixed(0).padStart(2, '0')}K PARTICLES <span>·</span> EXPRESSÃO SIMULADA</span>
  </div>;
}
