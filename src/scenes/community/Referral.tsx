import { useT } from '../../i18n'
import { radioScript, referral } from '../../sim/community'
import { useStore } from '../../store'
import { Icon } from '../../ui/Icon'
import { TopBar } from '../Monitor'
import '../../community-out.css'
import '../../community-shared.css'

const es = {
  title: 'Hoja de derivación',
  noNeed: 'Ahora no hace falta derivar. La hoja queda lista por si cambia algo.',
  data: 'Datos para la posta',
  way: 'En el camino',
  radio: 'Para dictar por radio o teléfono',
  radioHint: 'Lee las líneas en orden, despacio.',
  print: 'Imprimir hoja',
  back: 'Volver a evaluar',
  demo: 'Datos de demostración',
  note: 'Apoyo a la decisión con reglas basadas en protocolos MINSA. No reemplaza a la posta de salud.',
  received: 'Recibido en la posta por',
  time: 'Hora',
  agent: 'Agente comunitario',
  foot: 'Apoyo a la decisión con reglas basadas en protocolos MINSA. No es un diagnóstico. Valores de ejemplo, validar con normas MINSA (AIEPI).',
}

function useSheet() {
  const visit = useStore((s) => s.visit)
  const result = useStore((s) => s.result)
  return {
    result,
    sheet: referral(visit, result),
    radio: radioScript(visit, result).filter((l) => l.trim() !== ''),
  }
}

/** Hoja de derivación en pantalla, con la versión para dictar por radio. */
export default function Referral() {
  const t = useT(es, {})
  const { result, sheet, radio } = useSheet()
  const frostOn = useStore((s) => s.frostOn)
  const setScene = useStore((s) => s.setScene)
  const print = () => {
    useStore.getState().set({ printing: 'derivacion' })
    // Se espera a que la hoja esté lista antes de abrir el diálogo de impresión
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print()
      useStore.getState().set({ printing: null })
    }))
  }
  return (
    <div className="cm-out cm-referral">
      <TopBar />
      <header className="cm-head">
        <h1>{t('title')}</h1>
        {frostOn && <span className="cm-demo">{t('demo')}</span>}
      </header>

      {result.status !== 'bad' && (
        <p className={`cm-notice s-${result.status}`} role="status">
          <span className="cm-dot"><Icon name={result.status} size={18} /></span>
          <span>{t('noNeed')}</span>
        </p>
      )}

      <div className="cm-ref-grid">
        <article className={`cm-paper s-${result.status}`} aria-label={sheet.title}>
          <h2>{t('data')}</h2>
          <dl className="cm-rows">
            {sheet.rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {sheet.onTheWay.length > 0 && (
            <>
              <h2>{t('way')}</h2>
              <ul className="cm-way">{sheet.onTheWay.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </>
          )}
        </article>

        <section className="cm-radio" aria-label={t('radio')}>
          <h2>{t('radio')}</h2>
          <p className="cm-hint">{t('radioHint')}</p>
          <ol>
            {radio.map((l, i) => <li key={i}><span className="cm-n" aria-hidden="true">{i + 1}</span><span>{l}</span></li>)}
          </ol>
        </section>
      </div>

      <div className="cm-buttons">
        <button className="cm-btn primary" onClick={print}>{t('print')}</button>
        <button className="cm-btn" onClick={() => setScene(2)}>{t('back')}</button>
      </div>
      <p className="cm-note">{t('note')}</p>
    </div>
  )
}

/** La misma hoja, lista para imprimir en una hoja A4 en blanco y negro. En pantalla no se ve. */
export function ReferralPrint() {
  const t = useT(es, {})
  const { sheet, radio } = useSheet()
  const printing = useStore((s) => s.printing)
  const frostOn = useStore((s) => s.frostOn)
  return (
    <div className="print-only cm-print" data-sheet={printing === 'derivacion' ? 'derivacion' : 'none'} aria-hidden="true">
      <article className="sheet derivacion">
        <h1>{sheet.title}</h1>
        <dl className="cm-p-rows">
          {sheet.rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {sheet.onTheWay.length > 0 && (
          <>
            <h2>{t('way')}</h2>
            <ul>{sheet.onTheWay.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </>
        )}
        <h2>{t('radio')}</h2>
        <ol className="cm-p-radio">{radio.map((l, i) => <li key={i}>{l}</li>)}</ol>
        <p className="cm-p-sign">
          <span>{t('agent')}: ______________________</span>
          <span>{t('received')}: ______________________</span>
          <span>{t('time')}: __________</span>
        </p>
        <p className="foot">{frostOn && <b>{t('demo')}. </b>}{t('foot')}</p>
      </article>
    </div>
  )
}
