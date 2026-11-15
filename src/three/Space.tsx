import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'
import { reducedMotion, useTabVisible } from '../ui/hooks'

const NOISE = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7); a *= 0.5; } return s; }
`
const VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vP; varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vObj = position; vUv = uv; vN = normalize(normalMatrix * normal); vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`
const PLANET = /* glsl */ `
uniform float uKind; uniform float uTime; uniform vec3 uSun; uniform sampler2D uMap; uniform float uUseMap;
uniform sampler2D uNight; uniform float uUseNight;
varying vec3 vObj; varying vec3 vN; varying vec3 vP; varying vec2 vUv;
${NOISE}
void main() {
  vec3 N = normalize(vN); vec3 V = normalize(-vP); vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float day = smoothstep(-0.12, 0.3, ndl);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 p = normalize(vObj);
  vec3 col;
  if (uKind < 0.5) {
    // Tierra: mares, continentes, hielo, nubes, luces de ciudad y atmósfera
    float h = fbm(p * 1.9 + vec3(4.2, 1.3, 7.7)) + 0.35 * fbm(p * 6.0 + 2.0) - 0.17;
    float land = smoothstep(0.5, 0.53, h);
    float lat = abs(p.y);
    vec3 ocean = mix(vec3(0.01, 0.05, 0.18), vec3(0.03, 0.2, 0.42), smoothstep(0.3, 0.5, h));
    float dry = fbm(p * 4.0 + 9.0);
    vec3 ground = mix(vec3(0.09, 0.27, 0.1), vec3(0.48, 0.4, 0.24), smoothstep(0.45, 0.62, dry) * (1.0 - smoothstep(0.45, 0.75, lat)));
    ground = mix(ground, vec3(0.3, 0.25, 0.2), smoothstep(0.6, 0.75, h));
    vec3 surf = mix(ocean, ground, land);
    float ice = smoothstep(0.9, 0.96, lat + (h - 0.5) * 0.2);
    surf = mix(surf, vec3(0.9, 0.95, 1.0), ice);
    if (uUseMap > 0.5) {
      // Mapa real (Blue Marble, NASA). El mar se detecta por su azul para darle brillo de sol.
      surf = texture2D(uMap, vUv).rgb;
      land = 1.0 - smoothstep(0.02, 0.1, surf.b - max(surf.r, surf.g) * 0.9);
      surf = min(pow(surf, vec3(0.9)) * 1.12, vec3(0.94));
      ice = 0.0;
    }
    float cl = fbm(p * 3.2 + vec3(uTime * 0.012, 0.0, uTime * 0.007));
    cl = smoothstep(0.55, 0.78, cl + 0.12 * fbm(p * 9.0) + 0.05 * fbm(p * 24.0));
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 48.0) * (1.0 - land) * (1.0 - cl);
    vec3 lit = surf * day * 1.15 + vec3(1.0, 0.95, 0.85) * spec * 0.7 * day;
    lit = mix(lit, vec3(0.93, 0.95, 1.0) * day, cl * 0.8);
    float city = smoothstep(0.62, 0.75, noise(p * 42.0)) * smoothstep(0.5, 0.7, fbm(p * 7.0 + 5.0)) * land * (1.0 - ice);
    vec3 night = vec3(1.0, 0.72, 0.35) * city * 1.2 * (1.0 - day) * (1.0 - cl * 0.7) + surf * 0.015;
    if (uUseNight > 0.5) {
      // Luces reales de ciudades (Black Marble, NASA)
      vec3 nl = texture2D(uNight, vUv).rgb;
      night = nl * nl * vec3(1.0, 0.8, 0.52) * 3.2 * (1.0 - day) * (1.0 - cl * 0.6) + surf * 0.02;
    }
    col = lit + night;
    col += vec3(0.3, 0.6, 1.0) * fres * (0.12 + 0.95 * day);
    col += vec3(0.9, 0.35, 0.1) * smoothstep(0.0, 0.2, ndl) * (1.0 - smoothstep(0.2, 0.45, ndl)) * 0.08;
  } else if (uKind < 1.5) {
    // Luna: mares oscuros y cráteres
    float m = fbm(p * 2.4 + 11.0);
    vec3 base = mix(vec3(0.2), vec3(0.62, 0.61, 0.58), smoothstep(0.35, 0.6, m));
    base *= 0.8 + 0.4 * fbm(p * 14.0);
    float c = noise(p * 9.0);
    base *= 1.0 - 0.35 * smoothstep(0.72, 0.8, c);
    base += 0.12 * smoothstep(0.66, 0.72, c) * (1.0 - smoothstep(0.72, 0.74, c));
    if (uUseMap > 0.5) base = texture2D(uMap, vUv).rgb;
    col = base * max(ndl, 0.0) * 1.25 + base * 0.012;
  } else {
    // Marte: polvo rojizo, zonas oscuras y casquetes
    float m = fbm(p * 2.6 + 21.0);
    vec3 base = mix(vec3(0.3, 0.12, 0.07), vec3(0.8, 0.42, 0.2), smoothstep(0.3, 0.68, m));
    base = mix(base, vec3(0.55, 0.3, 0.2), 0.4 * fbm(p * 9.0));
    float cap = smoothstep(0.95, 0.985, abs(p.y) + (m - 0.5) * 0.06);
    base = mix(base, vec3(0.95, 0.92, 0.9), cap);
    if (uUseMap > 0.5) base = texture2D(uMap, vUv).rgb;
    col = base * day * 1.1 + vec3(0.9, 0.5, 0.3) * fres * 0.4 * day;
  }
  gl_FragColor = vec4(col, 1.0);
}`
const ATMO = /* glsl */ `
uniform vec3 uSun; uniform vec3 uColor; uniform float uEdge;
varying vec3 vN; varying vec3 vP;
void main() {
  vec3 N = normalize(vN);
  float d = dot(normalize(vP), N);
  float a = pow(smoothstep(0.0, uEdge, d), 2.2);
  float day = smoothstep(-0.35, 0.5, dot(N, normalize(uSun)));
  gl_FragColor = vec4(uColor, a * 0.6 * (0.08 + 0.92 * day));
}`

