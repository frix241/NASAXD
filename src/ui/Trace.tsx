import { useEffect, useRef } from 'react'

type Kind = 'ecg' | 'pleth' | 'art' | 'resp'
const g = (x: number, c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (2 * w * w))

/** Forma de una onda completa; phase va de 0 a 1. Devuelve aprox. -0.3..1 */
function shape(kind: Kind, p: number): number {
  switch (kind) {
    case 'ecg':
      return 0.12 * g(p, 0.2, 0.03) - 0.14 * g(p, 0.37, 0.012) + g(p, 0.4, 0.013) - 0.26 * g(p, 0.435, 0.014) + 0.28 * g(p, 0.66, 0.05)
    case 'pleth': return 0.95 * g(p, 0.3, 0.1) + 0.4 * g(p, 0.58, 0.11)
    case 'art': return g(p, 0.24, 0.07) + 0.5 * g(p, 0.47, 0.09) + 0.2 * g(p, 0.7, 0.12)
    case 'resp': return 0.5 - 0.5 * Math.cos(p * Math.PI * 2)
  }
}

const N = 220
const SECONDS: Record<Kind, number> = { ecg: 4.5, pleth: 4.5, art: 4.5, resp: 14 }

/** Trazo que avanza como en un monitor de hospital. rate = ciclos por minuto. */
export function Trace({ kind, rate }: { kind: Kind; rate: number }) {
  const line = useRef<SVGPolylineElement>(null)
  const rateRef = useRef(rate)
  rateRef.current = rate
  useEffect(() => {
    const buf = new Float32Array(N)
    let phase = 0
    const perSample = SECONDS[kind] / N
    const push = (n: number) => {
      for (let i = 0; i < n; i++) {
        phase = (phase + (perSample * rateRef.current) / 60) % 1
        buf.copyWithin(0, 1)
        buf[N - 1] = shape(kind, phase)
      }
    }
    const draw = () => {
      let pts = ''
      for (let i = 0; i < N; i++) pts += `${i},${(31 - buf[i] * 26).toFixed(1)} `
      line.current?.setAttribute('points', pts)
    }
    push(N); draw()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0; let last = performance.now(); let acc = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      acc += Math.min(0.1, (now - last) / 1000); last = now
      const n = Math.floor(acc / perSample)
      if (n > 0) { acc -= n * perSample; push(Math.min(n, N)); draw() }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [kind])
  return (
    <svg className="trace" viewBox={`0 0 ${N - 1} 36`} preserveAspectRatio="none" aria-hidden="true">
      <polyline ref={line} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Línea corta con los últimos valores (para la temperatura). */
export function Spark({ values, min, max }: { values: number[]; min: number; max: number }) {
  const n = values.length
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * 100).toFixed(1)},${(33 - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 30).toFixed(1)}`).join(' ')
  return (
    <svg className="trace" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <path className="l" d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
