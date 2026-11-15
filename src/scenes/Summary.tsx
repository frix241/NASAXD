import { STATUS_WORD } from '../config/rules'
import { DESTINATIONS } from '../config/rules'
import {
  AULA_RULES, dayNumber, ESCALATE, evaluateAula, LEVEL2, QUESTIONS, redStreak, topActions, weekSummary,
} from '../sim/aula'
import { useProfile, useStore } from '../store'
import { ICE, Lines } from '../ui/charts'
import { Icon } from '../ui/Icon'
import { TopBar } from './Monitor'

function WeekTable({ words = false }: { words?: boolean }) {
  const aula = useStore((s) => s.aula)
  const week = weekSummary(aula)
  return (
    <table className="week">
      <thead>
        <tr><th scope="col">Pregunta</th>{aula.days.map((_, i) => <th scope="col" key={i}>Día {dayNumber(aula, i)}</th>)}</tr>
      </thead>
      <tbody>
        {week.map((w) => (
          <tr key={w.key}>
            <th scope="row">{w.short}</th>
            {w.statuses.map((s, i) => (
              <td key={i} className={`s-${s}`}><span className="cell"><Icon name={s} size={13} />{words ? STATUS_WORD[s] : <span className="sr">{STATUS_WORD[s]}</span>}</span></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Resumen de la semana del aula, con las dos hojas para imprimir. */
export default function Summary() {
  const p = useProfile()
  const aula = useStore((s) => s.aula)
  const print = (sheet: 'ficha' | 'informe') => {
    useStore.getState().set({ printing: sheet })
    // Se espera a que la hoja esté en pantalla antes de abrir el diálogo de impresión
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print()
      useStore.getState().set({ printing: null })
    }))
  }
  const labels = aula.days.map((_, i) => `Día ${dayNumber(aula, i)}`)
  const serie = (k: 'sleep' | 'breakfast' | 'mood') => aula.days.map((d) => evaluateAula(aula, d)[k].value)
  const charts: ['sleep' | 'breakfast' | 'mood', string][] = [['sleep', 'Durmieron poco'], ['breakfast', 'No desayunaron'], ['mood', 'Decaídos']]
  return (
    <div>
      <TopBar />
      <div className="scene-head" style={{ marginTop: 14 }}>
        <h1>Resumen de la semana</h1>
        <p>Los últimos {aula.days.length} días del aula, de {aula.total} estudiantes.</p>
        <span className="badge">Datos de demostración</span>
      </div>
      <div className="summary">
        <section className="holo sum-box">
          <h2>Semáforo de la semana</h2>
          <WeekTable />
          <div className="legend" style={{ marginTop: 8 }}>
            <span className="s-ok status"><Icon name="ok" size={12} />Bien</span>
            <span className="s-warn status"><Icon name="warn" size={12} />Vigilar</span>
            <span className="s-bad status"><Icon name="bad" size={12} />Atender</span>
          </div>
        </section>
        <section className="trends">
          {charts.map(([k, title]) => (
            <div className="holo sum-box trend" key={k}>
              <h2>{title} <span className="muted">(% del aula)</span></h2>
              <Lines labels={labels} min={0} max={60} ticks={[0, 20, 40, 60]} unit=" %"
                refLines={[{ v: AULA_RULES.badPct, label: `rojo sobre ${AULA_RULES.badPct} %` }]}
                series={[{ name: title, color: ICE, values: serie(k) }]} />
            </div>
          ))}
        </section>
        <div className="sum-actions">
          <button className="btn" onClick={() => print('ficha')}>Imprimir ficha</button>
          <button className="btn" onClick={() => print('informe')}>Informe para el director</button>
          <p className="muted small">La ficha en papel sirve para aulas sin dispositivo. {p.text.privacy} {AULA_RULES.note}</p>
        </div>
      </div>
    </div>
  )
}

/** Hojas imprimibles (una hoja cada una). En pantalla no se ven. */
export function PrintSheets() {
  const aula = useStore((s) => s.aula)
  const which = useStore((s) => s.printing)
  const p = useProfile()
  if (p.id !== 'school') return null
  const actions = topActions(aula)
  const escalate = QUESTIONS.filter((q) => redStreak(aula, q.key) >= AULA_RULES.redDaysToEscalate)
  const region = DESTINATIONS[aula.region].label
  const rows = [...QUESTIONS.map((q) => q.ask), ...LEVEL2.map((q) => `${q.ask} (opcional)`)]
  return (
    <div className="print-only" data-sheet={which ?? 'none'} aria-hidden="true">
      <article className="sheet ficha">
        <h1>Ficha diaria del aula</h1>
        <p className="fill">Colegio: ______________________ &nbsp; Aula: __________ &nbsp; Total de estudiantes: ______ &nbsp; Semana del: ___________</p>
        <p>Cada mañana, pregunte a mano alzada y anote <b>cuántos</b>. No se escriben nombres.</p>
        <table>
          <thead><tr><th>Pregunta</th>{[1, 2, 3, 4, 5, 6, 7].map((n) => <th key={n}>Día {n}</th>)}</tr></thead>
          <tbody>{rows.map((q) => <tr key={q}><th>{q}</th>{[1, 2, 3, 4, 5, 6, 7].map((n) => <td key={n} />)}</tr>)}</tbody>
        </table>
        <p className="how">Clima: escriba N (normal), C (calor) o F (frío). Recreo activo: Sí o No.</p>
        <h2>Cómo leerlo</h2>
        <ul>
          <li><b>Bien:</b> menos de 1 de cada 5 estudiantes ({AULA_RULES.warnPct} %).</li>
          <li><b>Vigilar:</b> entre 1 y 2 de cada 5 ({AULA_RULES.warnPct} a {AULA_RULES.badPct} %).</li>
          <li><b>Atender:</b> más de 2 de cada 5 (más de {AULA_RULES.badPct} %). Si se repite 3 días seguidos, converse con la familia o la posta de salud.</li>
        </ul>
        <p className="foot">AstroTwin Colegio. {AULA_RULES.note} Esta ficha no reemplaza una evaluación de salud.</p>
      </article>
      <article className="sheet informe">
        <h1>Informe semanal del aula para el director</h1>
        <p>Región: {region}. Estudiantes en el aula: {aula.total}. Días escolares {dayNumber(aula, 0)} al {dayNumber(aula)}.</p>
        <h2>Semáforo de la semana</h2>
        <WeekTable words />
        <h2>Tres acciones para la próxima semana</h2>
        {actions.length ? (
          <ol>{actions.map((a) => <li key={a.short}><b>{a.short}</b> ({a.days} {a.days === 1 ? 'día' : 'días'} fuera de verde). {a.action}</li>)}</ol>
        ) : <p>Semana en verde. Mantener la rutina: recreo activo y pausas para tomar agua.</p>}
        {escalate.length > 0 && <p><b>{escalate.map((q) => q.short).join(', ')}:</b> {ESCALATE}</p>}
        <p className="foot"><b>Datos de demostración.</b> {AULA_RULES.note} Conteos por aula, sin nombres. {p.text.privacy} Este informe no es un diagnóstico.</p>
      </article>
    </div>
  )
}
