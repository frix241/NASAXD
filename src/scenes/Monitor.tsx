import { useEffect, useState } from 'react'
import { DESTINATIONS, STATUS_WORD, statusPulse, statusSpo2, worst, type Destination, type Status } from '../config/rules'
import { statusPhrase, ZONE_LABEL, ZONE_METRICS, type Issue, type Zone } from '../sim/issues'
import type { MetricKey } from '../sim/simulator'
import { currentAlert, useStore } from '../store'
import { Twin, TwinFlat } from '../three/Twin'
import { Icon } from '../ui/Icon'
import { Spark, Trace } from '../ui/Trace'

export function StatusTag({ status, word }: { status: Status; word?: string }) {
  return <span className={`status s-${status}`}><Icon name={status} size={12} />{word ?? STATUS_WORD[status]}</span>
}

export function TopBar() {
  const day = useStore((s) => s.sim.missionDay)
  const minute = useStore((s) => s.sim.minuteOfDay)
  const dest = useStore((s) => s.sim.destination)
  const issues = useStore((s) => s.issues)
  const setDest = useStore((s) => s.setDest)
  const hh = String(Math.floor(minute / 60)).padStart(2, '0'); const mm = String(minute % 60).padStart(2, '0')
  const st: Status = issues.some((i) => i.level === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok'
  return (
    <header className="topbar">
      <span className="item">Día de misión <b>{day}</b></span>
      <span className="item">Hora de la nave <b>{hh}:{mm}</b></span>
      <span className="item" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        Destino
        <span className="seg" role="group" aria-label="Destino">
          {(Object.keys(DESTINATIONS) as Destination[]).map((d) => (
            <button key={d} aria-pressed={d === dest} onClick={() => setDest(d)}>{DESTINATIONS[d].label}</button>
          ))}
        </span>
      </span>
      <span className={`phrase s-${st}`} role="status"><Icon name={st} />{statusPhrase(issues)}</span>
    </header>
  )
}

const ZONES: Zone[] = ['heart', 'kidneys', 'bones', 'head', 'muscles', 'body']

function AlertPanel({ issue, more }: { issue: Issue; more: number }) {
  const act = useStore((s) => s.act)
  const dismiss = useStore((s) => s.dismiss)
  const red = issue.level === 'bad'
  useEffect(() => {
    if (red) return
    const t = setTimeout(() => dismiss(issue.key), 10000)
    return () => clearTimeout(t)
  }, [red, issue.key, dismiss])
  return (
    <section className={`alert s-${issue.level}`} role={red ? 'alertdialog' : 'status'} aria-live="assertive" aria-label={issue.title}>
      <StatusTag status={issue.level} word={red ? 'Atender ahora' : 'Para vigilar'} />
      <h2>{issue.title}</h2>
      <p>{issue.why}</p>
      <div className="row">
        <button className="btn" onClick={() => act(issue.action, issue.key)}>{issue.actionLabel}</button>
        <span className="hint">
          {red ? 'Confirma para continuar.' : 'Este aviso se cierra solo.'}
          {more > 0 && ` Hay ${more} más.`}
        </span>
      </div>
      {!red && <div className="timer"><i style={{ animationDuration: '10s' }} /></div>}
    </section>
  )
}

// Valores ficticios para mostrar el flujo de tripulación hasta conectar telemetría real.
const DEMO_CREW = [
  { id: 'crew-01', label: 'Tripulante 01', pulse: 72, spo2: 98 },
  { id: 'crew-02', label: 'Tripulante 02', pulse: 96, spo2: 94 },
  { id: 'crew-03', label: 'Tripulante 03', pulse: 70, spo2: 97 },
]

function CrewPanel() {
  const [followUp, setFollowUp] = useState(false)
  const crew = DEMO_CREW.map((member) => ({
    ...member,
    status: worst([statusPulse(member.pulse), statusSpo2(member.spo2)]),
  }))
  const alert = crew.find((member) => member.status !== 'ok')
  const concern = alert ? [
    statusPulse(alert.pulse) !== 'ok' ? 'pulso elevado' : null,
    statusSpo2(alert.spo2) !== 'ok' ? 'oxígeno bajo' : null,
  ].filter(Boolean).join(' y ') : ''

  return (
    <aside className="crew-panel holo" aria-label="Estado simulado de la tripulación">
      <header className="crew-head">
        <h2>Tripulación</h2><span className="badge">SIMULACIÓN</span>
      </header>
      <p className="crew-note">Datos de demostración, no telemetría real.</p>
      <div className="crew-list">
        {crew.map((member) => (
          <div key={member.id} className={`crew-member s-${member.status}`}>
            <div className="crew-member-head"><b>{member.label}</b><StatusTag status={member.status} /></div>
            <div className="crew-readings"><span>Pulso <b>{member.pulse}</b> lpm</span><span>Oxígeno <b>{member.spo2}</b>%</span></div>
          </div>
        ))}
      </div>
      {alert && (
        <div className={`crew-alert s-${alert.status}`} role="alert" aria-live="assertive">
          <p><StatusTag status={alert.status} word="Revisar" /> {alert.label}: {concern}; comprueba cómo se encuentra.</p>
          <button className="btn ghost small" onClick={() => setFollowUp(true)} disabled={followUp}>
            {followUp ? 'Seguimiento registrado' : 'Registrar seguimiento'}
          </button>
        </div>
      )}
    </aside>
  )
}

export default function Monitor() {
  const r = useStore((s) => s.readings)
  const sim = useStore((s) => s.sim)
  const highlight = useStore((s) => s.highlight)
  const setHighlight = useStore((s) => s.setHighlight)
  const webgl = useStore((s) => s.webgl)
  const alert = useStore(currentAlert)
  const issueCount = useStore((s) => s.issues.length)

  const zones = Object.fromEntries(
    (Object.keys(ZONE_METRICS) as Zone[]).map((z) => [z, worst(ZONE_METRICS[z].map((k) => r[k].status))]),
  ) as Record<Zone, Status>
  const hl = (k: MetricKey) => (highlight && ZONE_METRICS[highlight].includes(k) ? ' hl' : '')
  const chipValue: Record<Zone, string> = {
    heart: `${r.pulse.text} lpm`, kidneys: `${r.hydration.text} %`, bones: `${r.exercise.text} %`,
    head: `${r.sleep.text} h`, muscles: `${r.exercise.text} %`,
    body: r.temp.status !== 'ok' ? `${r.temp.text} °C` : `${r.radiation.text}×`,
  }
  const exercising = sim.exercisingLeft > 0

  return (
    <div className="monitor">
      <TopBar />
      <CrewPanel />
      <div className={`twin-col${highlight ? ' is-focused' : ''}`}>
        <div className="twin-view">{webgl ? <Twin zones={zones} /> : <TwinFlat zones={zones} />}</div>
        <div className="zones" role="group" aria-label="Zonas del cuerpo">
          {ZONES.map((z) => (
            <button key={z} className={`zone-chip s-${zones[z]}`} aria-pressed={highlight === z}
              aria-label={`${ZONE_LABEL[z]}: ${STATUS_WORD[zones[z]]}, ${chipValue[z]}`}
              onClick={() => setHighlight(highlight === z ? null : z)}>
              <span>{ZONE_LABEL[z]}</span>
              <span className="line"><StatusTag status={zones[z]} /><span className="num muted">{chipValue[z]}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="center-col">{alert && <AlertPanel key={alert.key + alert.level} issue={alert} more={issueCount - 1} />}</div>
      <div className="vitals">
        <div className={`vital s-${r.pulse.status}${hl('pulse')}`}>
          <i className="flash" key={r.pulse.status} />
          <div className="head"><span>Pulso</span><StatusTag status={r.pulse.status} />{exercising && <span className="note">en ejercicio</span>}</div>
          <Trace kind="ecg" rate={r.pulse.value} />
          <div className="value"><b>{r.pulse.text}</b><small>lpm</small></div>
        </div>
        <div className={`vital wide-m s-${r.bp.status}${hl('bp')}`}>
          <i className="flash" key={r.bp.status} />
          <div className="head"><span>Presión arterial</span><StatusTag status={r.bp.status} /></div>
          <Trace kind="art" rate={r.pulse.value} />
          <div className="value"><b>{r.bp.text}</b><small>mmHg</small></div>
        </div>
        <div className={`vital s-${r.spo2.status}${hl('spo2')}`}>
          <i className="flash" key={r.spo2.status} />
          <div className="head"><span>Oxígeno en sangre</span><StatusTag status={r.spo2.status} /></div>
          <Trace kind="pleth" rate={r.pulse.value} />
          <div className="value"><b>{r.spo2.text}</b><small>%</small></div>
        </div>
        <div className={`vital s-${r.hydration.status}${hl('hydration')}`}>
          <i className="flash" key={r.hydration.status} />
          <div className="head"><span>Hidratación</span><StatusTag status={r.hydration.status} /></div>
          <div className="gauge" aria-hidden="true">
            <i style={{ width: `${r.hydration.value}%` }} /><u style={{ left: '45%' }} /><u style={{ left: '70%' }} />
          </div>
          <div className="value"><b>{r.hydration.text}</b><small>% de agua</small></div>
        </div>
        <div className={`vital s-${r.temp.status}${hl('temp')}`}>
          <i className="flash" key={r.temp.status} />
          <div className="head"><span>Temperatura</span><StatusTag status={r.temp.status} /></div>
          <Spark values={sim.recentTemp} min={35.5} max={39} />
          <div className="value"><b>{r.temp.text}</b><small>°C</small></div>
        </div>
        <div className={`vital s-${r.resp.status}${hl('resp')}`}>
          <i className="flash" key={r.resp.status} />
          <div className="head"><span>Respiración</span><StatusTag status={r.resp.status} /></div>
          <Trace kind="resp" rate={r.resp.value} />
          <div className="value"><b>{r.resp.text}</b><small>rpm</small></div>
        </div>
      </div>
    </div>
  )
}
