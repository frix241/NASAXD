import { useEffect, useRef, useState } from 'react'
import { EXPLAIN_LABELS, SCHOOL_EXPLAIN, SPACE_EXPLAIN, type Field } from '../config/explain'
import { DESTINATIONS, STATUS_WORD, worst, type Status } from '../config/rules'
import { PROFILES, type ProfileId, type VitalRow } from '../profiles'
import { statusPhrase, type Issue, type Zone } from '../sim/issues'
import { dayNumber } from '../sim/aula'
import type { MetricKey } from '../sim/simulator'
import { currentAlert, useProfile, useStore } from '../store'
import { Twin, TwinFlat } from '../three/Twin'
import { Icon } from '../ui/Icon'
import { Spark, Trace } from '../ui/Trace'

export function StatusTag({ status, word }: { status: Status; word?: string }) {
  return <span className={`status s-${status}`}><Icon name={status} size={12} />{word ?? STATUS_WORD[status]}</span>
}

/** Interruptor de modo: Misión espacial | Colegio. También con la tecla C. */
export function ModeSwitch() {
  const profile = useStore((s) => s.profile)
  const setProfile = useStore((s) => s.setProfile)
  return (
    <span className="seg mode" role="group" aria-label="Modo">
      {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
        <button key={id} aria-pressed={id === profile} onClick={() => setProfile(id)}>{PROFILES[id].switchLabel}</button>
      ))}
    </span>
  )
}

