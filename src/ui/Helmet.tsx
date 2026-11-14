import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { reducedMotion } from './hooks'

const OPENING = 'M8.4 2H91.6A7 11 0 0 1 98.6 13V87A7 11 0 0 1 91.6 98H8.4A7 11 0 0 1 1.4 87V13A7 11 0 0 1 8.4 2Z'
const DUST = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 0.8  0 0 0 0 0.9  0 0 0 0 1  0 0 0 0.9 -0.35'/></filter><rect width='320' height='320' filter='url(%23n)'/></svg>".replace(/%23/g, '#'),
)}")`

/**
 * Casco: aro con junta, vidrio con grosor en el borde, reflejos curvos que se mueven
 * un poco al mover la cabeza (cursor) y polvo fino. Se ve en todas las escenas.
 */
export function Helmet() {
  const up = useStore((s) => s.visorUp)
  const fogKey = useStore((s) => s.fogKey)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reducedMotion()) return
    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        root.current?.style.setProperty('--lx', String((e.clientX / window.innerWidth) * 2 - 1))
        root.current?.style.setProperty('--ly', String((e.clientY / window.innerHeight) * 2 - 1))
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf) }
  }, [])
  return (
    <>
      <div className="scanlines" />
      {fogKey > 0 && <div key={fogKey} className="fog on" />}
      <div ref={root} className={`helmet${up ? ' up' : ''}`} aria-hidden="true">
        <div className="glass-tint" />
        <div className="glass-dust" style={{ backgroundImage: DUST }} />
        <div className="glass-reflect"><i className="r1" /><i className="r2" /><i className="r3" /><i className="r4" /></div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#141f33" /><stop offset="0.35" stopColor="#05080f" />
              <stop offset="0.7" stopColor="#03050a" /><stop offset="1" stopColor="#0f1929" />
            </linearGradient>
            <linearGradient id="bevel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5f7da6" /><stop offset="0.18" stopColor="#1a2740" />
              <stop offset="0.8" stopColor="#0c1424" /><stop offset="1" stopColor="#33496b" />
            </linearGradient>
            <clipPath id="open"><path d={OPENING} /></clipPath>
          </defs>
          {/* Grosor del vidrio: banda clara y borrosa junto al aro, solo por dentro */}
          <g clipPath="url(#open)">
            <path className="thick" d={OPENING} />
            <path className="thick2" d={OPENING} />
          </g>
          <path fill="url(#shell)" fillRule="evenodd" d={`M0 0H100V100H0Z ${OPENING}`} />
          <path className="gasket" d={OPENING} />
          <path className="bevel" d={OPENING} stroke="url(#bevel)" />
          <path className="edge" d={OPENING} />
        </svg>
      </div>
    </>
  )
}
