import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import '../../community-evaluate.css'
import '../../community-shared.css'
import { QU_PENDING, useT } from '../../i18n'
import { COMMUNITY_RULES, PENDING_VALIDATION } from '../../config/communityRules'
import { DANGER_SIGNS, type Cold, type DangerSign, type PersonKind, type YesNo } from '../../sim/community'
import { useStore } from '../../store'
import { BreathTimer } from '../../ui/community/BreathTimer'
import { Pictogram, type PictogramName } from '../../ui/community/Pictogram'
import { ReadAloud } from '../../ui/community/ReadAloud'
import { Icon } from '../../ui/Icon'
import { TopBar } from '../Monitor'

const es = {
  title: 'Evaluar',
  pending: 'Umbrales pendientes de validar',
  lead: 'Apoyo para decidir. No es un diagnóstico.',
  lang: 'Idioma',
  langEs: 'Español',
  langQu: 'Quechua (runasimi)',

  who: 'Quién es',
  child: 'Niño menor de 5',
  elder: 'Adulto mayor',
  adult: 'Adulto',
  alias: 'Alias',
  aliasHint: 'Alias, nunca el nombre real.',
  age: 'Edad en meses',
  months: 'meses',

  danger: 'Señales de alarma',
  dangerLead: 'Toca las que veas ahora.',
  noDrink: 'No puede beber o comer',
  vomits: 'Vomita todo',
  convulsions: 'Convulsiones',
  sleepy: 'Muy somnoliento',
  breathless: 'Dificultad para respirar',
  chestIndrawing: 'Hundimiento de costillas',
  blueLips: 'Labios morados',
  dangerBand: 'Con una señal de alarma siempre se deriva a la posta',

  observe: 'Observación',
  cough: 'Tiene tos',
  feverTouch: 'Tiene fiebre (al tacto)',
  warmEnough: 'Tiene abrigo suficiente',
  ateDrank: 'Comió y tomó líquidos hoy',
  yes: 'Sí',
  no: 'No',
  unknown: 'No sé',

  breathing: 'Respiración',

  place: 'Entorno',
  cold: 'Nivel de frío',
  coldNormal: 'Normal',
  coldFrio: 'Frío',
  coldHelada: 'Helada',
  altitude: 'Altitud aproximada',
  meters: 'metros',
  hours: 'Distancia a la posta',
  hoursUnit: 'horas',

  sensors: 'Si tienes termómetro o pulsioxímetro (no es necesario)',
  temp: 'Temperatura',
  tempUnit: 'grados',
  spo2: 'Saturación',
  spo2Unit: 'por ciento',
  remove: 'Quitar',
  noData: 'Sin dato',
  less: 'Bajar',
  more: 'Subir',

  result: 'Resultado',
  doNow: 'Qué hacer ahora',
  answered: 'Respondiste',
  of: 'de',
  showMore: 'Ver más',
  showLess: 'Ver menos',
  sheet: 'Ver hoja de derivación',
  newPerson: 'Nueva persona',
}
/** Quechua: vacío hasta que lo revisen hablantes nativos. No inventar traducciones. */
const qu: Partial<Record<keyof typeof es, string>> = {}
type T = (key: keyof typeof es) => string

const KINDS: PersonKind[] = ['child', 'elder', 'adult']
const COLDS: { id: Cold; text: 'coldNormal' | 'coldFrio' | 'coldHelada' }[] = [
  { id: 'normal', text: 'coldNormal' }, { id: 'frio', text: 'coldFrio' }, { id: 'helada', text: 'coldHelada' },
]
const OBSERVE = ['cough', 'feverTouch', 'warmEnough', 'ateDrank'] as const
const comma = (n: number, digits = 0) => n.toFixed(digits).replace('.', ',')
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Botón + o − grande. Si se mantiene apretado, sigue sumando. */
function Hold({ label, pic, onStep, disabled }: { label: string; pic: 'plus' | 'minus'; onStep: () => void; disabled?: boolean }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const step = useRef(onStep); step.current = onStep
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null }
  useEffect(() => stop, [])
  useEffect(() => { if (disabled) stop() }, [disabled])
  return (
    <button type="button" className="cm-pm" aria-label={label} disabled={disabled}
      onPointerDown={(e) => { if (e.button !== 0) return; step.current(); stop(); timer.current = setInterval(() => step.current(), 160) }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      // Teclado y lectores de pantalla: llegan como clic sin puntero
      onClick={(e) => { if (e.detail === 0) step.current() }}>
      <Pictogram name={pic} size={26} />
    </button>
  )
}

function Row({ pic, text, hint, children }: { pic?: PictogramName; text: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="cm-row">
      {pic && <Pictogram name={pic} size={40} />}
      <span className="cm-row-text">{text}{hint && <small>{hint}</small>}</span>
      {children}
    </div>
  )
}

