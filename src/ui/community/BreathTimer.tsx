import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useStore } from '../../store'
import { Pictogram } from './Pictogram'

const en = {
  start: 'Start counting',
  again: 'Count again',
  tap: 'Tap for each breath',
  space: 'You can also use the spacebar.',
  stop: 'Stop',
  seconds: 'seconds',
  left: 'Seconds remaining',
  how: 'Watch the chest. Count for a full minute.',
  done: 'Full minute complete. Total saved.',
  stopped: 'Stopped before one minute. Nothing was saved. Start again or enter the number manually.',
  value: 'Breaths per minute',
  none: 'Not counted',
  more: 'One more breath',
  less: 'One fewer breath',
  clear: 'Clear',
}
const qu = {}

const TOTAL_MS = 60_000
const R = 52
const LEN = 2 * Math.PI * R
type Phase = 'idle' | 'running' | 'done' | 'stopped'

/** Cronómetro de 60 s para contar respiraciones a mano. Al terminar guarda el total en la visita. */
export function BreathTimer() {
  const t = useT(en, qu)
  const breaths = useStore((s) => s.visit.breaths)
  const setVisit = useStore((s) => s.setVisit)
  const [phase, setPhase] = useState<Phase>('idle')
  const [leftMs, setLeftMs] = useState(TOTAL_MS)
  const [count, setCount] = useState(0)
  const countRef = useRef(0)
  const tapBtn = useRef<HTMLButtonElement>(null)
  const running = phase === 'running'

  const tap = () => { countRef.current++; setCount(countRef.current) }
  const start = () => { countRef.current = 0; setCount(0); setLeftMs(TOTAL_MS); setPhase('running') }
  const stop = () => setPhase('stopped')

  // Reloj: se calcula con la hora real, así no se atrasa si el dispositivo va lento
  useEffect(() => {
    if (!running) return
    const end = Date.now() + TOTAL_MS
    const id = setInterval(() => {
      const left = end - Date.now()
      if (left <= 0) {
        clearInterval(id)
        setLeftMs(0)
        setPhase('done')
        setVisit({ breaths: countRef.current })
      } else setLeftMs(left)
    }, 200)
    tapBtn.current?.focus({ preventScroll: true })
    return () => clearInterval(id)
  }, [running, setVisit])

  // Barra espaciadora: cuenta aunque el foco no esté en el botón grande
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = e.target as HTMLElement | null
      // En un botón o un campo, la tecla hace lo suyo (el botón grande ya cuenta solo)
      if (el?.closest('button, input, textarea, select, summary, a, [contenteditable="true"]')) return
      e.preventDefault()
      if (!e.repeat) tap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running])

  const fix = (n: number) => setVisit({ breaths: Math.max(0, Math.min(150, n)) })
  const secs = Math.ceil(leftMs / 1000)
  const gone = 1 - leftMs / TOTAL_MS

  return (
    <div className={`cm-breath is-${phase}`}>
      <div className="cm-breath-main">
        <div className="cm-ring" role="timer" aria-label={`${t('left')}: ${secs}`}>
          <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
            <circle className="cm-ring-track" cx="60" cy="60" r={R} />
            <circle className="cm-ring-bar" cx="60" cy="60" r={R} strokeDasharray={LEN} strokeDashoffset={LEN * (1 - gone)}
              transform="rotate(-90 60 60)" />
          </svg>
          <span className="cm-ring-num num">{secs}</span>
          <span className="cm-ring-unit">{t('seconds')}</span>
        </div>

        {running ? (
          <div className="cm-breath-run">
            <button type="button" ref={tapBtn} className="cm-tap" onClick={tap}>
              {/* La onda se vuelve a lanzar en cada toque */}
              {count > 0 && <i className="cm-tap-wave" key={count} aria-hidden="true" />}
              <span className="cm-tap-num num">{count}</span>
              <span className="cm-tap-text">{t('tap')}</span>
            </button>
            <button type="button" className="ev-btn cm-stop" onClick={stop}>
              <Pictogram name="stop" size={26} /><span>{t('stop')}</span>
            </button>
          </div>
        ) : (
          <div className="cm-breath-idle">
            <button type="button" className="ev-btn is-primary cm-start" onClick={start}>
              <Pictogram name="timer" size={34} /><span>{phase === 'idle' ? t('start') : t('again')}</span>
            </button>
            <p className="cm-breath-msg" role="status">
              {phase === 'done' ? t('done') : phase === 'stopped' ? t('stopped') : `${t('how')} ${t('space')}`}
            </p>
          </div>
        )}
      </div>

      <div className="cm-row cm-breath-value">
        <span className="cm-row-text">{t('value')}</span>
        <span className="cm-stepper">
          <button type="button" className="cm-pm" aria-label={t('less')} disabled={running || !breaths}
            onClick={() => fix((breaths ?? 0) - 1)}><Pictogram name="minus" size={26} /></button>
          <output className={`cm-step-val num ${breaths === null ? 'is-empty' : ''}`} aria-live="polite">
            {breaths === null ? t('none') : breaths}
          </output>
          <button type="button" className="cm-pm" aria-label={t('more')} disabled={running}
            onClick={() => fix((breaths ?? 0) + 1)}><Pictogram name="plus" size={26} /></button>
        </span>
        {breaths !== null && !running && (
          <button type="button" className="ev-btn is-quiet" onClick={() => setVisit({ breaths: null })}>{t('clear')}</button>
        )}
      </div>
    </div>
  )
}