const SUN = new THREE.Vector3(0.9, -0.04, 0.3).normalize()
const KIND = { earth: 0, moon: 1, mars: 2 }

function useOptionalTexture(name: string | null): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!name) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const t = new THREE.Texture(img)
      t.needsUpdate = true; t.anisotropy = 8
      setTex(t)
    }
    img.onerror = () => { /* sin textura: se usa el shader procedural */ }
    img.src = `${import.meta.env.BASE_URL}textures/${name}.jpg`
    return () => { alive = false }
  }, [name])
  return tex
}

function Planet({ kind, radius, spin, atmo, tilt = [0.25, 0, 0.12], detail = 96 }: {
  kind: keyof typeof KIND; radius: number; spin: number; atmo?: { color: string; scale: number }
  tilt?: [number, number, number]; detail?: number
}) {
  const tex = useOptionalTexture(kind)
  const night = useOptionalTexture(kind === 'earth' ? 'earth-night' : null)
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: PLANET,
    uniforms: { uKind: { value: KIND[kind] }, uTime: { value: 0 }, uSun: { value: SUN }, uMap: { value: null }, uUseMap: { value: 0 }, uNight: { value: null }, uUseNight: { value: 0 } },
  }), [kind])
  const amat = useMemo(() => atmo && new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: ATMO, side: THREE.BackSide, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: SUN }, uColor: { value: new THREE.Color(atmo.color) }, uEdge: { value: Math.sqrt(1 - 1 / (atmo.scale * atmo.scale)) } },
  }), [atmo])
  useEffect(() => { mat.uniforms.uMap.value = tex; mat.uniforms.uUseMap.value = tex ? 1 : 0 }, [tex, mat])
  useEffect(() => { mat.uniforms.uNight.value = night; mat.uniforms.uUseNight.value = night ? 1 : 0 }, [night, mat])
  useFrame(({ clock }, dt) => {
    mat.uniforms.uTime.value = clock.elapsedTime
    if (mesh.current) mesh.current.rotation.y += dt * spin
  })
  return (
    <group>
      <mesh ref={mesh} material={mat} rotation={tilt}><sphereGeometry args={[radius, detail, Math.round(detail * 0.6)]} /></mesh>
      {amat && <mesh material={amat} scale={atmo!.scale}><sphereGeometry args={[radius, detail, Math.round(detail * 0.6)]} /></mesh>}
    </group>
  )
}

function Stars() {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const n = 1600; const pos = new Float32Array(n * 3); const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1; const a = Math.random() * Math.PI * 2; const r = 60 + Math.random() * 30
      const s = Math.sqrt(1 - u * u)
      pos.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3)
      const b = 0.35 + Math.pow(Math.random(), 3) * 0.65; const warm = Math.random()
      col.set([b * (0.8 + 0.2 * warm), b * 0.9, b * (1.0 - 0.15 * warm)], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [])
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.004 })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={1.7} sizeAttenuation={false} vertexColors transparent depthWrite={false} />
    </points>
  )
}