function Stepper({ t, label, value, unit, step, min, max, start, digits = 0, onChange }: {
  t: T; label: string; value: number | null; unit: string; step: number; min: number; max: number
  /** Valor del que se parte cuando todavía no hay dato */
  start?: number; digits?: number; onChange: (n: number) => void
}) {
  const move = (dir: 1 | -1) => {
    if (value === null) { onChange(start ?? min); return }
    onChange(clamp(+(value + dir * step).toFixed(digits), min, max))
  }
  return (
    <span className="cm-stepper" role="group" aria-label={label}>
      <Hold label={`${t('less')}: ${label}`} pic="minus" onStep={() => move(-1)} disabled={value !== null && value <= min} />
      <output className={`cm-step-val num ${value === null ? 'is-empty' : ''}`} aria-live="polite">
        {value === null ? t('noData') : <>{comma(value, digits)} <small>{unit}</small></>}
      </output>
      <Hold label={`${t('more')}: ${label}`} pic="plus" onStep={() => move(1)} disabled={value !== null && value >= max} />
    </span>
  )
}

/** Tres opciones: Sí / No / No sé (sin responder). */
function Tri({ t, label, value, onChange }: { t: T; label: string; value: YesNo; onChange: (v: YesNo) => void }) {
  const opts: { v: YesNo; text: string }[] = [{ v: true, text: t('yes') }, { v: false, text: t('no') }, { v: null, text: t('unknown') }]
  return (
    <span className="cm-opts" role="group" aria-label={label}>
      {opts.map((o) => (
        <button type="button" key={String(o.v)} className="cm-opt" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {value === o.v && <Icon name="ok" size={18} />}{o.text}
        </button>
      ))}
    </span>
  )
}

function ResultPanel({ t }: { t: T }) {
  const r = useStore((s) => s.result)
  const newPerson = useStore((s) => s.newPerson)
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const { answered, total } = r.confidence
  const spoken = `${r.label}. ${r.reason} ${r.actions.join(' ')}`
  return (
    <aside className={`cm-result s-${r.status} ${open ? 'is-open' : ''}`} aria-label={t('result')}>
      <div className="cm-result-head" role="status" aria-live="polite">
        {/* Al cambiar la decisión, la cabecera se vuelve a dibujar de izquierda a derecha */}
        <div className="cm-result-now" key={r.status}>
          <span className="cm-result-badge"><Icon name={r.status} size={34} /></span>
          <strong className="cm-result-label">{r.label}</strong>
        </div>
        <button type="button" className="ev-btn cm-result-more" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          {open ? t('showLess') : t('showMore')}
        </button>
      </div>
      <div className="cm-result-body" id={bodyId}>
        <p className="cm-result-reason">{r.reason}</p>
        <h3>{t('doNow')}</h3>
        <ol className="ev-actions">
          {r.actions.map((a, i) => <li key={i}>{a}</li>)}
        </ol>
        <div className="ev-conf">
          <p>{r.confidence.text}</p>
          <div className="ev-conf-count">
            <span className="ev-conf-bar" aria-hidden="true">
              {Array.from({ length: total }, (_, i) => <i key={i} className={i < answered ? 'on' : ''} />)}
            </span>
            <span className="num">{t('answered')} {answered} {t('of')} {total}</span>
          </div>
        </div>
        <div className="cm-result-btns">
          <button type="button" className="ev-btn is-primary" onClick={() => useStore.getState().setScene(3)}>
            <Pictogram name="sheet" size={30} /><span>{t('sheet')}</span>
          </button>
          <ReadAloud text={spoken} />
          <button type="button" className="ev-btn" onClick={() => { newPerson(); setOpen(false) }}>
            <Pictogram name="newPerson" size={30} /><span>{t('newPerson')}</span>
          </button>
        </div>
      </div>
    </aside>
  )
}

