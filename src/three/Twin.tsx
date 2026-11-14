import { Canvas, useFrame } from '@react-three/fiber'
import { createContext, useContext, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Status } from '../config/rules'
import type { Zone } from '../sim/issues'
import { useStore } from '../store'
import { useTabVisible } from '../ui/hooks'

export const STATUS_COLOR: Record<Status, string> = { ok: '#34d399', warn: '#f5b83d', bad: '#f2625f' }
const ICE = '#6db3ff'

const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`
const FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform float uPulse;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float scan = 0.5 + 0.5 * sin(vW.y * 80.0 - uTime * 3.0);
  float band = smoothstep(0.97, 1.0, 0.5 + 0.5 * sin(vW.y * 1.5 - uTime * 0.8));
  float a = f * 0.8 + 0.04 + scan * 0.05 + band * 0.3;
  a *= 1.0 + uPulse * 0.45 * sin(uTime * 5.0);
  gl_FragColor = vec4(uColor * (0.55 + f), a);
}`

type Part = { p: [number, number, number]; s?: [number, number, number]; r?: number; cap?: [number, number] ; sph?: number }
// Cuerpo sencillo hecho con cápsulas y esferas (sin modelos externos)
const BODY: Part[] = [
  { p: [0, 1.5, 0], sph: 0.25, s: [0.92, 1.08, 1] }, // cabeza
  { p: [0, 1.2, 0], cap: [0.085, 0.1] }, // cuello
  { p: [-0.41, 1.02, 0], sph: 0.115 }, { p: [0.41, 1.02, 0], sph: 0.115 }, // hombros
  { p: [-0.48, 0.7, 0], cap: [0.085, 0.42], r: -0.12 }, { p: [0.48, 0.7, 0], cap: [0.085, 0.42], r: 0.12 }, // brazos
  { p: [-0.56, 0.18, 0.02], cap: [0.068, 0.42], r: -0.08 }, { p: [0.56, 0.18, 0.02], cap: [0.068, 0.42], r: 0.08 }, // antebrazos
  { p: [-0.6, -0.16, 0.03], sph: 0.085, s: [0.8, 1.2, 0.6] }, { p: [0.6, -0.16, 0.03], sph: 0.085, s: [0.8, 1.2, 0.6] }, // manos
  { p: [-0.165, -0.5, 0], cap: [0.135, 0.56], r: -0.03 }, { p: [0.165, -0.5, 0], cap: [0.135, 0.56], r: 0.03 }, // muslos
  { p: [-0.18, -1.26, 0], cap: [0.098, 0.56] }, { p: [0.18, -1.26, 0], cap: [0.098, 0.56] }, // piernas
  { p: [-0.18, -1.7, 0.07], cap: [0.075, 0.14], s: [1, 1, 1], r: 0 }, { p: [0.18, -1.7, 0.07], cap: [0.075, 0.14] }, // pies
]

// Torso de una sola pieza: perfil girado (cadera, cintura, pecho, hombros)
const TORSO = new THREE.LatheGeometry(
  [[0.001, -0.2], [0.2, -0.17], [0.285, -0.05], [0.28, 0.1], [0.225, 0.42], [0.25, 0.62], [0.33, 0.86], [0.345, 1.0], [0.26, 1.1], [0.1, 1.15], [0.001, 1.16]]
    .map(([x, y]) => new THREE.Vector2(x, y)), 32)
const noRay = () => null
const ZoneMat = createContext<THREE.Material | null>(null)

function Shell({ status }: { status: Status }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(ICE) }, uPulse: { value: 0 } },
  }), [])
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime
    mat.uniforms.uPulse.value = status === 'ok' ? 0 : 1
    ;(mat.uniforms.uColor.value as THREE.Color).lerp(new THREE.Color(status === 'ok' ? ICE : STATUS_COLOR[status]), 0.08)
  })
  return (
    <group>
      {BODY.map((b, i) => (
        <mesh key={i} position={b.p} scale={b.s} rotation={[i >= 14 ? Math.PI / 2 : 0, 0, b.r ?? 0]} material={mat} raycast={noRay}>
          {b.sph ? <sphereGeometry args={[b.sph, 24, 18]} /> : <capsuleGeometry args={[b.cap![0], b.cap![1], 6, 20]} />}
        </mesh>
      ))}
      <mesh geometry={TORSO} material={mat} scale={[1, 1, 0.6]} raycast={noRay} />
    </group>
  )
}

