import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { hasWebGL, useTabVisible } from '../ui/hooks'

/** Segundo de la secuencia en que el casco se sella (o el abrigo queda puesto). */
export const SEAL_AT = 3.4

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const outC = (x: number) => 1 - Math.pow(1 - x, 3)
const inC = (x: number) => x * x * x
const outBack = (x: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }

// ── Texturas procedurales ────────────────────────────────────

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1], srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Tejido: puntos en V que dan relieve a la lana (se usa como bumpMap). */
function knitBump() {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 64)
    g.lineCap = 'round'
    for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
      g.strokeStyle = '#fff'; g.lineWidth = 2.4
      g.beginPath(); g.moveTo(x, y + 1); g.lineTo(x + 4, y + 7); g.lineTo(x + 8, y + 1); g.stroke()
    }
  }, [10, 10], false)
}

/** Lana andina: franjas de color con grecas, vista desde v (0 → 1) y sobre un tejido de puntos. */
function woolTex(bands: [number, string][], zig: string, base: string, repeat: [number, number] = [1, 1]) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256)
    let y = 0
    for (const [h, col] of bands) {
      g.fillStyle = col; g.fillRect(0, y, 256, h * 256); y += h * 256
    }
    // greca en zigzag en la franja ancha del centro
    g.fillStyle = zig
    const y0 = 256 * 0.42; const hh = 256 * 0.16
    for (let x = 0; x < 256; x += 32) {
      g.beginPath(); g.moveTo(x, y0 + hh); g.lineTo(x + 16, y0); g.lineTo(x + 32, y0 + hh); g.lineTo(x + 24, y0 + hh); g.lineTo(x + 16, y0 + 12); g.lineTo(x + 8, y0 + hh); g.closePath(); g.fill()
    }
    for (let yy = 0; yy < 256; yy += 6) for (let x = (yy / 6) % 2 ? 3 : 0; x < 256; x += 6) {
      g.strokeStyle = 'rgba(30,15,10,0.16)'; g.lineWidth = 1
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 3, yy + 5); g.lineTo(x + 6, yy); g.stroke()
    }
  }, repeat)
}

function softDot(rgb = '255,255,255') {
  return canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    r.addColorStop(0, `rgba(${rgb},1)`); r.addColorStop(0.4, `rgba(${rgb},0.4)`); r.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = r; g.fillRect(0, 0, 64, 64)
  })
}

// ── Piezas comunes ───────────────────────────────────────────

function useStart(start: number) {
  return () => (performance.now() - start) / 1000
}

/** Partículas que flotan: polvo en la nave (microgravedad) o escarcha en el aire. */
function Motes({ count, spread, color, size, speed, start, up = 0 }: { count: number; spread: [number, number, number]; color: string; size: number; speed: number; start: number; up?: number }) {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) { p[i * 3] = (Math.random() - 0.5) * spread[0]; p[i * 3 + 1] = (Math.random() - 0.5) * spread[1]; p[i * 3 + 2] = -Math.random() * spread[2] }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return g
  }, [count, spread])
  const tex = useMemo(() => softDot(), [])
  const clock = useStart(start)
  useFrame(() => {
    const a = geo.attributes.position as THREE.BufferAttribute
    const t = clock()
    for (let i = 0; i < count; i++) {
      a.setX(i, a.getX(i) + Math.sin(t * 0.7 + i) * 0.0006 * speed)
      let y = a.getY(i) + (Math.cos(t * 0.5 + i * 1.7) * 0.0005 - up * 0.0006) * speed
      if (y < -spread[1] / 2) y = spread[1] / 2
      a.setY(i, y)
    }
    a.needsUpdate = true
    if (ref.current) ref.current.visible = true
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} color={color} size={size} sizeAttenuation transparent depthWrite={false} opacity={0.8} blending={THREE.AdditiveBlending} />
    </points>
  )
}

function Seg({ lens, i, curl, r, mat }: { lens: number[]; i: number; curl: number; r: number; mat: THREE.Material }) {
  const len = lens[i]
  return (
    <group rotation={[0, curl, 0]}>
      <mesh position={[0, 0, -len / 2]} rotation={[Math.PI / 2, 0, 0]} material={mat}>
        <capsuleGeometry args={[r, len - r, 4, 10]} />
      </mesh>
      {i + 1 < lens.length && <group position={[0, 0, -len]}><Seg lens={lens} i={i + 1} curl={curl} r={r * 0.93} mat={mat} /></group>}
    </group>
  )
}

interface HandMats { main: THREE.Material; plate: THREE.Material; cuff: THREE.Material; ring: THREE.Material; sleeve: THREE.Material }

/**
 * Mano derecha en su propio espacio: la palma mira a -x (hacia lo que sujeta), los dedos van a -z
 * y el antebrazo sale hacia +z (hacia quien mira). La izquierda es el reflejo.
 */
