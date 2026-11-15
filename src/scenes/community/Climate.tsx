import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { frostSeries } from '../../sim/community'
import { useStore } from '../../store'
import { Chart, nf } from '../../ui/charts'
import { Icon } from '../../ui/Icon'
import { TopBar } from '../Monitor'
import '../../community-out.css'
import '../../community-shared.css'

const es = {
  title: 'Clima y riesgo',
  sub: 'Las próximas 48 horas afuera.',
  demo: 'Datos de demostración',
  empty: 'Sin datos de clima todavía',
  emptyHint: 'Cuando haya datos, aquí verás el frío de las próximas 48 horas.',
  temp: 'Temperatura afuera',
  tempUnit: 'en grados (°C)',
  risk: 'Riesgo por frío',
  riskUnit: 'de 0 a 100',
  frostLine: '0 °C: helada',
  riskWord: 'Riesgo',
  of100: 'de 100',
  of: 'de',
  coldest: 'Lo más frío',
  below: 'Horas bajo cero',
  top: 'Riesgo más alto',
  keys: 'Toca el gráfico o usa las flechas para ver cada hora.',
  meaning: 'Qué significa para',
  frostYes: 'Viene helada',
  frostNo: 'Sin helada',
  s1Frost: 'Se espera helada: la temperatura baja hasta',
  s1Calm: 'No se espera helada en las próximas 48 horas. Lo más frío será',
  s2Fragile: 'siente más el frío por su edad: abrígale en capas y vuelve a revisar al amanecer.',
  s2AdultA: 'Abriga bien a',
  s2AdultB: 'dale bebidas tibias y vuelve a revisar al amanecer.',
  s2CalmA: 'Mantén a',
  s2CalmB: 'con abrigo seco durante la noche.',
  frost: 'Simular helada',
  note: 'Apoyo a la decisión con reglas basadas en protocolos MINSA. No reemplaza a la posta de salud.',
}

const deg = (v: number) => `${nf(v, 0).replace('-', '−')} °C`
const M = { l: 52, r: 14, t: 14, b: 12 }