function ZoneGroup({ zone, status, hit, children }: {
  zone: Zone; status: Status; hit: { p: [number, number, number]; r: number }[]; children: React.ReactNode
}) {
  const ref = useRef<THREE.Group>(null)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: STATUS_COLOR.ok, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  }), [])
  const setHighlight = useStore((s) => s.setHighlight)
  const active = useStore((s) => s.highlight === zone)
  const target = useMemo(() => new THREE.Color(), [])
  useFrame(({ clock }) => {
    target.set(STATUS_COLOR[status])
    mat.color.lerp(target, 0.1)
    const t = clock.elapsedTime
    const pulse = status === 'bad' ? 0.5 + 0.5 * Math.sin(t * 7) : status === 'warn' ? 0.5 + 0.5 * Math.sin(t * 3.5) : 0
    mat.opacity = status === 'ok' ? (active ? 1 : 0.62) : 0.55 + 0.45 * pulse
    const k = 1 + (status === 'ok' ? 0 : 0.22 * pulse) + (active ? 0.18 : 0)
    ref.current?.children.forEach((c) => { if (c.userData.pulse) c.scale.setScalar(k) })
  })
  return (
    <group ref={ref}>
      <ZoneMat.Provider value={mat}>{children}</ZoneMat.Provider>
      {hit.map((h, i) => (
        <mesh key={i} position={h.p}
          onPointerDown={(e) => { e.stopPropagation(); setHighlight(zone) }}
          onPointerOver={() => { document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { document.body.style.cursor = '' }}>
          <sphereGeometry args={[h.r, 10, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}
function Z({ p, s, r, children }: { p: [number, number, number]; s?: [number, number, number]; r?: number; children: React.ReactNode }) {
  const mat = useContext(ZoneMat)!
  return (
    <group position={p} userData={{ pulse: true }}>
      <mesh scale={s} rotation={[0, 0, r ?? 0]} material={mat} raycast={noRay}>{children}</mesh>
    </group>
  )
}

function Dust() {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const n = 140; const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const r = 0.5 + Math.random() * 0.75
      pos.set([Math.cos(a) * r, -1.8 + Math.random() * 3.7, Math.sin(a) * r], i * 3)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); return g
  }, [])
  useFrame((_, dt) => {
    const a = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < a.count; i++) { let y = a.getY(i) + dt * 0.12; if (y > 1.9) y = -1.8; a.setY(i, y) }
    a.needsUpdate = true
    if (ref.current) ref.current.rotation.y -= dt * 0.1
  })
  return (
    <points ref={ref} geometry={geo} raycast={noRay}>
      <pointsMaterial color={ICE} size={0.018} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

function Figure({ zones }: { zones: Record<Zone, Status> }) {
  const g = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const lowPerf = useStore((s) => s.lowPerf)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  useFrame((_, dt) => {
    if (g.current && !still) g.current.rotation.y += dt * 0.28
    if (ring.current) ring.current.rotation.z -= dt * 0.4
  })
  const spine = Array.from({ length: 10 }, (_, i) => 0.06 + i * 0.118)
  return (
    <group position={[0, 0.08, 0]}>
      <group ref={g} rotation={[0, 0.5, 0]}>
        <Shell status={zones.body} />
        <ZoneGroup zone="head" status={zones.head} hit={[{ p: [0, 1.5, 0], r: 0.27 }]}>
          <Z p={[0, 1.54, 0]} s={[1, 0.85, 1.1]}><sphereGeometry args={[0.15, 16, 12]} /></Z>
        </ZoneGroup>
        <ZoneGroup zone="heart" status={zones.heart} hit={[{ p: [0.07, 0.9, 0.06], r: 0.17 }]}>
          <Z p={[0.07, 0.9, 0.06]} s={[1, 1.15, 0.9]}><sphereGeometry args={[0.085, 16, 12]} /></Z>
        </ZoneGroup>
        <ZoneGroup zone="kidneys" status={zones.kidneys} hit={[{ p: [-0.13, 0.4, -0.05], r: 0.12 }, { p: [0.13, 0.4, -0.05], r: 0.12 }]}>
          <Z p={[-0.13, 0.4, -0.06]} s={[0.75, 1.25, 0.7]}><sphereGeometry args={[0.06, 12, 10]} /></Z>
          <Z p={[0.13, 0.4, -0.06]} s={[0.75, 1.25, 0.7]}><sphereGeometry args={[0.06, 12, 10]} /></Z>
        </ZoneGroup>
        <ZoneGroup zone="bones" status={zones.bones}
          hit={[{ p: [0, 0.75, -0.12], r: 0.1 }, { p: [0, 0.2, -0.12], r: 0.1 }, { p: [-0.165, -0.5, 0], r: 0.14 }, { p: [0.165, -0.5, 0], r: 0.14 }]}>
          {spine.map((y) => <Z key={y} p={[0, y, -0.11]}><boxGeometry args={[0.07, 0.07, 0.06]} /></Z>)}
          <Z p={[-0.165, -0.5, 0]} r={-0.03}><cylinderGeometry args={[0.026, 0.032, 0.66, 8]} /></Z>
          <Z p={[0.165, -0.5, 0]} r={0.03}><cylinderGeometry args={[0.026, 0.032, 0.66, 8]} /></Z>
        </ZoneGroup>
        <ZoneGroup zone="muscles" status={zones.muscles}
          hit={[{ p: [-0.48, 0.74, 0], r: 0.13 }, { p: [0.48, 0.74, 0], r: 0.13 }, { p: [-0.18, -1.18, 0], r: 0.14 }, { p: [0.18, -1.18, 0], r: 0.14 }]}>
          <Z p={[-0.48, 0.76, 0.02]} s={[0.8, 2.2, 0.8]} r={-0.12}><sphereGeometry args={[0.062, 12, 10]} /></Z>
          <Z p={[0.48, 0.76, 0.02]} s={[0.8, 2.2, 0.8]} r={0.12}><sphereGeometry args={[0.062, 12, 10]} /></Z>
          <Z p={[-0.18, -1.14, -0.02]} s={[0.85, 2.4, 0.85]}><sphereGeometry args={[0.07, 12, 10]} /></Z>
          <Z p={[0.18, -1.14, -0.02]} s={[0.85, 2.4, 0.85]}><sphereGeometry args={[0.07, 12, 10]} /></Z>
        </ZoneGroup>
      </group>
      {/* Base del proyector */}
      <mesh ref={ring} position={[0, -1.86, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
        <ringGeometry args={[0.78, 0.82, 48, 1, 0, Math.PI * 1.6]} />
        <meshBasicMaterial color={ICE} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, -1.87, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
        <circleGeometry args={[0.7, 48]} />
        <meshBasicMaterial color={ICE} transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {!lowPerf && !still && <Dust />}
    </group>
  )
}

export function Twin({ zones }: { zones: Record<Zone, Status> }) {
  const visible = useTabVisible()
  const setHighlight = useStore((s) => s.setHighlight)
  return (
    <Canvas dpr={[1, 2]} frameloop={visible ? 'always' : 'never'} camera={{ fov: 32, position: [0, 0, 7.4] }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => setHighlight(null)} aria-label="Gemelo digital en 3D">
      <Figure zones={zones} />
    </Canvas>
  )
}

/** Alternativa plana si el equipo no tiene WebGL. */
export function TwinFlat({ zones }: { zones: Record<Zone, Status> }) {
  const setHighlight = useStore((s) => s.setHighlight)
  const c = (z: Zone) => STATUS_COLOR[zones[z]]
  const hit = (z: Zone) => ({ onClick: () => setHighlight(z), style: { cursor: 'pointer' } })
  return (
    <svg viewBox="0 0 200 400" style={{ width: '100%', height: '100%' }} role="img" aria-label="Gemelo digital">
      <g fill="none" stroke={zones.body === 'ok' ? ICE : c('body')} strokeWidth="1.5" opacity="0.8">
        <ellipse cx="100" cy="45" rx="24" ry="28" /><rect x="64" y="84" width="72" height="120" rx="26" />
        <rect x="36" y="92" width="20" height="118" rx="10" /><rect x="144" y="92" width="20" height="118" rx="10" />
        <rect x="70" y="208" width="26" height="170" rx="13" /><rect x="104" y="208" width="26" height="170" rx="13" />
      </g>
      <circle cx="100" cy="42" r="14" fill={c('head')} opacity="0.8" {...hit('head')} />
      <circle cx="108" cy="112" r="9" fill={c('heart')} opacity="0.9" {...hit('heart')} />
      <g fill={c('kidneys')} opacity="0.9" {...hit('kidneys')}><ellipse cx="88" cy="160" rx="6" ry="9" /><ellipse cx="112" cy="160" rx="6" ry="9" /></g>
      <g stroke={c('bones')} strokeWidth="5" strokeDasharray="6 4" {...hit('bones')}><path d="M100 90V196M83 216V282M117 216V282" /></g>
      <g fill={c('muscles')} opacity="0.85" {...hit('muscles')}><ellipse cx="46" cy="122" rx="6" ry="20" /><ellipse cx="154" cy="122" rx="6" ry="20" /><ellipse cx="83" cy="330" rx="7" ry="24" /><ellipse cx="117" cy="330" rx="7" ry="24" /></g>
    </svg>
  )
}
