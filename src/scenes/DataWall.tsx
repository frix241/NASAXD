import { useEffect, useState, type ReactNode } from 'react'
import { bodyRemaining, RULES, statusSleep, STATUS_WORD } from '../config/rules'
import { crewMean, flightChange, LABS, TIMEPOINT_HINT, TIMEPOINTS, vsBaseline } from '../data/inspiration4'
import { EXERCISE_GOAL_MIN } from '../sim/simulator'
import { useStore } from '../store'
import { STATUS_COLOR } from '../three/Twin'
import { Bars, ChangeBars, Heatmap, ICE, Legend, Lines, nf, SERIES } from '../ui/charts'
import { Icon } from '../ui/Icon'
import { StatusTag } from './Monitor'

type PanelId = 'sleep' | 'body' | 'exercise' | 'water' | 'heart' | 'rad' | 'labs' | 'change'
const LIMIT = 12 // % a partir del cual el color del mapa ya no cambia

function Panel({ id, title, right, sub, cls = '', big, onOpen, children }: {
  id: PanelId; title: string; right?: ReactNode; sub?: string; cls?: string; big: boolean
  onOpen: (id: PanelId) => void; children: ReactNode
}) {
  return (
    <section className={`panel holo ${cls}`} role={big ? undefined : 'button'} tabIndex={big ? undefined : 0}
      aria-label={big ? title : `${title}. Tocar para ampliar`}
      onClick={big ? undefined : () => onOpen(id)}
      onKeyDown={big ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(id) } }}>
      <header><h3>{title}</h3>{right && <span className="big">{right}</span>}</header>
      {(big || cls.includes('wide')) && sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  )
}

function useData() {
  const sim = useStore((s) => s.sim)
  const r = useStore((s) => s.readings)
  const h = sim.history
  const days = h.sleep.map((_, i) => `Día ${sim.missionDay - 13 + i}`)
  const week = h.exercise.map((_, i) => `Día ${sim.missionDay - 6 + i}`)
  const cum: number[] = []
  let acc = sim.radTotal
  for (let i = h.radDaily.length - 1; i >= 0; i--) { cum[i] = +acc.toFixed(2); acc -= h.radDaily[i] }
  return { sim, r, h, days, week, cum }
}