/** Si el equipo no llega a 30 cuadros por segundo, se quitan las partículas. */
function FpsWatch() {
  const acc = useRef({ t: 0, n: 0, slow: 0, warm: 0 })
  useFrame((_, dt) => {
    const a = acc.current
    a.warm += dt
    if (a.warm < 4 || useStore.getState().lowPerf) return
    a.t += dt; a.n += 1
    if (a.t >= 2) {
      a.slow = a.n / a.t < 30 ? a.slow + 1 : 0
      a.t = 0; a.n = 0
      if (a.slow >= 2) useStore.getState().set({ lowPerf: true })
    }
  })
  return null
}

/** Posición del cursor (-1..1) para un leve paralaje: mover la cabeza cambia un poco la vista. */
const look = { x: 0, y: 0 }
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    look.x = (e.clientX / window.innerWidth) * 2 - 1; look.y = (e.clientY / window.innerHeight) * 2 - 1
  }, { passive: true })
}

function Bodies({ boot }: { boot: boolean }) {
  const { viewport, camera } = useThree()
  const w = viewport.width; const h = viewport.height
  const earth = useRef<THREE.Group>(null); const moon = useRef<THREE.Group>(null); const mars = useRef<THREE.Group>(null)
  const still = useMemo(reducedMotion, [])
  // La Tierra es un horizonte curvo en la parte baja del visor, como se ve desde la órbita.
  const R = Math.max(w * 0.8, h * 0.6)
  const narrow = w / h < 0.8 // móvil en vertical: cuerpos más chicos y hacia los lados
  const k = Math.min(1, Math.max(0.5, w / 13))
  const rise = useRef(boot ? 0.46 : 0.27)
  useFrame(({ clock }, dt) => {
    const t = still ? 0 : clock.elapsedTime
    rise.current += ((boot ? 0.46 : 0.27) - rise.current) * Math.min(1, dt * 1.6)
    earth.current?.position.set(-w * 0.1 + Math.sin(t * 0.021) * 0.25, -h / 2 + rise.current * h - R + Math.cos(t * 0.017) * 0.12, 0)
    moon.current?.position.set(w * (narrow ? 0.44 : 0.14) + Math.sin(t * 0.03 + 1) * 0.5, h * 0.5 + Math.cos(t * 0.024) * 0.3, -7)
    mars.current?.position.set(-w * (narrow ? 0.78 : 0.26) + Math.sin(t * 0.02 + 2) * 0.5, h * 0.5 + Math.sin(t * 0.015) * 0.3, -16)
    if (!still) {
      camera.position.x += (look.x * 0.22 - camera.position.x) * 0.04
      camera.position.y += (-look.y * 0.14 - camera.position.y) * 0.04
    }
  })
  return (
    <>
      <group ref={earth}>
        <Planet kind="earth" radius={R} spin={still ? 0 : 0.006} detail={256} tilt={[-0.28, 4.6, 0.12]} atmo={{ color: '#5aa6ff', scale: 1.022 }} />
      </group>
      <group ref={moon}><Planet kind="moon" radius={0.78 * k} spin={still ? 0 : 0.008} tilt={[0.2, 3.1, 0.1]} /></group>
      <group ref={mars}><Planet kind="mars" radius={0.8 * k} spin={still ? 0 : 0.015} atmo={{ color: '#e08a5a', scale: 1.05 }} /></group>
    </>
  )
}

export function Space({ boot }: { boot: boolean }) {
  const visible = useTabVisible()
  const webgl = useStore((s) => s.webgl)
  const lowPerf = useStore((s) => s.lowPerf)
  return (
    <div className={`space${boot ? '' : ' dim'}`} aria-hidden="true">
      <div className="stars-css" />
      {webgl ? (
        <Canvas dpr={[1, 2]} frameloop={visible ? 'always' : 'never'} camera={{ fov: 40, position: [0, 0, 12], near: 0.1, far: 200 }}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {!lowPerf && <Stars />}
          <Bodies boot={boot} />
          <FpsWatch />
        </Canvas>
      ) : (
        <>
          <div className="planet-css earth" /><div className="planet-css moon" /><div className="planet-css mars" />
        </>
      )}
    </div>
  )
}
