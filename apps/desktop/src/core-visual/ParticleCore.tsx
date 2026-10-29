import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RunState } from '../../../../contracts';

const vertex = `
  attribute float seed;
  uniform float uTime; uniform float uEnergy; uniform float uAmplitude; uniform float uReduced;
  varying float vAlpha; varying float vDepth;
  void main() {
    vec3 p = position;
    float motion = (1.0-uReduced) * (0.003 + uEnergy*0.009 + uAmplitude*0.035);
    p += normal * sin(uTime*1.6+seed*40.0) * motion;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.1+seed*1.5) * (3.0/-mv.z);
    vAlpha = 0.42 + seed*0.5 + sin(seed*100.0+uTime)*0.08;
    vDepth = p.z;
  }
`;
const fragment = `
  uniform vec3 uColor; varying float vAlpha; varying float vDepth;
  void main() {
    float d=length(gl_PointCoord-vec2(0.5));
    if(d>0.5) discard;
    float a = smoothstep(0.5,0.08,d) * vAlpha;
    gl_FragColor=vec4(uColor*(0.7+vDepth*0.5), a);
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
    material.uniforms.uEnergy.value = ['processing', 'executing'].includes(state) ? 1 : .15;
    material.uniforms.uReduced.value = reduced ? 1 : 0;
    material.uniforms.uColor.value.set(state === 'error' ? '#ff6870' : state === 'awaiting_approval' ? '#efbc61' : '#65cfff');
    points.current.rotation.y = .96 + (reduced ? 0 : Math.sin(f.elapsed * .12) * .1);
    points.current.rotation.x = -.03;
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
  useEffect(() => setActual(count), [count]);
  return <div className={`visual-core core-${state} ${reduced ? 'reduced' : ''}`}>
    <div className="core-halo" />
    <svg className="core-rings" viewBox="0 0 600 600" aria-hidden="true">
      <circle className="ring-a" cx="300" cy="300" r="267" />
      <circle className="ring-b" cx="300" cy="300" r="247" />
      <circle className="ring-c" cx="300" cy="300" r="279" />
      <path d="M300 12v15M300 573v15M12 300h15M573 300h15" />
      <path className="crosshair" d="M280 300h40M300 280v40" />
    </svg>
    <div className="face-canvas">
      <VisualBoundary fallback={<FlatFace />}>
        <Suspense fallback={<FlatFace />}>
          <Canvas camera={{ position: [0, 0, 3.8], fov: 42 }} frameloop={reduced ? 'demand' : 'always'} dpr={[1, 1.5]} gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }} fallback={<FlatFace />}>
            <Face state={state} count={count} reduced={reduced} amplitude={amplitude} onQuality={setActual} />
          </Canvas>
        </Suspense>
      </VisualBoundary>
    </div>
    <span className="core-caption">VISUAL CORE <span>·</span> {(actual / 1000).toFixed(0).padStart(2, '0')}K PARTICLES <span>·</span> EXPRESSÃO SIMULADA</span>
  </div>;
}