export function TopBar() {
  const p = useProfile()
  const school = p.id === 'school'
  const day = useStore((s) => (school ? dayNumber(s.aula) : s.sim.missionDay))
  const minute = useStore((s) => s.sim.minuteOfDay)
  const dest = useStore((s) => (school ? s.aula.region : s.sim.destination))
  const issues = useStore((s) => s.issues)
  const setDest = useStore((s) => s.setDest)
  const hh = String(Math.floor(minute / 60)).padStart(2, '0'); const mm = String(minute % 60).padStart(2, '0')
  const st: Status = issues.some((i) => i.level === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok'
  return (
    <header className="topbar">
      <ModeSwitch />
      {p.text.alias && <span className="item">Alias <b>{p.text.alias}</b></span>}
      <span className="item">{p.text.day} <b>{day}</b></span>
      <span className="item">{p.text.clock} <b>{hh}:{mm}</b></span>
      <span className="item" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {p.text.dest}
        <span className="seg" role="group" aria-label={p.text.dest}>
          {p.destinations.map((d) => (
            <button key={d} aria-pressed={d === dest} onClick={() => setDest(d)}>{DESTINATIONS[d].label}</button>
          ))}
        </span>
      </span>
      <span className={`phrase s-${st}`} role="status"><Icon name={st} />{statusPhrase(issues)}</span>
    </header>
  )
}

function AlertPanel({ issue, more }: { issue: Issue; more: number }) {
  const act = useStore((s) => s.act)
  const dismiss = useStore((s) => s.dismiss)
  const p = useProfile()
  const red = issue.level === 'bad'
  useEffect(() => {
    if (red || !p.alertsAutoClose) return
    const t = setTimeout(() => dismiss(issue.key), 10000)
    return () => clearTimeout(t)
  }, [red, issue.key, dismiss, p.alertsAutoClose])
  return (
    <section className={`alert s-${issue.level}`} role={red ? 'alertdialog' : 'status'} aria-live="assertive" aria-label={issue.title}>
      <StatusTag status={issue.level} word={p.alertWord[issue.level]} />
      <h2>{issue.title}</h2>
      <p>{issue.why}</p>
      <div className="row">
        <button className="btn" onClick={() => act(issue.action, issue.key)}>{issue.actionLabel}</button>
        <span className="hint">
          {!p.alertsAutoClose ? 'Márcala cuando la hagas.' : red ? 'Confirma para continuar.' : 'Este aviso se cierra solo.'}
          {p.alertsAutoClose && more > 0 && ` Hay ${more} más.`}
        </span>
      </div>
      {!red && p.alertsAutoClose && <div className="timer"><i style={{ animationDuration: '10s' }} /></div>}
    </section>
  )
}

function Measure({ f, current }: { f: Field; current: number }) {
  const measure = useStore((s) => s.measure)
  const round = (v: number) => Math.round(v / f.step) * f.step
  const [v, setV] = useState(() => round(current))
  const fix = (n: number) => Math.min(f.max, Math.max(f.min, +round(n).toFixed(1)))
  return (
    <div className="measure">
      <label>{f.label}
        <span className="m-ctl">
          <button type="button" aria-label={`Bajar ${f.label}`} onClick={() => setV(fix(v - f.step))}>−</button>
          <input type="number" inputMode="decimal" value={v} min={f.min} max={f.max} step={f.step}
            onChange={(e) => setV(e.target.value === '' ? f.min : +e.target.value)} onBlur={() => setV(fix(v))} />
          <button type="button" aria-label={`Subir ${f.label}`} onClick={() => setV(fix(v + f.step))}>+</button>
          <span className="muted">{f.unit}</span>
        </span>
      </label>
      <button type="button" className="btn small" onClick={() => measure(f.field, fix(v))}>Guardar</button>
    </div>
  )
}

/** Explicación del indicador elegido: qué es, por qué cambia, cómo se mide y cuándo avisar. */
function ExplainPanel() {
  const p = useProfile()
  const key = useStore((s) => s.explain)
  const zone = useStore((s) => s.highlight)
  const r = useStore((s) => s.readings)
  const sim = useStore((s) => s.sim)
  const setExplain = useStore((s) => s.setExplain)
  const setScene = useStore((s) => s.setScene)
  const box = useRef<HTMLElement>(null)
  useEffect(() => { if (key) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [key])
  if (!key) return null
  const school = p.id === 'school'
  const e = (school ? SCHOOL_EXPLAIN : SPACE_EXPLAIN)[key]
  if (!e) return null
  const L = EXPLAIN_LABELS[p.id]
  const tabs = zone ? p.zones.metrics[zone].filter((k) => (school ? SCHOOL_EXPLAIN : SPACE_EXPLAIN)[k]) : [key]
  const reading = r[key]
  const current = (f: Field) => f.field === 'sleep' ? sim.sleepHours : f.field === 'mood' ? sim.mood : f.field === 'glucose' ? sim.glucose : sim.vitals[f.field]
  return (
    <section className={`explain s-${reading.status}`} ref={box} aria-label={`Explicación: ${reading.label}`}>
      <header>
        <h2>{reading.label}</h2>
        <StatusTag status={reading.status} />
        <span className="num muted">{reading.text} {reading.unit}</span>
        <button className="tool" aria-label="Cerrar explicación" onClick={() => setExplain(null)}><Icon name="close" size={16} /></button>
      </header>
      {tabs.length > 1 && (
        <div className="seg tabs" role="group" aria-label="Indicadores de esta zona">
          {tabs.map((k) => <button key={k} aria-pressed={k === key} onClick={() => setExplain(k)}>{r[k].label}</button>)}
        </div>
      )}
      <dl>
        <dt>{L.what}</dt><dd>{e.what}</dd>
        <dt>{L.why}</dt><dd>{e.why}{e.hazard && <span className="hazard">Riesgo del espacio: {e.hazard.toLowerCase()}</span>}</dd>
        <dt>{L.how}</dt><dd>{e.how}</dd>
        <dt>{L.alert}</dt><dd>{e.alert}</dd>
      </dl>
      {school
        ? <button className="btn small ghost" onClick={() => setScene(2)}>Ir al conteo rápido</button>
        : e.fields && (
          <div className="measures">
            <h3>Registrar una medición</h3>
            {e.fields.map((f) => <Measure key={f.field + key} f={f} current={current(f)} />)}
          </div>
        )}
    </section>
  )
}

/** Una fila del monitor. Qué se muestra y cómo lo decide el perfil activo. */
function Vital({ row, hl }: { row: VitalRow; hl: boolean }) {
  const setExplain = useStore((s) => s.setExplain)
  const open = useStore((s) => s.explain === row.key)
  const r = useStore((s) => s.readings[row.key])
  const pulse = useStore((s) => s.readings.pulse.value)
  const sim = useStore((s) => s.sim)
  const note = row.key === 'pulse' && sim.exercisingLeft > 0 ? 'en ejercicio' : null
  return (
    <div className={`vital${row.wide ? ' wide-m' : ''} s-${r.status}${hl ? ' hl' : ''}`} role="button" tabIndex={0} aria-expanded={open}
      aria-label={`${row.label}: ${r.text} ${row.unit || r.unit}. Tocar para ver la explicación`}
      onClick={() => setExplain(open ? null : row.key)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExplain(open ? null : row.key) } }}>
      <i className="flash" key={r.status} />
      <div className="head"><span>{row.label}</span><StatusTag status={r.status} />{note && <span className="note">{note}</span>}</div>
      {row.viz === 'gauge' && row.gauge ? (
        <div className="gauge" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (r.value / row.gauge.max) * 100)}%` }} />
          {row.gauge.ticks.map((t) => <u key={t} style={{ left: `${(t / row.gauge!.max) * 100}%` }} />)}
        </div>
      ) : row.viz === 'spark' && row.spark ? (
        <Spark values={sim.recentTemp} min={row.spark.min} max={row.spark.max} />
      ) : row.viz === 'none' ? <div /> : (
        <Trace kind={row.viz as 'ecg' | 'art' | 'pleth' | 'resp'} rate={row.viz === 'resp' ? r.value : pulse} />
      )}
      <div className="value"><b>{r.text}</b><small>{row.unit || r.unit}</small></div>
    </div>
  )
}

export default function Monitor() {
  const p = useProfile()
  const r = useStore((s) => s.readings)
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)
  const webgl = useStore((s) => s.webgl)
  const alert = useStore(currentAlert)
  const issueCount = useStore((s) => s.issues.length)

  const zones = Object.fromEntries(
    (Object.keys(p.zones.metrics) as Zone[]).map((z) => [z, worst(p.zones.metrics[z].map((k) => r[k].status))]),
  ) as Record<Zone, Status>
  const hl = (k: MetricKey) => !!highlight && p.zones.metrics[highlight].includes(k)

  return (
    <div className="monitor">
      <TopBar />
      <div className="twin-col">
        <div className="twin-view">{webgl ? <Twin zones={zones} gear={p.id} hidden={p.hiddenZones} label={p.text.twinLabel} /> : <TwinFlat zones={zones} />}</div>
        <div className="zones" role="group" aria-label="Zonas del cuerpo">
          {p.zoneOrder.map((z) => (
            <button key={z} className={`zone-chip s-${zones[z]}`} aria-pressed={highlight === z}
              onClick={() => setHighlight(highlight === z ? null : z)}>
              <span>{p.zones.label[z]}</span>
              <span className="line"><StatusTag status={zones[z]} /><span className="num muted">{p.chip(z, r)}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="center-col">
        {alert && <AlertPanel key={alert.key + alert.level} issue={alert} more={issueCount - 1} />}
        <ExplainPanel />
      </div>
      <div className="vitals">{p.vitals.map((row) => <Vital key={row.key} row={row} hl={hl(row.key)} />)}</div>
    </div>
  )
}
