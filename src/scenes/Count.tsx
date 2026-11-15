import { useEffect, useRef } from 'react'
import { actionOfDay, AULA_RULES, LEVEL2, pct, today, type Climate, type CountKey } from '../sim/aula'
import { useProfile, useStore } from '../store'
import { StatusTag, TopBar } from './Monitor'

/** Botón + o − grande. Si se mantiene apretado, sigue contando. */
function Hold({ label, onStep, children }: { label: string; onStep: () => void; children: string }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const step = useRef(onStep); step.current = onStep
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null }
  useEffect(() => stop, [])
  return (
    <button className="pm" aria-label={label}
      onPointerDown={(e) => { if (e.button !== 0) return; step.current(); stop(); timer.current = setInterval(() => step.current(), 140) }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step.current() } }}>{children}</button>
  )
}

function Stepper({ ask, value, total, onChange, status, empty }: {
  ask: string; value: number | null; total: number; onChange: (n: number) => void
  status?: 'ok' | 'warn' | 'bad'; empty?: string
}) {
  const v = value ?? 0
  return (
    <div className={`q s-${status ?? 'ok'}`}>
      <div className="q-text">
        <span>{ask}</span>
        {status && <span className="q-res">{value === null ? <span className="muted">{empty}</span> : <><StatusTag status={status} /><span className="muted num">{pct(v, total)} % del aula</span></>}</span>}
      </div>
      <div className="q-ctl">
        <Hold label={`Uno menos: ${ask}`} onStep={() => onChange(v - 1)}>−</Hold>
        <output className="num" aria-live="polite">{value === null ? '–' : v}</output>
        <Hold label={`Uno más: ${ask}`} onStep={() => onChange(v + 1)}>+</Hold>
      </div>
    </div>
  )
}

/** Conteo rápido: cinco preguntas, botones grandes, sin teclado. Solo cuántos, nunca quiénes. */
export default function Count() {
  const p = useProfile()
  const aula = useStore((s) => s.aula)
  const r = useStore((s) => s.readings)
  const set = useStore((s) => s.countToday)
  const setTotal = useStore((s) => s.countTotal)
  const next = useStore((s) => s.countNextDay)
  const d = today(aula)
  const action = actionOfDay(aula)
  const climate: [Climate, string][] = [['normal', 'Normal'], ['alto', 'Calor'], ['bajo', 'Frío']]
  return (
    <div>
      <TopBar />
      <div className="scene-head" style={{ marginTop: 14 }}>
        <h1>Conteo rápido</h1>
        <p>Cinco preguntas a mano alzada. Se anota cuántos, nunca quiénes.</p>
      </div>
      <div className="count">
        <div className="count-main">
          <Stepper ask="¿Cuántos durmieron poco?" value={d.sleptLittle} total={aula.total} status={r.sleep.status} onChange={(n) => set({ sleptLittle: n })} />
          <Stepper ask="¿Cuántos no desayunaron?" value={d.noBreakfast} total={aula.total} status={r.breakfast.status} onChange={(n) => set({ noBreakfast: n })} />
          <Stepper ask="¿Cuántos están decaídos?" value={d.low} total={aula.total} status={r.mood.status} onChange={(n) => set({ low: n })} />
          <div className={`q s-${r.radiation.status}`}>
            <div className="q-text"><span>¿Cómo está el clima hoy?</span><span className="q-res"><StatusTag status={r.radiation.status} /></span></div>
            <div className="q-opt" role="group" aria-label="Clima de hoy">
              {climate.map(([id, label]) => (
                <button key={id} aria-pressed={d.climate === id} onClick={() => set({ climate: id, extreme: false })}>{label}</button>
              ))}
            </div>
          </div>
          <div className={`q s-${r.exercise.status}`}>
            <div className="q-text"><span>¿Hubo recreo activo?</span><span className="q-res"><StatusTag status={r.exercise.status} /></span></div>
            <div className="q-opt" role="group" aria-label="Recreo activo">
              <button aria-pressed={d.recess} onClick={() => set({ recess: true })}>Sí</button>
              <button aria-pressed={!d.recess} onClick={() => set({ recess: false })}>No</button>
            </div>
          </div>
          <details className="level2">
            <summary>Más preguntas (opcional): agua, mochila y postura</summary>
            {LEVEL2.map((q) => (
              <Stepper key={q.field} ask={q.ask} value={d[q.field as CountKey] as number | null} total={aula.total} status={r[q.key].status}
                empty="sin registrar" onChange={(n) => set({ [q.field]: n })} />
            ))}
          </details>
        </div>
        <aside className="count-side">
          <div className="holo side-box">
            <Stepper ask="Estudiantes en el aula" value={aula.total} total={aula.total} onChange={setTotal} />
            <p className="muted small">Se configura una sola vez.</p>
          </div>
          <div className={`holo side-box s-${action.level}`}>
            <StatusTag status={action.level} word="Acción del día" />
            <h2>{action.title}</h2>
            <p>{action.text}</p>
          </div>
          <button className="btn" onClick={next}>Guardar y pasar al día siguiente</button>
          <p className="muted small">{p.text.privacy} Sin nombres ni cuentas.</p>
          <p className="muted small">Verde: menos de {AULA_RULES.warnPct} % del aula. Rojo: más de {AULA_RULES.badPct} %. {AULA_RULES.note}</p>
        </aside>
      </div>
    </div>
  )
}