/** Un gráfico de una sola serie y un solo eje. El cursor se comparte con el otro gráfico. */
function Plot({ values, labels, min, max, ticks, fmt, refLine, area, mark, xLabels, hover, onHover, tip }: {
  values: number[]; labels: string[]; min: number; max: number; ticks: number[]; fmt: (v: number) => string
  refLine?: { v: number; label: string }; area?: boolean; mark?: number; xLabels?: boolean
  hover: number; onHover: (i: number) => void; tip: (i: number) => ReactNode
}) {
  const n = values.length
  return (
    <Chart>
      {({ w, h, tip: show }) => {
        const mb = xLabels ? 34 : M.b
        const iw = w - M.l - M.r; const ih = h - M.t - mb; const base = M.t + ih
        const x = (i: number) => M.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1))
        const y = (v: number) => M.t + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * ih
        const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
        const move = (e: PointerEvent<SVGRectElement>) => {
          const box = e.currentTarget.getBoundingClientRect()
          const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / Math.max(1, iw)) * (n - 1))))
          onHover(i)
          show({ x: x(i), y: y(values[i]), node: tip(i) })
        }
        const count = Math.max(2, Math.min(5, Math.floor(iw / 150) + 1))
        const idx = Array.from({ length: count }, (_, k) => Math.round((k * (n - 1)) / (count - 1)))
        const halo = { paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 5, strokeLinejoin: 'round' } as const
        return (
          <g>
            {ticks.map((tk) => (
              <g key={tk}>
                <line x1={M.l} x2={w - M.r} y1={y(tk)} y2={y(tk)} stroke="var(--line-soft)" />
                <text x={M.l - 8} y={y(tk) + 6} textAnchor="end">{fmt(tk)}</text>
              </g>
            ))}
            {refLine && refLine.v > min && (
              <rect x={M.l} y={y(refLine.v)} width={iw} height={base - y(refLine.v)} fill="var(--ice)" opacity="0.14" />
            )}
            {area && <path d={`${line}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`} fill="var(--ice)" opacity="0.22" />}
            {refLine && (
              <g>
                <line x1={M.l} x2={w - M.r} y1={y(refLine.v)} y2={y(refLine.v)} stroke="var(--border)" strokeWidth="2" strokeDasharray="7 6" />
                <text className="lab" x={w - M.r - 4} y={y(refLine.v) - 8} textAnchor="end" style={halo}>{refLine.label}</text>
              </g>
            )}
            {hover >= 0 && hover < n && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={base} stroke="var(--muted)" strokeWidth="1.5" />}
            <path d={line} fill="none" stroke="var(--ice)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            {mark !== undefined && hover < 0 && (
              <g>
                <circle cx={x(mark)} cy={y(values[mark])} r="6" fill="var(--ice)" stroke="var(--bg)" strokeWidth="2" />
                <text className="lab" x={Math.max(M.l + 4, Math.min(w - M.r - 4, x(mark)))} style={halo}
                  y={y(values[mark]) + 28 < base ? y(values[mark]) + 28 : y(values[mark]) - 14}
                  textAnchor={x(mark) > w - 90 ? 'end' : x(mark) < M.l + 60 ? 'start' : 'middle'}>{fmt(values[mark])}</text>
              </g>
            )}
            {hover >= 0 && hover < n && <circle cx={x(hover)} cy={y(values[hover])} r="6.5" fill="var(--ice)" stroke="var(--bg)" strokeWidth="2" />}
            {xLabels && idx.map((i, k) => (
              <text key={i} x={x(i)} y={h - 6} textAnchor={k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle'}>{labels[i]}</text>
            ))}
            <rect x={M.l} y={M.t} width={Math.max(0, iw)} height={Math.max(0, ih)} fill="transparent"
              onPointerMove={move} onPointerDown={move} onPointerLeave={() => onHover(-1)} />
          </g>
        )
      }}
    </Chart>
  )
}