function Hand({ side, kind, mats }: { side: 1 | -1; kind: 'glove' | 'mitten'; mats: HandMats }) {
  const glove = kind === 'glove'
  return (
    <group scale={[side, 1, 1]}>
      {glove ? (
        <>
          <mesh material={mats.main} scale={[0.015, 0.047, 0.04]}><sphereGeometry args={[1, 20, 14]} /></mesh>
          <mesh material={mats.plate} position={[0.012, 0, -0.004]} scale={[0.006, 0.036, 0.033]}><sphereGeometry args={[1, 16, 12]} /></mesh>
          {[0.0285, 0.0095, -0.0095, -0.0285].map((y, i) => (
            <group key={i} position={[-0.004, y, -0.032]}>
              <Seg lens={[0.034 - Math.abs(i - 1.2) * 0.003, 0.028, 0.021]} i={0} curl={0.3} r={0.0097} mat={mats.main} />
            </group>
          ))}
          <group position={[-0.009, 0.036, 0.016]} rotation={[Math.PI / 2 - 0.35, 0, 0]}>
            <Seg lens={[0.034, 0.028]} i={0} curl={0.55} r={0.0125} mat={mats.main} />
          </group>
        </>
      ) : (
        <>
          <mesh material={mats.main} position={[-0.004, 0, -0.02]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.85]}>
            <capsuleGeometry args={[0.037, 0.05, 8, 16]} />
          </mesh>
          <mesh material={mats.main} position={[-0.026, 0.012, -0.018]} rotation={[0.2, 0.7, 0]}>
            <capsuleGeometry args={[0.0145, 0.026, 6, 10]} />
          </mesh>
        </>
      )}
      <group position={[0, 0, 0.034]} rotation={[kind === 'glove' ? 0.95 : 0.8, 0, 0]}>
        <mesh material={mats.cuff} position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.0385, 0.0375, glove ? 0.045 : 0.06, 24]} /></mesh>
        {glove && <mesh material={mats.ring} position={[0, 0, 0.038]}><torusGeometry args={[0.0405, 0.0055, 8, 28]} /></mesh>}
        <mesh material={mats.sleeve} position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[glove ? 0.033 : 0.043, 0.04, 0.6, 20]} /></mesh>
      </group>
    </group>
  )
}

function useBreathCam(start: number, amp = 1) {
  const camera = useThree((s) => s.camera)
  const clock = useStart(start)
  return (extra: { fov?: number; roll?: number } = {}) => {
    const t = clock()
    camera.position.set(Math.sin(t * 0.9) * 0.0016 * amp, Math.sin(t * 1.6) * 0.0035 * amp, 0)
    camera.rotation.set(Math.sin(t * 1.1) * 0.003 * amp, Math.sin(t * 0.7) * 0.003 * amp, extra.roll ?? 0)
    if (extra.fov) {
      const c = camera as THREE.PerspectiveCamera
      if (Math.abs(c.fov - extra.fov) > 0.01) { c.fov = extra.fov; c.updateProjectionMatrix() }
    }
  }
}

/** Distancia de sujeción: se aleja en pantallas altas para que no se recorte. */
function useHold() {
  const aspect = useThree((s) => s.size.width / s.size.height)
  return 0.88 / Math.min(1, Math.max(0.68, aspect * 1.4))
}

// ── ESPACIO: casco ───────────────────────────────────────────

function Env() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.45
    return () => { scene.environment = null; env.dispose(); pm.dispose() }
  }, [gl, scene])
  return null
}

function Earth() {
  const tex = useMemo(() => canvasTex(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    r.addColorStop(0, '#9fd4ff'); r.addColorStop(0.55, '#2d78c8'); r.addColorStop(0.9, '#0a2a5c'); r.addColorStop(1, '#030a1a')
    g.fillStyle = r; g.fillRect(0, 0, 256, 256)
    g.filter = 'blur(5px)'
    g.globalAlpha = 0.55; g.fillStyle = '#3f8f55'
    g.beginPath(); g.ellipse(115, 150, 46, 26, 0.5, 0, 7); g.ellipse(170, 100, 22, 30, -0.3, 0, 7); g.fill()
    g.globalAlpha = 0.4; g.fillStyle = '#f4f9ff'
    for (let i = 0; i < 16; i++) { g.beginPath(); g.ellipse(30 + ((i * 59) % 200), 40 + ((i * 41) % 170), 16 + (i % 4) * 8, 3 + (i % 3) * 2, 0.3 + i * 0.2, 0, 7); g.fill() }
  }), [])
  return (
    <group position={[2.1, 0.5, -4.8]}>
      <mesh><circleGeometry args={[0.78, 48]} /><meshBasicMaterial map={tex} /></mesh>
      <mesh position={[0, 0, 0.01]}><torusGeometry args={[0.8, 0.07, 12, 48]} /><meshStandardMaterial color="#4a5668" metalness={0.8} roughness={0.35} /></mesh>
    </group>
  )
}

