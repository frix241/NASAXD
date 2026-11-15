import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { Pictogram } from './Pictogram'

const en = {
  read: 'Read aloud',
  stop: 'Stop speaking',
  noVoice: 'This device has no speech voice',
}
const qu = {}

function hasVoice(): boolean {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && !!window.speechSynthesis
      && typeof window.SpeechSynthesisUtterance === 'function'
  } catch {
    return false
  }
}

/** Uses an English voice when available. */
function englishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
  if (!voices.length) return null
  const lang = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-')
  return voices.find((v) => lang(v) === 'en-us')
    ?? voices.find((v) => ['en-gb', 'en-au', 'en-ca', 'en-in'].includes(lang(v)))
    ?? voices[0]
}

/** Botón que lee un texto en voz alta. El segundo toque lo calla. Nunca rompe la pantalla si no hay voz. */
export function ReadAloud({ text, className = '' }: { text: string; className?: string }) {
  const t = useT(en, qu)
  const [ok, setOk] = useState(hasVoice)
  const [speaking, setSpeaking] = useState(false)
  /** Identifica la lectura en curso: los avisos de lecturas viejas se ignoran */
  const turn = useRef(0)

  const silence = () => {
    turn.current++
    setSpeaking(false)
    try { window.speechSynthesis.cancel() } catch { /* sin voz: nada que callar */ }
  }

  // Al salir de la pantalla, o si cambia el texto, se calla
  useEffect(() => () => { if (hasVoice()) { turn.current++; try { window.speechSynthesis.cancel() } catch { /* nada */ } } }, [])
  useEffect(() => { if (hasVoice()) silence() }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    if (!ok) return
    if (speaking) { silence(); return }
    try {
      const synth = window.speechSynthesis
      synth.cancel()
      const u = new window.SpeechSynthesisUtterance(text)
      const voice = englishVoice()
      if (voice) u.voice = voice
      u.lang = voice?.lang ?? 'en-US'
      u.rate = 0.9
      const mine = ++turn.current
      u.onend = () => { if (turn.current === mine) setSpeaking(false) }
      u.onerror = (e) => {
        if (turn.current !== mine) return
        setSpeaking(false)
        // "canceled" e "interrupted" son un callar normal; lo demás es que no se puede hablar
        if (e.error !== 'canceled' && e.error !== 'interrupted') setOk(false)
      }
      synth.speak(u)
      setSpeaking(true)
    } catch {
      setSpeaking(false)
      setOk(false)
    }
  }

  return (
    <button type="button" className={`ev-btn cm-read ${speaking ? 'is-on' : ''} ${className}`} onClick={toggle} disabled={!ok}
      aria-pressed={ok ? speaking : undefined} title={ok ? undefined : t('noVoice')}>
      <Pictogram name={speaking ? 'stop' : 'speaker'} size={30} />
      <span>{speaking ? t('stop') : t('read')}</span>
      {!ok && <span className="cm-read-off">{t('noVoice')}</span>}
    </button>
  )
}
