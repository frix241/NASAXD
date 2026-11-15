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
      aria-label={big ? title : `${title}. Select to enlarge`}
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
  const days = h.sleep.map((_, i) => `Day ${sim.missionDay - 13 + i}`)
  const week = h.exercise.map((_, i) => `Day ${sim.missionDay - 6 + i}`)
  const cum: number[] = []
  let acc = sim.radTotal
  for (let i = h.radDaily.length - 1; i >= 0; i--) { cum[i] = +acc.toFixed(2); acc -= h.radDaily[i] }
  return { sim, r, h, days, week, cum }
}

function Content({ id, big, onOpen }: { id: PanelId; big: boolean; onOpen: (id: PanelId) => void }) {
  const { sim, r, h, days, week, cum } = useData()
  const [crew, setCrew] = useState('Average')
  const [measure, setMeasure] = useState(0)
  const p = { id, big, onOpen }
  switch (id) {
    case 'sleep': return (
      <Panel {...p} title="Sleep" right={<>last night {r.sleep.text} h <StatusTag status={r.sleep.status} /></>}
        sub="Hours slept each night over the last 14 days. 7 hours or more is healthy.">
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
        <Panel {...p} title="Muscle and bone" right={`routine at ${r.exercise.text}%`}
          sub={`6-month estimate. Without exercise, bone loss is ${nf(RULES.body.boneLossPerMonth)} to ${nf(RULES.body.muscleLossPerMonth, 1)}% per month. Following your routine slows this loss.`}>
          <Lines labels={months.map((m) => (m === 0 ? 'Today' : `Month ${m}`))} min={90} max={100} ticks={[90, 95, 100]} unit=" %" d={1}
            series={[
              { name: 'Muscle with your routine', color: SERIES[0], values: mk('muscle', a) },
              { name: 'Bone with your routine', color: SERIES[1], values: mk('bone', a) },
              { name: 'Muscle without exercise', color: SERIES[0], dash: true, values: mk('muscle', 0) },
              { name: 'Bone without exercise', color: SERIES[1], dash: true, values: mk('bone', 0) },
            ]} />
          <Legend items={[{ name: 'Muscle', color: SERIES[0] }, { name: 'Bone', color: SERIES[1] }, { name: 'No exercise', color: '#86a3cb', dash: true }]} />
        </Panel>
      )
    }
    case 'exercise': return (
      <Panel {...p} title="Weekly exercise" right={<>{r.exercise.text}% <StatusTag status={r.exercise.status} /></>}
        sub={`Exercise minutes per day. The goal is ${EXERCISE_GOAL_MIN} minutes daily.`}>
        <Bars values={h.exercise} labels={week} max={90} ticks={[0, 30, 60, 90]} refLine={{ v: EXERCISE_GOAL_MIN, label: 'goal' }}
          color={() => ICE} tipText={(v, i) => <><span className="muted">{week[i]}: </span><b>{v} min</b></>} />
      </Panel>
    )
    case 'water': return (
      <Panel {...p} title="Hydration" right={<>{r.hydration.text}% <StatusTag status={r.hydration.status} /></>}
        sub="Average daily body water. Below 70%, consider drinking more.">
        <Lines labels={days} min={30} max={100} ticks={[40, 70, 100]} unit=" %" refLines={[{ v: 70, label: 'healthy from 70%' }]}
          series={[{ name: 'Hydration', color: ICE, values: h.hydration }]} />
      </Panel>
    )
    case 'heart': return (
      <Panel {...p} title="Blood pressure and heart rate" right={`${r.bp.text} mmHg`}
        sub="Top: blood pressure (systolic). Bottom: resting heart rate. Each has its own scale.">
        <Lines labels={days} min={90} max={150} ticks={[100, 120, 140]} unit=" mmHg" refLines={[{ v: 120, label: 'watch blood pressure from 120' }]}
          series={[{ name: 'Blood pressure', color: ICE, values: h.sys }]} />
        <Lines labels={days} min={50} max={110} ticks={[60, 85, 110]} unit=" bpm" refLines={[{ v: 85, label: 'watch heart rate from 85' }]}
          series={[{ name: 'Heart rate', color: ICE, values: h.pulse }]} />
      </Panel>
    )
    case 'rad': {
      const top = Math.max(1, Math.ceil(Math.max(...h.radDaily) * 1.25 * 2) / 2)
      const c0 = Math.floor(cum[0]); const c1 = Math.ceil(cum[cum.length - 1] + 0.5)
      return (
        <Panel {...p} title="Radiation" right={<>total {nf(sim.radTotal, 1)} mSv <StatusTag status={r.radiation.status} /></>}
            sub="Top: received each day. Bottom: accumulated over the mission. Measured in millisieverts (mSv).">
          <Bars values={h.radDaily} labels={days} max={top} ticks={[0, top / 2, top]} d={1} color={() => ICE}
            tipText={(v, i) => <><span className="muted">{days[i]}: </span><b>{nf(v, 2)} mSv</b></>} />
          <Lines labels={days} min={c0} max={c1} ticks={[c0, c1]} unit=" mSv" d={2}
            series={[{ name: 'Cumulative', color: ICE, values: cum }]} />
        </Panel>
      )
    }
    case 'labs': {
      const names = LABS.measures.map((m) => m.name)
      const displayNames = names.map((name) => ({
        'Glóbulos rojos': 'Red blood cells',
        'Glóbulos blancos': 'White blood cells',
        'Proteína total': 'Total protein',
        'Colesterol total': 'Total cholesterol',
        'Calcio': 'Calcium',
        'Glucosa': 'Glucose',
        'Hemoglobina': 'Hemoglobin',
        'Hematocrito': 'Hematocrit',
        'Plaquetas': 'Platelets',
        'Sodio': 'Sodium',
        'Potasio': 'Potassium',
        'Urea': 'Urea',
        'Creatinina': 'Creatinine',
        'Proteína C reactiva': 'C-reactive protein',
        'Vitamina D': 'Vitamin D',
      }[name] ?? name))
      const who = ['Average', ...LABS.crews]
      const raw = (m: string) => (crew === 'Average' ? crewMean(LABS, m) : LABS.values[m][crew])
      const pct = names.map((m) => vsBaseline(raw(m)))
      const sel = LABS.measures[measure]
      const heat = (
        <>
          <Heatmap rows={displayNames} cols={[...TIMEPOINTS]} limit={LIMIT} cell={(i, j) => pct[i][j]}
            selected={big ? measure : undefined} onSelect={big ? setMeasure : undefined}
            tipText={(i, j) => {
              const v = raw(names[i])[j]; const c = pct[i][j]
              return (
                <>
                  <div className="muted">{displayNames[i]}, {TIMEPOINT_HINT[TIMEPOINTS[j]]}</div>
                  {v === null ? <b>no data</b> : <><b>{nf(v, v < 20 ? 2 : 1)} {LABS.measures[i].unit}</b>{c !== null && <span className="muted"> ({c > 0 ? '+' : ''}{nf(c, 1)}% vs. preflight)</span>}</>}
                </>
              )
            }} />
          <Legend items={[
            { name: 'lower than preflight', color: SERIES[0], box: true }, { name: 'unchanged', color: 'rgb(38,46,60)', box: true },
            { name: 'higher', color: SERIES[3], box: true }, { name: 'no data', color: '', pattern: true },
          ]} />
        </>
      )
      return (
        <Panel {...p} cls="wide tall" title="Inspiration4 mission blood tests"
          right={LABS.isSample ? <span className="badge">Sample data</span> : `${LABS.crews.length} crew members`}
          sub={`${names.length} measures across ${TIMEPOINTS.length} time points: L = days before launch, R = days after return.`}>
          {!big ? heat : (
            <>
              <div className="seg" role="group" aria-label="Crew member" style={{ margin: '8px 0', alignSelf: 'flex-start' }}>
                {who.map((c) => <button key={c} aria-pressed={c === crew} onClick={() => setCrew(c)}>{c}</button>)}
              </div>
              <div className="lab-split">
                <div>{heat}</div>
                <div>
                  <h3 style={{ fontSize: 15 }}>{displayNames[measure]} <span className="muted" style={{ fontWeight: 400 }}>({sel.unit}), by crew member</span></h3>
                  <p className="sub">Select a measure on the map to see it here. Gaps indicate missing data.</p>
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
        <Panel {...p} cls="wide" title="Change after flight"
          right={LABS.isSample ? <span className="badge">Sample data</span> : undefined}
          sub="Change in each measure from 3 days before launch to 1 day after. Crew average.">
          <ChangeBars rows={rows} limit={LIMIT} columns={big ? 1 : 2} />
          <Legend items={[{ name: 'decreased', color: SERIES[0], box: true }, { name: 'increased', color: SERIES[3], box: true }]} />
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
        <h1>Full data</h1>
        <p>Select a panel to enlarge it. Hover or move your finger over a chart to see each value.</p>
      </div>
      <div className="wall">{ORDER.map((id) => <Content key={id} id={id} big={false} onOpen={setOpen} />)}</div>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div style={{ position: 'relative', width: 'min(1100px, 100%)', height: 'min(640px, 100%)', display: 'grid' }} onClick={(e) => e.stopPropagation()}>
            <button className="close" aria-label="Close" autoFocus onClick={() => setOpen(null)}><Icon name="close" size={18} /></button>
            <Content id={open} big onOpen={setOpen} />
          </div>
        </div>
      )}
    </>
  )
}