function Cabin({ start }: { start: number }) {
  const leds = useRef<THREE.MeshBasicMaterial[]>([])
  const clock = useStart(start)
  useFrame(() => {
    const t = clock()
    leds.current.forEach((m, i) => { if (m) m.opacity = 0.55 + 0.45 * Math.sin(t * (2 + i * 0.7) + i) })
  })
  const wall = <meshStandardMaterial color="#141d2c" metalness={0.5} roughness={0.55} />
  return (
    <group>
      <mesh position={[0, 0, -5]}><planeGeometry args={[12, 6]} />{wall}</mesh>
      <mesh position={[-4.2, 0, -2]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[8, 6]} />{wall}</mesh>
      <mesh position={[4.2, 0, -2]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[8, 6]} />{wall}</mesh>
      <mesh position={[0, 2.2, -2]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[9, 8]} />{wall}</mesh>
      <mesh position={[0, -1.7, -2]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[9, 8]} /><meshStandardMaterial color="#0d141f" metalness={0.6} roughness={0.4} /></mesh>
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} position={[-4.4 + i * 0.88, 0.2, -4.92]}><boxGeometry args={[0.14, 5, 0.12]} /><meshStandardMaterial color="#1c2940" metalness={0.6} roughness={0.4} /></mesh>
      ))}
      {[-1.2, 1.4].map((y) => (
        <mesh key={y} position={[0, y, -4.88]}><boxGeometry args={[11, 0.05, 0.05]} /><meshBasicMaterial color="#5fb0ff" /></mesh>
      ))}
      <mesh position={[0, 2.12, -3.5]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[3.6, 0.35]} /><meshBasicMaterial color="#fff4e0" /></mesh>
      <mesh position={[-1.8, -1.35, -4.4]} rotation={[-0.5, 0, 0]}><boxGeometry args={[3.2, 0.5, 0.9]} /><meshStandardMaterial color="#18243a" metalness={0.5} roughness={0.5} /></mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-3 + i * 0.28, -1.18, -4.1]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshBasicMaterial ref={(m) => { if (m) leds.current[i] = m }} color={['#34d399', '#ffb454', '#6db3ff'][i % 3]} transparent />
        </mesh>
      ))}
      <Earth />
    </group>
  )
}