/** Clima de las próximas 48 horas y qué significa para la persona atendida. */
export default function Climate() {
  const t = useT(es, {})
  const visit = useStore((s) => s.visit)
  const frostOn = useStore((s) => s.frostOn)
  const frost = useStore((s) => s.frost)
  const [hover, setHover] = useState(-1)

  const fs = frostSeries(visit.region, frostOn)
  const n = Math.min(fs.hours.length, fs.temp.length)
  const hours = fs.hours.slice(0, n); const temp = fs.temp.slice(0, n)
  const risk = fs.risk.length >= n ? fs.risk.slice(0, n) : null

  const head = (
    <header className="cm-head">
      <h1>{t('title')}</h1>
      <p>{t('sub')}</p>
      {frostOn && <span className="cm-demo">{t('demo')}</span>}
    </header>
  )
  const frostBtn = (
    <div className="cm-buttons">
      <button className="cm-btn primary" onClick={frost}>{t('frost')}</button>
    </div>
  )

  if (n === 0) {
    return (
      <div className="cm-out cm-climate">
        <TopBar />
        {head}
        <div className="cm-nodata"><h2>{t('empty')}</h2><p>{t('emptyHint')}</p></div>
        {frostBtn}
        <p className="cm-note">{t('note')}</p>
      </div>
    )
  }

  const coldest = temp.indexOf(Math.min(...temp))
  const tMin = temp[coldest]; const tMax = Math.max(...temp)
  const below = temp.filter((v) => v <= 0).length
  const lo = Math.floor((Math.min(tMin, 0) - 4) / 5) * 5
  const hi = Math.max(lo + 10, Math.ceil((Math.max(tMax, 0) + 1) / 5) * 5)
  const stepT = hi - lo > 30 ? 10 : 5
  const ticksT: number[] = []
  for (let v = lo; v <= hi; v += stepT) ticksT.push(v)
  const riskTop = risk ? risk.indexOf(Math.max(...risk)) : -1
  const frostComing = below > 0
  const fragile = visit.kind !== 'adult'
  const at = hover >= 0 && hover < n ? hover : coldest

  const tip = (i: number) => (
    <>
      <div className="cm-tip-h">{hours[i]}</div>
      <div><b>{deg(temp[i])}</b></div>
      {risk && <div>{t('riskWord')} <b>{Math.round(risk[i])}</b></div>}
    </>
  )
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const from = hover < 0 ? coldest : hover
    setHover(Math.max(0, Math.min(n - 1, from + (e.key === 'ArrowLeft' ? -1 : 1))))
  }

  return (
    <div className="cm-out cm-climate">
      <TopBar />
      {head}
      <div className="cm-climate-grid">
        <section className="cm-charts" tabIndex={0} onKeyDown={keys} onBlur={() => setHover(-1)} aria-label={`${t('temp')}. ${t('keys')}`}>
          <figure className="cm-fig">
            <figcaption><b>{t('temp')}</b> <span>{t('tempUnit')}</span></figcaption>
            <div className="cm-plot tall">
              <Plot values={temp} labels={hours} min={lo} max={hi} ticks={ticksT} fmt={(v) => nf(v, 0).replace('-', '−')}
                refLine={{ v: 0, label: t('frostLine') }} mark={coldest} xLabels={!risk} hover={hover} onHover={setHover} tip={tip} />
            </div>
          </figure>
          {risk && (
            <figure className="cm-fig">
              <figcaption><b>{t('risk')}</b> <span>{t('riskUnit')}</span></figcaption>
              <div className="cm-plot short">
                <Plot values={risk} labels={hours} min={0} max={100} ticks={[0, 50, 100]} fmt={(v) => String(Math.round(v))}
                  area xLabels hover={hover} onHover={setHover} tip={tip} />
              </div>
            </figure>
          )}
          <p className="cm-readout" aria-live="polite">
            <span className="cm-readout-h">{hours[at]}</span>
            <b className="cm-num">{deg(temp[at])}</b>
            {risk && <span className="cm-num">{t('riskWord')} {Math.round(risk[at])} {t('of100')}</span>}
          </p>
          <p className="cm-hint">{t('keys')}</p>
        </section>

        <aside className="cm-side">
          <section className={`cm-meaning s-${frostComing ? 'warn' : 'ok'}`}>
            <p className="cm-state big"><span className="cm-dot"><Icon name={frostComing ? 'warn' : 'ok'} size={20} /></span>{frostComing ? t('frostYes') : t('frostNo')}</p>
            <h2>{t('meaning')} {visit.alias}</h2>
            <p>
              {frostComing ? t('s1Frost') : t('s1Calm')} {deg(tMin)} ({hours[coldest]}).{' '}
              {!frostComing ? `${t('s2CalmA')} ${visit.alias} ${t('s2CalmB')}`
                : fragile ? `${visit.alias} ${t('s2Fragile')}`
                  : `${t('s2AdultA')} ${visit.alias}, ${t('s2AdultB')}`}
            </p>
          </section>
          <dl className="cm-stats">
            <div><dt>{t('coldest')}</dt><dd><b className="cm-num">{deg(tMin)}</b><span>{hours[coldest]}</span></dd></div>
            <div><dt>{t('below')}</dt><dd><b className="cm-num">{below}</b><span>{t('of')} {n}</span></dd></div>
            {risk && <div><dt>{t('top')}</dt><dd><b className="cm-num">{Math.round(risk[riskTop])}</b><span>{t('of100')}, {hours[riskTop]}</span></dd></div>}
          </dl>
          {frostBtn}
        </aside>
      </div>
      <p className="cm-note">{t('note')}</p>
    </div>
  )
}
