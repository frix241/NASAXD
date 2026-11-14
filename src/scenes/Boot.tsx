import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../ui/Icon'

// Líneas del HUD: [tipo, izquierda %, arriba %, ancho %, alto %]
const HUD: [string, number, number, number, number][] = [
  ['h', 30, 13, 40, 0], ['v', 11, 30, 0, 40], ['v', 89, 30, 0, 40], ['h', 30, 87, 40, 0],
  ['h', 17, 50, 19, 0], ['h', 64, 50, 19, 0],
  ['c tl', 20, 22, 4, 6], ['c tr', 76, 22, 4, 6], ['c bl', 20, 72, 4, 6], ['c br', 76, 72, 4, 6],
]
const CHECKS = ['Sensores del traje', 'Enlace con la nave', 'Tu perfil']

/** Escena 1: baja el visor, se empaña, se enciende el HUD y se comprueba el sistema (~6 s). */
export default function Boot() {
  const [hud, setHud] = useState(false)
  const [text, setText] = useState(false)
  const [done, setDone] = useState(0)
  const finish = useStore((s) => s.finishBoot)
  useEffect(() => {
    const { set } = useStore.getState()
    set({ visorUp: true })
    const plan: [number, () => void][] = [
      [250, () => set({ visorUp: false })],
      [1350, () => set({ fogKey: Date.now() })],
      [2250, () => setHud(true)],
      [2900, () => setText(true)],
      [3600, () => setDone(1)], [4300, () => setDone(2)], [5000, () => setDone(3)],
      [5600, () => setDone(4)],
      [6200, () => useStore.getState().finishBoot()],
    ]
    const ids = plan.map(([ms, f]) => setTimeout(f, ms))
    return () => { ids.forEach(clearTimeout); set({ visorUp: false }) }
  }, [])
  return (
    <div className={`boot${hud ? ' hud-on' : ''}${text ? ' text-on' : ''}`} style={{ position: 'absolute', inset: 0 }}>
      <div className="hud" aria-hidden="true">
        {HUD.map(([cls, left, top, w, h], i) => (
          <i key={i} className={cls} style={{ left: `${left}%`, top: `${top}%`, width: w ? `${w}%` : undefined, height: h ? `${h}%` : undefined, '--i': i } as React.CSSProperties} />
        ))}
      </div>
      <div className="core" role="status">
        <h1>{done >= 4 ? 'AstroTwin listo' : 'Iniciando AstroTwin…'}</h1>
        <ul>
          {CHECKS.map((c, i) => (
            <li key={c} className={done > i ? 'done' : ''}><b>{done > i ? <Icon name="ok" /> : <i className="spin" />}</b>{c}<span className="muted">{done > i ? 'listo' : 'comprobando'}</span></li>
          ))}
        </ul>
      </div>
      <button className="btn ghost skip" onClick={finish}>Saltar</button>
    </div>
  )
}