function SpaceScene({ start }: { start: number }) {
  const hel = useRef<THREE.Group>(null)
  const hL = useRef<THREE.Group>(null)
  const hR = useRef<THREE.Group>(null)
  const clock = useStart(start)
  const cam = useBreathCam(start)
  const D = useHold()
  const mats = useMemo<HandMats>(() => ({
    main: new THREE.MeshStandardMaterial({ color: '#e6eaf0', roughness: 0.78, metalness: 0.02 }),
    plate: new THREE.MeshStandardMaterial({ color: '#9aa7ba', roughness: 0.45, metalness: 0.35 }),
    cuff: new THREE.MeshStandardMaterial({ color: '#c3cad6', roughness: 0.3, metalness: 0.85 }),
    ring: new THREE.MeshStandardMaterial({ color: '#8fd0ff', emissive: '#4fa6ff', emissiveIntensity: 1.2, roughness: 0.3 }),
    sleeve: new THREE.MeshStandardMaterial({ color: '#8f9bb0', roughness: 0.8 }),
  }), [])
  // Cascaron abierto por atrás (aro del cuello hacia -z local), visor hacia +z local
  const shell = useMemo(() => { const g = new THREE.SphereGeometry(0.17, 56, 40, 0, Math.PI * 2, 0.72, Math.PI - 0.72); g.rotateX(-Math.PI / 2); return g }, [])
  const visor = useMemo(() => { const g = new THREE.SphereGeometry(0.1745, 48, 32, 0, Math.PI * 2, 0, 0.95); g.rotateX(Math.PI / 2); g.scale(1.07, 1, 1); return g }, [])
  useFrame(() => {
    const t = clock()
    const a = inOut(seg(t, 0.95, 2.35))
    const b = inC(seg(t, 2.35, 3.25))
    const br = Math.sin(t * 1.7) * 0.004
    const g = hel.current!
    g.position.set(0, lerp(-0.075, 0.015, a) + br, lerp(-D, -0.38, a) + (b > 0 ? lerp(0, 0.37, b) : 0))
    g.rotation.set(0.22 * Math.sin(Math.PI * a) + 0.06 * Math.sin(t * 1.1) * (1 - a), Math.PI * a, Math.sin(t * 0.9) * 0.025 * (1 - a))
    const rel = seg(t, 2.55, 3.1)
    const hp = (side: number, ref: THREE.Group) => {
      ref.position.set(side * (0.182 + rel * 0.35), g.position.y - 0.012 - rel * 0.3, g.position.z - 0.005 + rel * 0.15)
      ref.rotation.set(0, 0, side * rel * 0.5)
    }
    hp(1, hR.current!); hp(-1, hL.current!)
    cam({ fov: lerp(48, 64, b) })
  })
  return (
    <>
      <color attach="background" args={['#02040a']} />
      <fog attach="fog" args={['#02040a', 4, 11]} />
      <Env />
      <ambientLight intensity={0.35} color="#9db8e0" />
      <directionalLight position={[1.6, 2.2, 1.4]} intensity={2.6} color="#fff0dc" />
      <pointLight position={[-1.6, 0.2, 0.3]} intensity={5} distance={4} color="#6fb4ff" />
      <pointLight position={[0.2, 0.7, -2.4]} intensity={14} distance={6} color="#7fd0ff" />
      <Cabin start={start} />
      <Motes count={90} spread={[5, 3.4, 4.5]} color="#cfe6ff" size={0.012} speed={1} start={start} />
      <group ref={hel}>
        <mesh geometry={shell}><meshStandardMaterial color="#eef1f6" roughness={0.32} metalness={0.08} side={THREE.FrontSide} /></mesh>
        <mesh geometry={shell}><meshBasicMaterial color="#05080d" side={THREE.BackSide} /></mesh>
        <mesh geometry={visor}>
          <meshPhysicalMaterial color="#0a1628" roughness={0.04} metalness={1} envMapIntensity={2.4} clearcoat={1} clearcoatRoughness={0.03} side={THREE.FrontSide} />
        </mesh>
        <mesh geometry={visor}><meshBasicMaterial color="#0b1930" transparent opacity={0.5} side={THREE.BackSide} /></mesh>
        <mesh position={[0, 0, 0.1]} scale={[1.07, 1, 1]}><torusGeometry args={[0.1417, 0.0065, 8, 64]} /><meshStandardMaterial color="#2a3446" metalness={0.8} roughness={0.35} /></mesh>
        <mesh position={[0, 0, -0.1285]}><torusGeometry args={[0.1085, 0.0185, 14, 56]} /><meshStandardMaterial color="#c3cad6" metalness={0.9} roughness={0.28} /></mesh>
        <mesh position={[0, 0, -0.118]}><torusGeometry args={[0.108, 0.006, 8, 56]} /><meshStandardMaterial color="#8fd0ff" emissive="#4fa6ff" emissiveIntensity={1.4} /></mesh>
        <mesh position={[0, 0.172, 0.01]} scale={[1, 0.5, 1.4]}><sphereGeometry args={[0.03, 12, 10]} /><meshStandardMaterial color="#aeb7c6" metalness={0.8} roughness={0.35} /></mesh>
      </group>
      <group ref={hR}><Hand side={1} kind="glove" mats={mats} /></group>
      <group ref={hL}><Hand side={-1} kind="glove" mats={mats} /></group>
    </>
  )
}

// ── COMUNIDAD: chullo y chalina ──────────────────────────────

