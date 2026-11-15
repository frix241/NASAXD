import type { Status } from '../../config/rules'
import { useT } from '../../i18n'
import type { BodyZone } from '../../sim/community'
import { useStore } from '../../store'
import { CommunityTwin } from '../../three/Twin'
import { Icon } from '../../ui/Icon'
import { TopBar } from '../Monitor'
import '../../community-out.css'
import '../../community-shared.css'

const en = {
  title: 'Person',
  twin: 'Digital twin of the person being assessed',
  zones: 'Body areas',
  head: 'Head', chest: 'Chest', hands: 'Hands', feet: 'Feet',
  ok: 'Good', warn: 'Monitor', bad: 'Refer',
  decision: 'What to do now',
  actions: 'Do this now',
  confidence: 'Confidence in this guidance',
  answered: 'Answered',
  of: 'of',
  alta: 'High confidence', media: 'Medium confidence', baja: 'Low confidence',
  findings: 'Findings',
  noFindings: 'No findings yet. Select Assessment and answer the questions.',
  who: 'Person',
  child: 'Child under 5', elder: 'Older adult', adult: 'Adult',
  year: 'year', years: 'years', month: 'month', months: 'months',
  cold: 'Environmental cold',
  normal: 'Normal', frio: 'Cold', helada: 'Frost',
  altitude: 'm elevation',
  post: 'Distance to health post',
  hour: 'hour away', hours: 'hours away',
  evaluate: 'Assessment',
  sheet: 'Referral form',
  frost: 'Simulate frost',
  demo: 'Demonstration data',
  note: 'Decision support using rules based on MINSA protocols. Does not replace care at a health post.',
}

const ZONES: BodyZone[] = ['head', 'chest', 'hands', 'feet']
const COLD_STATUS: Record<'normal' | 'frio' | 'helada', Status> = { normal: 'ok', frio: 'warn', helada: 'bad' }
const CONF_STATUS: Record<'alta' | 'media' | 'baja', Status> = { alta: 'ok', media: 'warn', baja: 'bad' }
const num = (v: number) => String(Math.round(v * 10) / 10)

/** Figura plana de respaldo si el dispositivo no tiene WebGL: las cuatro zonas con su estado. */
function FlatFigure({ zones, label }: { zones: Record<BodyZone, Status>; label: string }) {
  const c = (z: BodyZone) => `var(--${zones[z]})`
  return (
    <svg className="cm-flat" viewBox="0 0 200 320" role="img" aria-label={label}>
      <rect x="62" y="96" width="76" height="120" rx="22" fill={c('chest')} stroke="var(--border)" strokeWidth="3" />
      <circle cx="100" cy="56" r="36" fill={c('head')} stroke="var(--border)" strokeWidth="3" />
      <rect x="22" y="104" width="36" height="92" rx="16" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
      <rect x="142" y="104" width="36" height="92" rx="16" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
      <circle cx="40" cy="212" r="19" fill={c('hands')} stroke="var(--border)" strokeWidth="3" />
      <circle cx="160" cy="212" r="19" fill={c('hands')} stroke="var(--border)" strokeWidth="3" />
      <rect x="66" y="218" width="28" height="82" rx="12" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
      <rect x="106" y="218" width="28" height="82" rx="12" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
      <rect x="56" y="296" width="42" height="18" rx="8" fill={c('feet')} stroke="var(--border)" strokeWidth="3" />
      <rect x="102" y="296" width="42" height="18" rx="8" fill={c('feet')} stroke="var(--border)" strokeWidth="3" />
    </svg>
  )
}