/** Pantalla "Evaluar": lo que el agente comunitario ve y toca durante la visita. */
export default function Evaluate() {
  const t = useT(es, qu)
  const v = useStore((s) => s.visit)
  const setVisit = useStore((s) => s.setVisit)
  const toggleDanger = useStore((s) => s.toggleDanger)
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const aliasId = useId()
  const anyDanger = DANGER_SIGNS.some((k) => v.danger[k])

  return (
    <div className="cm-eval">
      <TopBar />
      <header className="ev-head">
        <div className="ev-head-text">
          <h1>{t('title')}</h1>
          <p>{t('lead')}</p>
        </div>
        <div className="cm-lang">
          <span className="cm-opts" role="group" aria-label={t('lang')}>
            <button type="button" className="cm-opt" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>
              {lang === 'es' && <Icon name="ok" size={18} />}{t('langEs')}
            </button>
            <button type="button" className="cm-opt" aria-pressed={lang === 'qu'} onClick={() => setLang('qu')}>
              {lang === 'qu' && <Icon name="ok" size={18} />}{t('langQu')}
            </button>
          </span>
          {lang === 'qu' && <p className="ev-note s-warn" role="status"><Icon name="warn" size={18} />{QU_PENDING}</p>}
        </div>
      </header>

      <div className="cm-layout">
        <div className="cm-form">
          <section className="cm-sec" aria-label={t('who')}>
            <h2>{t('who')}</h2>
            <div className="cm-kinds" role="group" aria-label={t('who')}>
              {KINDS.map((k) => (
                <button type="button" key={k} className="cm-kind" aria-pressed={v.kind === k} onClick={() => setVisit({ kind: k })}>
                  <Pictogram name={k} size={56} />
                  <span>{v.kind === k && <Icon name="ok" size={18} />}{t(k)}</span>
                </button>
              ))}
            </div>
            <div className="cm-row">
              <label className="cm-row-text" htmlFor={aliasId}>{t('alias')}<small>{t('aliasHint')}</small></label>
              <input id={aliasId} className="cm-input" type="text" value={v.alias} maxLength={18} autoComplete="off" spellCheck={false}
                onChange={(e) => setVisit({ alias: e.target.value })} />
            </div>
            {v.kind === 'child' && (
              <Row text={t('age')}>
                <Stepper t={t} label={t('age')} value={v.ageMonths} unit={t('months')} step={1} min={0} max={59}
                  onChange={(n) => setVisit({ ageMonths: n })} />
              </Row>
            )}
          </section>

          <section className={`cm-sec ${anyDanger ? 'has-danger' : ''}`} aria-label={t('danger')}>
            <h2>{t('danger')} <small>{t('dangerLead')}</small></h2>
            <div className="cm-signs">
              {DANGER_SIGNS.map((k: DangerSign) => {
                const on = v.danger[k]
                return (
                  <button type="button" key={k} className={`cm-sign ${on ? 's-bad' : ''}`} aria-pressed={on} onClick={() => toggleDanger(k)}>
                    <Pictogram name={k} size={48} />
                    <span className="cm-sign-text">{t(k)}</span>
                    <span className="cm-sign-state">
                      <i className="cm-switch" aria-hidden="true" />
                      {on && <Icon name="warn" size={18} />}{on ? t('yes') : t('no')}
                    </span>
                  </button>
                )
              })}
            </div>
            {anyDanger && (
              <p className="cm-band s-bad" role="alert">
                <Pictogram name="post" size={40} /><span>{t('dangerBand')}</span>
              </p>
            )}
          </section>

          <section className="cm-sec" aria-label={t('observe')}>
            <h2>{t('observe')}</h2>
            {OBSERVE.map((k) => (
              <Row key={k} pic={k} text={t(k)}>
                <Tri t={t} label={t(k)} value={v[k]} onChange={(val) => setVisit({ [k]: val })} />
              </Row>
            ))}
          </section>

          <section className="cm-sec" aria-label={t('breathing')}>
            <h2>{t('breathing')}</h2>
            <BreathTimer />
          </section>

          <section className="cm-sec" aria-label={t('place')}>
            <h2>{t('place')}</h2>
            <Row text={t('cold')}>
              <span className="cm-opts cm-colds" role="group" aria-label={t('cold')}>
                {COLDS.map((c) => (
                  <button type="button" key={c.id} className="cm-opt" aria-pressed={v.cold === c.id} onClick={() => setVisit({ cold: c.id })}>
                    <Pictogram name={c.id} size={34} />
                    <span>{v.cold === c.id && <Icon name="ok" size={18} />}{t(c.text)}</span>
                  </button>
                ))}
              </span>
            </Row>
            <Row pic="mountain" text={t('altitude')}>
              <Stepper t={t} label={t('altitude')} value={v.altitude} unit={t('meters')} step={100} min={0} max={5500}
                onChange={(n) => setVisit({ altitude: n })} />
            </Row>
            <Row pic="post" text={t('hours')}>
              <Stepper t={t} label={t('hours')} value={v.hoursToPost} unit={t('hoursUnit')} step={0.5} min={0} max={24} digits={1}
                onChange={(n) => setVisit({ hoursToPost: n })} />
            </Row>
          </section>

          <details className="cm-sec cm-sensors">
            <summary><span>{t('sensors')}</span></summary>
            <Row pic="thermometer" text={t('temp')}>
              <Stepper t={t} label={t('temp')} value={v.tempC} unit={t('tempUnit')} step={0.1} min={30} max={43} start={36.5} digits={1}
                onChange={(n) => setVisit({ tempC: n })} />
              <button type="button" className="ev-btn is-quiet" disabled={v.tempC === null} onClick={() => setVisit({ tempC: null })}>{t('remove')}</button>
            </Row>
            <Row pic="oximeter" text={t('spo2')}>
              <Stepper t={t} label={t('spo2')} value={v.spo2} unit={t('spo2Unit')} step={1} min={50} max={100} start={95}
                onChange={(n) => setVisit({ spo2: n })} />
              <button type="button" className="ev-btn is-quiet" disabled={v.spo2 === null} onClick={() => setVisit({ spo2: null })}>{t('remove')}</button>
            </Row>
          </details>

          <details className="cm-sec cm-pending">
            <summary><span>{t('pending')}</span></summary>
            <p className="cm-pending-note">{COMMUNITY_RULES.note}</p>
            <ul className="cm-pending-list">
              {PENDING_VALIDATION.map((p) => (
                <li key={p.id}><span>{p.what}</span><b className="num">{p.value}</b></li>
              ))}
            </ul>
          </details>
        </div>

        <ResultPanel t={t} />
      </div>
    </div>
  )
}