/** Perfil de montañas: tira de triángulos con color por altura (escarcha arriba). */
function ridgeGeo(seed: number, width: number, base: number, amp: number, rough: number, snow: number, col: string, hi: string) {
  const n = 120
  const pos: number[] = []; const colr: number[] = []; const idx: number[] = []
  const c = new THREE.Color(col); const h = new THREE.Color(hi); const white = new THREE.Color('#fff1f2')
  const f = (x: number) => Math.sin(x * 1.1 + seed) * 0.5 + Math.sin(x * 2.9 + seed * 2.3) * 0.28 + Math.sin(x * 6.7 + seed * 4.1) * 0.12 * rough + Math.abs(Math.sin(x * 0.8 + seed * 1.7)) * 0.5
  for (let i = 0; i <= n; i++) {
    const x = (i / n - 0.5) * width; const y = base + f((i / n) * 9) * amp
    pos.push(x, y, 0, x, base - amp * 2.2, 0)
    const k = clamp01((y - base) / (amp * 1.1))
    const top = c.clone().lerp(h, 0.5 + k * 0.5); if (snow > 0 && k > 0.55) top.lerp(white, snow * clamp01((k - 0.55) / 0.35))
    colr.push(top.r, top.g, top.b, c.r * 0.82, c.g * 0.82, c.b * 0.9)
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setIndex(idx)
  return g
}

const SKY_V = /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const SKY_F = /* glsl */ `varying vec3 vD; uniform float uK;
void main(){
  vec3 d = normalize(vD); float h = clamp(d.y, 0.0, 1.0);
  vec3 topC = mix(vec3(0.06, 0.09, 0.22), vec3(0.25, 0.46, 0.80), uK);
  vec3 midC = mix(vec3(0.34, 0.24, 0.50), vec3(0.98, 0.66, 0.52), uK);
  vec3 horC = mix(vec3(0.80, 0.50, 0.55), vec3(1.0, 0.84, 0.52), uK);
  vec3 c = mix(horC, midC, smoothstep(0.0, 0.16, h)); c = mix(c, topC, smoothstep(0.1, 0.65, h));
  vec3 sd = normalize(vec3(0.0, mix(-0.03, 0.075, uK), -1.0)); float s = max(dot(d, sd), 0.0);
  c += vec3(1.0, 0.58, 0.25) * pow(s, 28.0) * (0.45 + uK) + vec3(1.0, 0.86, 0.6) * pow(s, 500.0) * 2.0 * uK;
  gl_FragColor = vec4(c, 1.0);
}`

function Andes({ start }: { start: number }) {
  const sky = useRef<THREE.ShaderMaterial>(null)
  const scene = useThree((s) => s.scene)
  const clock = useStart(start)
  const layers = useMemo(() => [
    { z: -330, s: 1, w: 700, b: 22, a: 58, r: 1, snow: 1, c: '#a58bb8', h: '#e8c4d0' },
    { z: -230, s: 3, w: 560, b: 12, a: 46, r: 1, snow: 0.8, c: '#7f6fa6', h: '#d3b0c4' },
    { z: -140, s: 5, w: 420, b: 2, a: 26, r: 1.2, snow: 0.35, c: '#4f5b8a', h: '#9a9dbd' },
    { z: -78, s: 8, w: 300, b: -4, a: 18, r: 1.4, snow: 0, c: '#2f3d63', h: '#56658c' },
    { z: -36, s: 11, w: 200, b: -9, a: 9, r: 1.6, snow: 0, c: '#1f2a45', h: '#3b4a6c' },
  ].map((l) => ({ ...l, geo: ridgeGeo(l.s, l.w, l.b, l.a, l.r, l.snow, l.c, l.h) })), [])
  const grass = useRef<THREE.InstancedMesh>(null)
  const frost = useMemo(() => softDot('235,245,255'), [])
  const smokeTex = useMemo(() => softDot('255,255,255'), [])
  const smoke = useRef<THREE.Sprite[]>([])
  const [roof, roofFrost] = useMemo(() => {
    const sh = (h: number) => new THREE.Shape([new THREE.Vector2(-1.9, 0), new THREE.Vector2(0, h), new THREE.Vector2(1.9, 0)])
    const mk = (h: number, d: number) => { const g = new THREE.ExtrudeGeometry(sh(h), { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2); g.rotateY(Math.PI / 2); return g }
    return [mk(1.2, 4.6), mk(1.2, 4.7).scale(1, 0.12, 1)]
  }, [])
  const flakes = useMemo(() => Float32Array.from({ length: 210 }, (_, i) => (i % 3 === 0 ? (Math.random() - 0.5) * 14 : i % 3 === 1 ? Math.random() * 6 - 1.8 : -Math.random() * 14)), [])
  useEffect(() => {
    const m = grass.current!; const o = new THREE.Object3D()
    for (let i = 0; i < 520; i++) {
      const z = -1.5 - Math.pow(Math.random(), 1.6) * 60; const x = (Math.random() - 0.5) * (6 + Math.abs(z) * 0.9)
      o.position.set(x, -1.6, z); o.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * 3, (Math.random() - 0.5) * 0.3)
      const s = 0.7 + Math.random() * 1.1; o.scale.set(s, s, s); o.updateMatrix(); m.setMatrixAt(i, o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  }, [])
  useFrame(() => {
    const t = clock()
    const k = clamp01((t - 0.3) / 3.4)
    if (sky.current) sky.current.uniforms.uK.value = outC(k)
    const f = scene.fog as THREE.Fog
    f.color.setRGB(lerp(0.62, 0.98, outC(k)), lerp(0.46, 0.76, outC(k)), lerp(0.58, 0.62, outC(k)))
    smoke.current.forEach((s, i) => {
      const p = ((t * 0.18 + i / smoke.current.length) % 1)
      s.position.set(-9.8 + p * 3.2 + Math.sin(p * 6 + i) * 0.4, -1.6 + 2.9 + p * 7, -26)
      s.scale.setScalar(0.8 + p * 3.2); (s.material as THREE.SpriteMaterial).opacity = 0.5 * Math.sin(Math.PI * p)
    })
  })
  return (
    <>
      <mesh><sphereGeometry args={[600, 24, 16]} /><shaderMaterial ref={sky} vertexShader={SKY_V} fragmentShader={SKY_F} uniforms={{ uK: { value: 0 } }} side={THREE.BackSide} depthWrite={false} fog={false} /></mesh>
      {layers.map((l) => (
        <mesh key={l.s} geometry={l.geo} position={[0, 0, l.z]}><meshBasicMaterial vertexColors fog /></mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, -170]}><planeGeometry args={[700, 360]} /><meshBasicMaterial color="#b4c6de" fog /></mesh>
      <instancedMesh ref={grass} args={[undefined, undefined, 520]}>
        <coneGeometry args={[0.05, 0.55, 5]} />
        <meshBasicMaterial color="#c9bd8c" />
      </instancedMesh>
      {/* Casa de adobe con techo de teja y humo del fogón */}
      <group position={[-9, -1.6, -26]}>
        <mesh position={[0, 1, 0]}><boxGeometry args={[4, 2, 3]} /><meshBasicMaterial color="#6f5545" /></mesh>
        <mesh geometry={roof} position={[0, 2, 0]}><meshBasicMaterial color="#5e2d22" /></mesh>
        <mesh geometry={roofFrost} position={[0, 2.06, 0]}><meshBasicMaterial color="#eaf1f9" /></mesh>
        <mesh position={[1.2, 1, 1.52]}><planeGeometry args={[0.7, 1.1]} /><meshBasicMaterial color="#e8a43a" /></mesh>
      </group>
      {Array.from({ length: 6 }, (_, i) => (
        <sprite key={i} ref={(s) => { if (s) smoke.current[i] = s }}><spriteMaterial map={smokeTex} color="#f4eef0" transparent depthWrite={false} opacity={0} /></sprite>
      ))}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[flakes, 3]} />
        </bufferGeometry>
        <pointsMaterial map={frost} color="#fff" size={0.05} sizeAttenuation transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  )
}

/** Vaho del aliento: bocanadas que suben delante de la cara. */
function Breath({ start }: { start: number }) {
  const tex = useMemo(() => softDot('255,255,255'), [])
  const refs = useRef<THREE.Sprite[]>([])
  const clock = useStart(start)
  useFrame(() => {
    const t = clock()
    refs.current.forEach((s, i) => {
      const p = ((t * 0.55 + i * 0.22) % 1.1) / 1.1
      s.position.set(Math.sin(i * 2.1) * 0.05 + p * 0.03, -0.1 + p * 0.2, -0.3 - p * 0.18)
      s.scale.setScalar(0.04 + p * 0.22)
      ;(s.material as THREE.SpriteMaterial).opacity = (Math.sin(Math.PI * p) * 0.3) * (0.4 + 0.6 * Math.max(0, Math.sin(t * 1.1 + i)))
    })
  })
  return <>{Array.from({ length: 5 }, (_, i) => (
    <sprite key={i} ref={(s) => { if (s) refs.current[i] = s }}><spriteMaterial map={tex} color="#fff" transparent depthWrite={false} opacity={0} /></sprite>
  ))}</>
}

function CommunityScene({ start }: { start: number }) {
  const hat = useRef<THREE.Group>(null)
  const scarf = useRef<THREE.Group>(null)
  const hL = useRef<THREE.Group>(null)
  const hR = useRef<THREE.Group>(null)
  const clock = useStart(start)
  const cam = useBreathCam(start, 1.6)
  const D = useHold() * 0.62
  const { capMat, innerMat, trimMat, scarfMat, mitMat, mats } = useMemo(() => {
    const bump = knitBump()
    const cap = woolTex([[0.12, '#7a1f1a'], [0.06, '#f2e6c8'], [0.08, '#1b6b6e'], [0.1, '#d89a1d'], [0.28, '#b3261e'], [0.08, '#f2e6c8'], [0.28, '#1f2a44']], '#f2e6c8', '#b3261e', [3, 1])
    const sc = woolTex([[0.14, '#1f2a44'], [0.06, '#f2e6c8'], [0.1, '#d89a1d'], [0.2, '#a3205c'], [0.1, '#f2e6c8'], [0.2, '#1b6b6e'], [0.2, '#1f2a44']], '#d89a1d', '#a3205c', [1, 3])
    const mit = woolTex([[0.25, '#e9dcc0'], [0.12, '#b3261e'], [0.26, '#e9dcc0'], [0.12, '#1b6b6e'], [0.25, '#e9dcc0']], '#b3261e', '#e9dcc0', [2, 1])
    const wool = (map: THREE.Texture, side: THREE.Side = THREE.FrontSide) => new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.2, roughness: 1, side })
    const cuff = wool(woolTex([[0.2, '#1b6b6e'], [0.15, '#f2e6c8'], [0.3, '#b3261e'], [0.15, '#f2e6c8'], [0.2, '#1b6b6e']], '#d89a1d', '#b3261e', [3, 1]))
    return {
      capMat: wool(cap, THREE.DoubleSide),
      innerMat: new THREE.MeshStandardMaterial({ color: '#4a2a22', bumpMap: bump, bumpScale: 2, roughness: 1, side: THREE.BackSide }),
      trimMat: new THREE.MeshStandardMaterial({ color: '#7a1f1a', bumpMap: bump, bumpScale: 2, roughness: 1 }),
      scarfMat: wool(sc, THREE.DoubleSide), mitMat: wool(mit), cuffMat: cuff,
      mats: { main: wool(mit), plate: wool(mit), cuff, ring: new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 1 }), sleeve: new THREE.MeshStandardMaterial({ color: '#2f3a35', roughness: 0.95 }) } as HandMats,
    }
  }, [])
  const capGeo = useMemo(() => new THREE.SphereGeometry(0.098, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.5), [])
  const flapGeo = useMemo(() => { const g = new THREE.ConeGeometry(0.032, 0.17, 18, 1, true); g.scale(1, 1, 0.55); g.rotateX(Math.PI); return g }, [])
  const scarfGeo = useMemo(() => { const g = new THREE.CapsuleGeometry(0.046, 0.78, 8, 24); g.rotateZ(Math.PI / 2); g.scale(1, 0.85, 1); return g }, [])
  useFrame(() => {
    const t = clock()
    const rise = inOut(seg(t, 0.45, 1.2))
    const cover = inOut(seg(t, 1.2, 1.5))
    const settle = outBack(seg(t, 1.75, 2.35))
    const h = hat.current!
    // Chullo: sube mostrando el interior, baja sobre la vista y queda con el borde arriba
    let y = lerp(-0.05, 0.2, rise); let z = lerp(-D, -0.24, rise); let rx = lerp(0, -1.15, rise)
    y = lerp(y, -0.02, cover); z = lerp(z, 0.02, cover); rx = lerp(rx, 0, cover)
    y = lerp(y, 0.02, settle * (t > 1.75 ? 1 : 0)); z = lerp(z, 0.03, settle * (t > 1.75 ? 1 : 0))
    h.position.set(0, y + Math.sin(t * 1.6) * 0.003 * (1 - rise), z)
    h.rotation.set(rx, 0, Math.sin(t * 0.9) * 0.03 * (1 - rise))
    h.visible = true
    const handsOnHat = 1 - seg(t, 1.0, 1.35)
    const sc = scarf.current!
    const sIn = outC(seg(t, 1.45, 2.35)); const sWrap = inOut(seg(t, 2.35, 3.05))
    const sy = lerp(-0.5, -0.17, sIn); const syy = lerp(sy, -0.1, sWrap)
    sc.position.set(0, syy, lerp(-0.38, -0.2, sWrap))
    sc.rotation.set(0.15 * (1 - sWrap), 0, Math.sin(t * 1.3) * 0.05 * (1 - sWrap))
    sc.visible = t > 1.3
    const place = (side: number, ref: THREE.Group) => {
      // manos: primero en las orejeras del chullo, luego bajan, luego sujetan la chalina y se retiran
      const onHat = new THREE.Vector3(side * (0.1 + 0.02 * (1 - rise)), h.position.y - 0.05, h.position.z + 0.04)
      const away = new THREE.Vector3(side * 0.3, -0.42, -0.25)
      const onScarf = new THREE.Vector3(side * 0.2, sc.position.y - 0.01, sc.position.z + 0.02)
      const out = new THREE.Vector3(side * 0.5, -0.5, -0.1)
      const p = onHat.lerp(away, 1 - handsOnHat).lerp(onScarf, seg(t, 1.45, 2.1)).lerp(out, seg(t, 2.4, 3.1))
      ref.position.copy(p)
      ref.rotation.set(0, 0, side * (0.35 * (1 - handsOnHat)))
    }
    place(1, hR.current!); place(-1, hL.current!)
    cam({ fov: 50 })
  })
  return (
    <>
      <fog attach="fog" args={['#9a7a94', 40, 460]} />
      <hemisphereLight args={['#b9c6e8', '#6b5a64', 1.1]} />
      <directionalLight position={[0.4, 0.5, -1]} intensity={3.2} color="#ffb77a" />
      <directionalLight position={[-0.6, 0.8, 1]} intensity={1.4} color="#d6e4ff" />
      <Andes start={start} />
      <Motes count={70} spread={[0.9, 0.5, 0.9]} color="#fff" size={0.006} speed={1.6} start={start} up={1} />
      <Breath start={start} />
      <group ref={hat}>
        <mesh geometry={capGeo} material={capMat} scale={[1, 1.12, 1]} />
        <mesh geometry={capGeo} material={innerMat} scale={[0.97, 1.09, 0.97]} />
        <mesh material={trimMat} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.097, 0.011, 10, 40]} /></mesh>
        <mesh material={capMat} position={[0, 0.118, 0]}><sphereGeometry args={[0.024, 14, 12]} /></mesh>
        {[1, -1].map((s) => (
          <group key={s} position={[s * 0.093, -0.005, 0]} rotation={[0, 0, s * -0.08]}>
            <mesh geometry={flapGeo} material={capMat} position={[0, -0.085, 0]} />
            {[-0.012, 0, 0.012].map((dx, i) => (
              <mesh key={i} position={[dx, -0.19 - (i % 2) * 0.012, 0]} material={i === 1 ? trimMat : mitMat}><capsuleGeometry args={[0.0055, 0.04, 3, 6]} /></mesh>
            ))}
          </group>
        ))}
      </group>
      <group ref={scarf}>
        <mesh geometry={scarfGeo} material={scarfMat} />
        {[0.34, -0.34].map((x) => (
          <mesh key={x} position={[x, -0.13, 0.01]} material={scarfMat} rotation={[0, 0, x > 0 ? -0.06 : 0.06]}><planeGeometry args={[0.1, 0.26]} /></mesh>
        ))}
      </group>
      <group ref={hR}><Hand side={1} kind="mitten" mats={mats} /></group>
      <group ref={hL}><Hand side={-1} kind="mitten" mats={mats} /></group>
    </>
  )
}