function Content({ id, big, onOpen }: { id: PanelId; big: boolean; onOpen: (id: PanelId) => void }) {
  const { sim, r, h, days, week, cum } = useData()
  const [crew, setCrew] = useState('Promedio')
  const [measure, setMeasure] = useState(0)
  const p = { id, big, onOpen }
  switch (id) {
    case 'sleep': return (
      <Panel {...p} title="Sueño" right={<>anoche {r.sleep.text} h <StatusTag status={r.sleep.status} /></>}
        sub="Horas dormidas cada noche, últimos 14 días. Lo sano es 7 horas o más.">
        <Bars values={h.sleep} labels={days} max={10} ticks={[0, 5, 10]} refLine={{ v: 7, label: '7 h' }}
          color={(v) => STATUS_COLOR[statusSleep(v)]}
          tipText={(v, i) => <><span className="muted">{days[i]}: </span><b>{nf(v, 1)} h</b> {STATUS_WORD[statusSleep(v)]}</>} />
      </Panel>
    )
    case 'body': {
      const a = sim.exerciseWeek / 100
      const months = [0, 1, 2, 3, 4, 5, 6]
      const mk = (kind: 'muscle' | 'bone', adh: number) => months.map((m) => +bodyRemaining(kind, m, adh).toFixed(2))
      return (
        <Panel {...p} title="Músculo y hueso" right={`rutina al ${r.exercise.text} %`}
          sub={`Estimación a 6 meses. Sin ejercicio se pierde entre ${nf(RULES.body.boneLossPerMonth)} y ${nf(RULES.body.muscleLossPerMonth, 1)} % al mes. Cumplir la rutina frena esa pérdida.`}>
          <Lines labels={months.map((m) => (m === 0 ? 'Hoy' : `Mes ${m}`))} min={90} max={100} ticks={[90, 95, 100]} unit=" %" d={1}
            series={[
              { name: 'Músculo con tu rutina', color: SERIES[0], values: mk('muscle', a) },
              { name: 'Hueso con tu rutina', color: SERIES[1], values: mk('bone', a) },
              { name: 'Músculo sin ejercicio', color: SERIES[0], dash: true, values: mk('muscle', 0) },
              { name: 'Hueso sin ejercicio', color: SERIES[1], dash: true, values: mk('bone', 0) },
            ]} />
          <Legend items={[{ name: 'Músculo', color: SERIES[0] }, { name: 'Hueso', color: SERIES[1] }, { name: 'Sin ejercicio', color: '#86a3cb', dash: true }]} />
        </Panel>
      )
    }
    case 'exercise': return (
      <Panel {...p} title="Ejercicio semanal" right={<>{r.exercise.text} % <StatusTag status={r.exercise.status} /></>}
        sub={`Minutos de ejercicio por día. La meta es ${EXERCISE_GOAL_MIN} minutos diarios.`}>
        <Bars values={h.exercise} labels={week} max={90} ticks={[0, 30, 60, 90]} refLine={{ v: EXERCISE_GOAL_MIN, label: 'meta' }}
          color={() => ICE} tipText={(v, i) => <><span className="muted">{week[i]}: </span><b>{v} min</b></>} />
      </Panel>
    )
    case 'water': return (
      <Panel {...p} title="Hidratación" right={<>{r.hydration.text} % <StatusTag status={r.hydration.status} /></>}
        sub="Agua en el cuerpo, promedio por día. Bajo 70 % conviene beber más.">
        <Lines labels={days} min={30} max={100} ticks={[40, 70, 100]} unit=" %" refLines={[{ v: 70, label: 'sano desde 70 %' }]}
          series={[{ name: 'Hidratación', color: ICE, values: h.hydration }]} />
      </Panel>
    )
    case 'heart': return (
      <Panel {...p} title="Presión y pulso" right={`${r.bp.text} mmHg`}
        sub="Arriba, la presión (número alto). Abajo, el pulso en reposo. Cada uno con su propia escala.">
        <Lines labels={days} min={90} max={150} ticks={[100, 120, 140]} unit=" mmHg" refLines={[{ v: 120, label: 'presión, vigilar desde 120' }]}
          series={[{ name: 'Presión', color: ICE, values: h.sys }]} />
        <Lines labels={days} min={50} max={110} ticks={[60, 85, 110]} unit=" lpm" refLines={[{ v: 85, label: 'pulso, vigilar desde 85' }]}
          series={[{ name: 'Pulso', color: ICE, values: h.pulse }]} />
      </Panel>
    )
    case 'rad': {
      const top = Math.max(1, Math.ceil(Math.max(...h.radDaily) * 1.25 * 2) / 2)
      const c0 = Math.floor(cum[0]); const c1 = Math.ceil(cum[cum.length - 1] + 0.5)
      return (
        <Panel {...p} title="Radiación" right={<>total {nf(sim.radTotal, 1)} mSv <StatusTag status={r.radiation.status} /></>}
          sub="Arriba, lo recibido cada día. Abajo, lo acumulado en toda la misión. Se mide en milisieverts (mSv).">
          <Bars values={h.radDaily} labels={days} max={top} ticks={[0, top / 2, top]} d={1} color={() => ICE}
            tipText={(v, i) => <><span className="muted">{days[i]}: </span><b>{nf(v, 2)} mSv</b></>} />
          <Lines labels={days} min={c0} max={c1} ticks={[c0, c1]} unit=" mSv" d={2}
            series={[{ name: 'Acumulada', color: ICE, values: cum }]} />
        </Panel>
      )
    }
    case 'labs': {
      const names = LABS.measures.map((m) => m.name)
      const who = ['Promedio', ...LABS.crews]
      const raw = (m: string) => (crew === 'Promedio' ? crewMean(LABS, m) : LABS.values[m][crew])
      const pct = names.map((m) => vsBaseline(raw(m)))
      const sel = LABS.measures[measure]
      const heat = (
        <>
          <Heatmap rows={names} cols={[...TIMEPOINTS]} limit={LIMIT} cell={(i, j) => pct[i][j]}
            selected={big ? measure : undefined} onSelect={big ? setMeasure : undefined}
            tipText={(i, j) => {
              const v = raw(names[i])[j]; const c = pct[i][j]
              return (
                <>
                  <div className="muted">{names[i]}, {TIMEPOINT_HINT[TIMEPOINTS[j]]}</div>
                  {v === null ? <b>sin dato</b> : <><b>{nf(v, v < 20 ? 2 : 1)} {LABS.measures[i].unit}</b>{c !== null && <span className="muted"> ({c > 0 ? '+' : ''}{nf(c, 1)} % frente a antes del vuelo)</span>}</>}
                </>
              )
            }} />
          <Legend items={[
            { name: 'más bajo que antes del vuelo', color: SERIES[0], box: true }, { name: 'igual', color: 'rgb(38,46,60)', box: true },
            { name: 'más alto', color: SERIES[3], box: true }, { name: 'sin dato', color: '', pattern: true },
          ]} />
        </>
      )
      return (
        <Panel {...p} cls="wide tall" title="Análisis de sangre, misión Inspiration4"
          right={LABS.isSample ? <span className="badge">Datos de ejemplo</span> : `${LABS.crews.length} tripulantes`}
          sub={`${names.length} medidas en ${TIMEPOINTS.length} fechas: L = días antes del despegue, R = días después de volver.`}>
          {!big ? heat : (
            <>
              <div className="seg" role="group" aria-label="Tripulante" style={{ margin: '8px 0', alignSelf: 'flex-start' }}>
                {who.map((c) => <button key={c} aria-pressed={c === crew} onClick={() => setCrew(c)}>{c}</button>)}
              </div>
              <div className="lab-split">
                <div>{heat}</div>
                <div>
                  <h3 style={{ fontSize: 15 }}>{sel.name} <span className="muted" style={{ fontWeight: 400 }}>({sel.unit}), por tripulante</span></h3>
                  <p className="sub">Toca una medida del mapa para verla aquí. Los huecos son fechas sin dato.</p>
                  <Lines labels={[...TIMEPOINTS]} endLabels d={2} unit={` ${sel.unit}`}
                    {...range(LABS.crews.flatMap((c) => LABS.values[sel.name][c]))}
                    series={LABS.crews.map((c, i) => ({ name: c, color: SERIES[i % SERIES.length], values: LABS.values[sel.name][c] }))} />
                  <Legend items={LABS.crews.map((c, i) => ({ name: c, color: SERIES[i % SERIES.length] }))} />
                </div>
              </div>
            </>
          )}
        </Panel>
      )
    }
    case 'change': {
      const rows = LABS.measures.map((m) => ({ name: m.name, pct: flightChange(crewMean(LABS, m.name)) }))
      return (
        <Panel {...p} cls="wide" title="Cambio tras el vuelo"
          right={LABS.isSample ? <span className="badge">Datos de ejemplo</span> : undefined}
          sub="Cuánto cambió cada medida entre 3 días antes del vuelo y 1 día después. Promedio de la tripulación.">
          <ChangeBars rows={rows} limit={LIMIT} columns={big ? 1 : 2} />
          <Legend items={[{ name: 'bajó', color: SERIES[0], box: true }, { name: 'subió', color: SERIES[3], box: true }]} />
        </Panel>
      )
    }
  }
}