/** Pantalla principal del perfil comunidad: la decisión, el gemelo y los datos de la persona. */
export default function Person() {
  const t = useT(en, {})
  const visit = useStore((s) => s.visit)
  const result = useStore((s) => s.result)
  const webgl = useStore((s) => s.webgl)
  const frostOn = useStore((s) => s.frostOn)
  const frost = useStore((s) => s.frost)
  const setScene = useStore((s) => s.setScene)

  const { confidence: c } = result
  const total = Math.max(1, c.total)
  const age = visit.kind !== 'child' ? null
    : visit.ageMonths >= 12
      ? `${Math.floor(visit.ageMonths / 12)} ${Math.floor(visit.ageMonths / 12) === 1 ? t('year') : t('years')}`
      : `${visit.ageMonths} ${visit.ageMonths === 1 ? t('month') : t('months')}`

  return (
    <div className="cm-out cm-person">
      <TopBar />
      <h1 className="cm-sr">{t('title')}</h1>
      <div className="cm-person-grid">
        <section className={`cm-decision s-${result.status}`} aria-label={t('decision')} role="status">
          <header className="cm-verdict">
            <span className="cm-verdict-icon" key={result.status}><Icon name={result.status} size={44} /></span>
            <div>
              <h2>{result.label}</h2>
              <p className="cm-reason">{result.reason}</p>
            </div>
          </header>

          <h3>{t('actions')}</h3>
          <ol className="cm-actions">
            {result.actions.map((a, i) => <li key={i}><span className="cm-n" aria-hidden="true">{i + 1}</span><span>{a}</span></li>)}
          </ol>

          <div className={`cm-conf s-${CONF_STATUS[c.level]}`}>
            <h3>{t('confidence')}</h3>
            <p className="cm-conf-line">
              <span className="cm-state"><Icon name={CONF_STATUS[c.level]} size={20} />{t(c.level)}</span>
              <span className="cm-num">{t('answered')} {c.answered} {t('of')} {c.total}</span>
            </p>
            <div className="cm-segs" role="img" aria-label={`${t('answered')} ${c.answered} ${t('of')} ${c.total}`}>
              {Array.from({ length: total }, (_, i) => <i key={i} className={i < c.answered ? 'on' : ''} />)}
            </div>
            <p className="cm-conf-text">{c.text}</p>
          </div>

          <h3>{t('findings')}</h3>
          {result.findings.length ? (
            <ul className="cm-findings">
              {result.findings.map((f) => (
                <li key={f.id} className={`s-${f.status}`}>
                  <span className="cm-dot"><Icon name={f.status} size={18} /></span>
                  <span><b className="cm-word">{t(f.status)}:</b> {f.text}</span>
                </li>
              ))}
            </ul>
          ) : <p className="cm-empty">{t('noFindings')}</p>}
        </section>

        <section className="cm-body" aria-label={t('twin')}>
          <div className="cm-twin">
            {webgl ? <CommunityTwin zones={result.zones} label={t('twin')} /> : <FlatFigure zones={result.zones} label={t('twin')} />}
          </div>
          <ul className="cm-zones" aria-label={t('zones')}>
            {ZONES.map((z) => (
              <li key={z} className={`s-${result.zones[z]}`}>
                <span className="cm-dot"><Icon name={result.zones[z]} size={18} /></span>
                <span className="cm-zone-name">{t(z)}</span>
                <span className="cm-word">{t(result.zones[z])}</span>
              </li>
            ))}
          </ul>
        </section>

        <dl className="cm-facts">
          <div>
            <dt>{t('who')}</dt>
            <dd><b>{visit.alias}</b><span>{t(visit.kind)}{age ? `, ${age}` : ''}</span></dd>
          </div>
          <div className={`s-${COLD_STATUS[visit.cold]}`}>
            <dt>{t('cold')}</dt>
            <dd>
              <b className="cm-state"><Icon name={COLD_STATUS[visit.cold]} size={20} />{t(visit.cold)}</b>
              <span className="cm-num">{Math.round(visit.altitude)} {t('altitude')}</span>
              {frostOn && <span className="cm-demo">{t('demo')}</span>}
            </dd>
          </div>
          <div>
            <dt>{t('post')}</dt>
            <dd><b className="cm-num">{num(visit.hoursToPost)}</b><span>{visit.hoursToPost === 1 ? t('hour') : t('hours')}</span></dd>
          </div>
        </dl>

        <div className="cm-buttons">
          <button className="cm-btn primary" onClick={() => setScene(2)}>{t('evaluate')}</button>
          <button className="cm-btn" onClick={() => setScene(3)}>{t('sheet')}</button>
          <button className="cm-btn" onClick={frost}>{t('frost')}</button>
        </div>
      </div>
      <p className="cm-note">{t('note')}</p>
    </div>
  )
}