// ── Respaldo 2D y envoltorio ─────────────────────────────────

function Fallback2D({ community }: { community: boolean }) {
  return (
    <div className="in-fb" aria-hidden="true">
      {community ? (
        <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">
          <defs><linearGradient id="fbsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a3a78" /><stop offset="0.6" stopColor="#e8a07a" /><stop offset="1" stopColor="#ffd98a" /></linearGradient></defs>
          <rect width="160" height="100" fill="url(#fbsky)" />
          <circle cx="80" cy="62" r="9" fill="#fff3c8" />
          <path d="M0 70L22 48 36 62 56 38 80 64 104 40 126 62 144 46 160 66V100H0Z" fill="#6f6a9a" />
          <path d="M0 82L30 62 52 76 84 58 120 78 160 64V100H0Z" fill="#2f3d63" />
          <g className="in-fb-chullo"><path d="M-5 -2H165V12Q80 24 -5 12Z" fill="#b3261e" /><path d="M-5 11Q80 24 165 11V15Q80 28 -5 15Z" fill="#1b6b6e" /></g>
          <g className="in-fb-scarf"><path d="M-5 90Q80 80 165 90V105H-5Z" fill="#a3205c" /><path d="M-5 93Q80 83 165 93V96Q80 86 -5 96Z" fill="#d89a1d" /></g>
        </svg>
      ) : (
        <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="fbv" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#5b86b8" /><stop offset="0.5" stopColor="#0d1a2e" /><stop offset="1" stopColor="#02040a" /></radialGradient>
          </defs>
          <rect width="160" height="100" fill="#06101e" />
          <g className="in-fb-helmet">
            <circle cx="80" cy="52" r="26" fill="#e8edf3" />
            <ellipse cx="80" cy="50" rx="19" ry="16" fill="url(#fbv)" />
            <ellipse cx="55" cy="66" rx="5" ry="9" fill="#d5dbe4" /><ellipse cx="105" cy="66" rx="5" ry="9" fill="#d5dbe4" />
          </g>
        </svg>
      )}
    </div>
  )
}