function range(vals: (number | null)[]): { min: number; max: number; ticks: number[] } {
  const v = vals.filter((x): x is number => x !== null)
  if (!v.length) return { min: 0, max: 1, ticks: [0, 1] }
  const lo = Math.min(...v); const hi = Math.max(...v); const pad = (hi - lo || 1) * 0.15
  const step = Math.pow(10, Math.floor(Math.log10((hi - lo || 1) / 2)))
  const min = Math.floor((lo - pad) / step) * step; const max = Math.ceil((hi + pad) / step) * step
  return { min, max, ticks: [min, +((min + max) / 2).toPrecision(4), max] }
}

const ORDER: PanelId[] = ['sleep', 'body', 'labs', 'exercise', 'water', 'heart', 'rad', 'change']

export default function DataWall() {
  const [open, setOpen] = useState<PanelId | null>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [open])
  return (
    <>
      <div className="scene-head">
        <h1>Datos completos</h1>
        <p>Toca un panel para verlo en grande. Pasa el dedo o el cursor por un gráfico para ver cada valor.</p>
      </div>
      <div className="wall">{ORDER.map((id) => <Content key={id} id={id} big={false} onOpen={setOpen} />)}</div>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div style={{ position: 'relative', width: 'min(1100px, 100%)', height: 'min(640px, 100%)', display: 'grid' }} onClick={(e) => e.stopPropagation()}>
            <button className="close" aria-label="Cerrar" autoFocus onClick={() => setOpen(null)}><Icon name="close" size={18} /></button>
            <Content id={open} big onOpen={setOpen} />
          </div>
        </div>
      )}
    </>
  )
}
