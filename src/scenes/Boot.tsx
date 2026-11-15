import { lazy, Suspense, useEffect, useState } from 'react'
import '../intro.css'
import { useProfile, useStore } from '../store'
import { Logo } from '../ui/Logo'
import { reducedMotion, useTabVisible } from '../ui/hooks'
import { ModeSwitch } from './Monitor'

const Intro = lazy(() => import('../three/Intro'))

// Líneas del HUD: [tipo, izquierda %, arriba %, ancho %, alto %]
const HUD: [string, number, number, number, number][] = [
  ['h', 30, 13, 40, 0], ['v', 11, 30, 0, 40], ['v', 89, 30, 0, 40], ['h', 30, 87, 40, 0],
  ['h', 17, 50, 19, 0], ['h', 64, 50, 19, 0],
  ['c tl', 20, 22, 4, 6], ['c tr', 76, 22, 4, 6], ['c bl', 20, 72, 4, 6], ['c br', 76, 72, 4, 6],
]

// Tiempos (ms desde que empieza la secuencia)
const SEAL = 3400      // el casco se sella / el abrigo queda puesto
const LOGO = 3900      // barras de cine fuera, aparece el logo
const TEXT = 4500      // título y lista
const FIRST_CHECK = 5400
const CHECK_STEP = 700
const OUTRO = 1500     // pausa con todo listo antes de pasar a la siguiente escena

type Stage = 'intro' | 'seal' | 'logo'

function Tick({ done }: { done: boolean }) {
  return (
    <b className="in-tick">
      {done ? (
        <svg viewBox="0 0 20 20" aria-hidden="true"><path pathLength={1} d="M4.5 10.5l3.8 3.8 7.2-8.3" /><circle className="ring" cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      ) : <i className="in-spin" />}
    </b>
  )
}

function Sequence() {
  const p = useProfile()
  const community = p.id === 'community'
  const visible = useTabVisible()
  const [reduced] = useState(reducedMotion)
  const [start] = useState(() => performance.now())
  const [stage, setStage] = useState<Stage>(reduced ? 'logo' : 'intro')
  const [text, setText] = useState(reduced)
  const [done, setDone] = useState(0)
  const [show3d, setShow3d] = useState(!reduced)
  const checks = p.hero.checks

  useEffect(() => {
    const { set } = useStore.getState()
    const ids: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, f: () => void) => { ids.push(setTimeout(f, ms)) }
    if (reduced) {
      checks.forEach((_, i) => at(700 + i * 400, () => setDone(i + 1)))
      at(700 + checks.length * 400 + 900, () => useStore.getState().finishBoot())
    } else {
      if (!community) set({ visorUp: true })
      at(SEAL, () => { setStage('seal'); if (!community) set({ visorUp: false }) })
      if (!community) at(SEAL + 800, () => set({ fogKey: Date.now() }))
      at(LOGO, () => setStage('logo'))
      at(TEXT, () => setText(true))
      at(LOGO + 800, () => setShow3d(false))
      checks.forEach((_, i) => at(FIRST_CHECK + i * CHECK_STEP, () => setDone(i + 1)))
      at(FIRST_CHECK + (checks.length - 1) * CHECK_STEP + OUTRO, () => useStore.getState().finishBoot())
    }
    return () => { ids.forEach(clearTimeout); set({ visorUp: false }) }
  }, [community, reduced, checks])

  const logoSize = typeof window !== 'undefined' && window.innerWidth < 600 ? 104 : 148
  const finished = done >= checks.length
  return (
    <div className={`in-root in-${p.id} stage-${stage}${text ? ' text-on' : ''}${reduced ? ' is-reduced' : ''}${visible ? '' : ' is-paused'}`}>
      <div className="in-back" />
      {show3d && (
        <div className="in-3d">
          <Suspense fallback={null}><Intro profile={p.id} start={start} /></Suspense>
        </div>
      )}
      {!community && (
        <div className="in-hud" aria-hidden="true">
          {HUD.map(([cls, left, top, w, h], i) => (
            <i key={i} className={cls} style={{ left: `${left}%`, top: `${top}%`, width: w ? `${w}%` : undefined, height: h ? `${h}%` : undefined, '--i': i } as React.CSSProperties} />
          ))}
        </div>
      )}
      <div className="in-core" role="status">
        <div className="in-logo-slot" style={{ '--logo-size': `${logoSize}px` } as React.CSSProperties}>
          {stage === 'logo' && <Logo variant={p.id} animate={!reduced} size={logoSize} />}
        </div>
        <h1>{finished ? p.hero.ready : p.hero.starting}</h1>
        <ul className="in-checks">
          {checks.map((c, i) => (
            <li key={c} className={done > i ? 'done' : ''} style={{ '--i': i } as React.CSSProperties}>
              <Tick done={done > i} /><span>{c}</span><span className="st">{done > i ? 'listo' : 'comprobando'}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="in-fx in-dark" />
      <div className="in-fx in-vignette" />
      <div className="in-fx in-grain" />
      <div className="in-fx in-flash" />
      <div className="in-fx in-flare" />
      <div className="in-fx in-sweep" />
      <div className="in-bar top" /><div className="in-bar bot" />
    </div>
  )
}

/**
 * Escena 1: primera persona (casco o abrigo, ~3,4 s), sellado, logo animado y comprobaciones
 * una a una (~8,3 s en total). El perfil nuevo reinicia la secuencia.
 */
export default function Boot() {
  const p = useProfile()
  const finish = useStore((s) => s.finishBoot)
  return (
    <div className="boot" style={{ position: 'absolute', inset: 0 }}>
      <Sequence key={p.id} />
      <div className="boot-mode"><ModeSwitch /></div>
      <button className="btn ghost skip" onClick={finish}>Saltar</button>
    </div>
  )
}