class Guard extends Component<{ fallback: ReactNode; children: ReactNode }, { bad: boolean }> {
  state = { bad: false }
  static getDerivedStateFromError() { return { bad: true } }
  componentDidCatch() { /* el respaldo 2D ocupa su lugar */ }
  render() { return this.state.bad ? this.props.fallback : this.props.children }
}

interface IntroProps {
  profile: 'space' | 'community'
  /** performance.now() del instante en que empieza la secuencia (reloj propio, sincronizado con el orquestador). */
  start: number
}

/** Secuencia en primera persona: ponerse el casco (espacio) o abrigarse con chullo y chalina (comunidad). */
export default function Intro({ profile, start }: IntroProps) {
  const visible = useTabVisible()
  const community = profile === 'community'
  const gl = useMemo(() => hasWebGL(), [])
  if (!gl) return <Fallback2D community={community} />
  return (
    <Guard fallback={<Fallback2D community={community} />}>
      <Canvas
        key={profile}
        dpr={[1, 2]}
        frameloop={visible ? 'always' : 'never'}
        flat={community}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 50, near: 0.02, far: 1500, position: [0, 0, 0] }}
        aria-hidden="true"
      >
        {community ? <CommunityScene start={start} /> : <SpaceScene start={start} />}
      </Canvas>
    </Guard>
  )
}
