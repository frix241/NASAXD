import { useEffect, useRef, useState } from 'react'
import { askAssistant } from '../assistant/askAssistant'
import { PROFILES } from '../profiles'
import { useProfile, useStore } from '../store'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'
interface Msg { id: number; from: 'me' | 'bot'; text: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
const Recognition: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : null
const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

/** Las voces del sistema llegan tarde en algunos navegadores: se espera un momento. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!synth) return resolve([])
    const now = synth.getVoices()
    if (now.length) return resolve(now)
    const done = () => { synth.removeEventListener('voiceschanged', done); resolve(synth.getVoices()) }
    synth.addEventListener('voiceschanged', done)
    setTimeout(done, 1200)
  })
}

declare const __ASSISTANT_LLM__: boolean
/** Grabar y transcribir con Whisper: funciona en cualquier navegador moderno, pero pide https o localhost */
const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

let msgId = 0
const keep: { u: SpeechSynthesisUtterance | null } = { u: null } // evita que el navegador corte la voz a medias

/** Asistente: se le habla (si el navegador reconoce voz) o se le escribe. Responde con texto y voz. */
export function Assistant() {
  const scene = useStore((s) => s.scene)
  const profile = useProfile()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [heard, setHeard] = useState('')
  const [text, setText] = useState('')
  const [muted, setMuted] = useState(false)
  const [note, setNote] = useState('')
  const mutedRef = useRef(muted); mutedRef.current = muted
  const rec = useRef<any>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const hush = () => { try { synth?.cancel() } catch { /* nada */ } }
  const stopAll = () => {
    timers.current.forEach(clearTimeout); timers.current = []
    try { rec.current?.abort() } catch { /* nada */ }
    rec.current = null
    hush()
  }
  useEffect(() => stopAll, [])
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [msgs, phase, heard])

  const speak = async (t: string) => {
    if (mutedRef.current) { setPhase('idle'); return }
    if (!synth) { setNote('Este navegador no tiene voz: respondo solo con texto.'); setPhase('idle'); return }
    const voices = await loadVoices()
    try {
      synth.cancel()
      const u = new SpeechSynthesisUtterance(t)
      const v = voices.find((x) => x.lang.toLowerCase().startsWith('es')) ?? null
      if (v) { u.voice = v; u.lang = v.lang } else u.lang = 'es-ES'
      u.rate = 1.02
      u.onstart = () => setPhase('speaking')
      u.onend = () => setPhase('idle')
      u.onerror = (e) => {
        setPhase('idle')
        if (e.error !== 'canceled' && e.error !== 'interrupted') setNote('No pude usar la voz de este equipo: respondo solo con texto.')
      }
      keep.u = u
      synth.speak(u)
      // Si la voz nunca arranca (equipo sin voces), no dejar el estado colgado
      timers.current.push(setTimeout(() => { if (!synth.speaking) setPhase((p) => (p === 'speaking' ? 'idle' : p)) }, 2500))
      if (!voices.length) setNote('No encontré una voz en español instalada. Si no oyes nada, la respuesta queda en texto.')
    } catch { setPhase('idle') }
  }

  const ask = (q: string) => {
    const question = q.trim()
    if (!question) return
    stopAll(); setHeard(''); setText('')
    setMsgs((m) => [...m.slice(-7), { id: ++msgId, from: 'me', text: question }])
    setPhase('thinking')
    timers.current.push(setTimeout(async () => {
      const s = useStore.getState()
      const answer = await askAssistant(question, {
        scene: s.scene, sim: s.sim, readings: s.readings, issues: s.issues,
        tasksDone: s.tasksDone, points: s.points, streak: s.streak,
        profile: s.profile, tasks: PROFILES[s.profile].tasks, visit: s.visit, result: s.result,
      })
      setMsgs((m) => [...m.slice(-7), { id: ++msgId, from: 'bot', text: answer }])
      setPhase('idle')
      void speak(answer)
    }, 650))
  }

  /** Sin reconocimiento de voz: se muestra "escuchando" y se usa una pregunta de ejemplo. */
  const mockListen = (why: string) => {
    setNote(why)
    setPhase('listening')
    timers.current.push(setTimeout(() => { const s = useStore.getState(); ask(PROFILES[s.profile].assistant.samples[s.scene]) }, 1700))
  }

  /** Graba hasta 8 s (o hasta que se toque otra vez) y lo convierte en texto con Whisper. */
  const recordAndTranscribe = async () => {
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch (e) {
      const name = (e as Error).name
      setPhase('idle')
      setNote(name === 'NotAllowedError' ? 'El micrófono está bloqueado. Dale permiso en el navegador (icono junto a la dirección) o escribe tu pregunta.'
        : name === 'NotFoundError' ? 'No encontré ningún micrófono en este equipo. Escribe tu pregunta.'
          : 'No pude abrir el micrófono. Escribe tu pregunta.')
      return
    }
    const chunks: Blob[] = []
    const mr = new MediaRecorder(stream)
    let aborted = false
    rec.current = { stop: () => { if (mr.state !== 'inactive') mr.stop() }, abort: () => { aborted = true; if (mr.state !== 'inactive') mr.stop() } }
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      rec.current = null
      if (aborted) return
      setPhase('thinking'); setHeard('')
      try {
        const form = new FormData()
        form.append('file', new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), 'voz.webm')
        form.append('model', 'whisper-large-v3-turbo'); form.append('language', 'es'); form.append('response_format', 'json')
        const res = await fetch('/api/groq-stt', { method: 'POST', body: form })
        const said = res.ok ? String((await res.json()).text ?? '').trim() : ''
        if (said.length > 1) { ask(said); return }
        setPhase('idle'); setNote(res.ok ? 'No te entendí. Toca el micrófono e inténtalo otra vez, o escribe tu pregunta.' : 'No pude convertir la voz en texto ahora. Escribe tu pregunta.')
      } catch { setPhase('idle'); setNote('Sin conexión para convertir la voz en texto. Escribe tu pregunta.') }
    }
    mr.start()
    setPhase('listening'); setHeard('Te escucho. Toca el micrófono cuando termines.')
    timers.current.push(setTimeout(() => { if (mr.state !== 'inactive') mr.stop() }, 8000))
  }

  const listen = () => {
    stopAll(); setOpen(true); setNote(''); setHeard('')
    // Fuera de https o localhost, el navegador no deja usar el micrófono
    if (!window.isSecureContext && !navigator.webdriver) {
      setNote('El navegador solo permite el micrófono en una dirección segura (https) o en localhost. Abre la dirección https de la app, o escribe tu pregunta.')
      return
    }
    if (__ASSISTANT_LLM__ && canRecord() && navigator.onLine && !navigator.webdriver) { void recordAndTranscribe(); return }
    if (!Recognition) { mockListen('Este navegador no reconoce voz. Usé una pregunta de ejemplo; también puedes escribir la tuya.'); return }
    try {
      const r = new Recognition()
      rec.current = r
      r.lang = 'es-ES'; r.interimResults = true; r.maxAlternatives = 1
      let final = ''; let failed = ''
      r.onresult = (e: any) => {
        let all = ''
        for (let i = 0; i < e.results.length; i++) { all += e.results[i][0].transcript; if (e.results[i].isFinal) final = all }
        setHeard(all)
      }
      r.onerror = (e: any) => { failed = e.error }
      r.onend = () => {
        if (rec.current !== r) return
        rec.current = null
        if (final.trim()) { ask(final); return }
        setPhase('idle')
        if (failed === 'not-allowed' || failed === 'service-not-allowed') setNote('El micrófono está bloqueado. Dale permiso en el navegador o escribe tu pregunta.')
        else if (failed === 'network') mockListen('El reconocimiento de voz de este navegador necesita internet. Usé una pregunta de ejemplo; también puedes escribir.')
        else setNote('No te oí. Toca el micrófono para intentar otra vez o escribe tu pregunta.')
      }
      r.start()
      setPhase('listening')
      timers.current.push(setTimeout(() => { try { r.stop() } catch { /* nada */ } }, 7000))
    } catch {
      mockListen('No pude abrir el micrófono. Usé una pregunta de ejemplo; también puedes escribir la tuya.')
    }
  }

  const onMic = () => {
    if (phase === 'listening') { try { rec.current?.stop() } catch { /* nada */ } if (!rec.current) { stopAll(); setPhase('idle') } return }
    if (phase === 'speaking' || phase === 'thinking') { stopAll(); setPhase('idle'); return }
    listen()
  }
  const close = () => { stopAll(); setPhase('idle'); setOpen(false) }
  const micLabel = phase === 'listening' ? 'Dejar de escuchar' : phase === 'speaking' ? 'Callar al asistente' : 'Hablar con el asistente'

  return (
    <div className="assistant">
      {open && (
        <section className="chat" aria-label="Asistente">
          <header>
            <Avatar state={phase} variant={profile.id} size={52} />
            <h2>Asistente</h2>
            <button className="tool" aria-label={muted ? 'Activar voz' : 'Silenciar voz'} title={muted ? 'Activar voz' : 'Silenciar voz'} aria-pressed={muted}
              onClick={() => { if (!muted) hush(); setMuted(!muted) }}><Icon name={muted ? 'mute' : 'sound'} size={18} /></button>
            <button className="tool" aria-label="Cerrar asistente" onClick={close}><Icon name="close" size={18} /></button>
          </header>
          <div className="msgs" ref={list} aria-live="polite">
            {msgs.length === 0 && phase === 'idle' && <p className="hint">Toca el micrófono y habla, o escribe abajo.</p>}
            {msgs.map((m) => <p key={m.id} className={`msg ${m.from}`}>{m.text}</p>)}
            {phase === 'listening' && (
              <div className="msg me live">
                <span className="wave" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ animationDelay: `${(i * 137) % 900}ms` }} />)}</span>
                <span>{heard || 'Escuchando…'}</span>
              </div>
            )}
            {phase === 'thinking' && <div className="msg bot live"><span className="think" aria-hidden="true"><i /><i /><i /></span><span>Pensando…</span></div>}
          </div>
          {note && <p className="note" role="status">{note}</p>}
          <div className="chips">
            {(profile.assistant.suggestions[scene] ?? []).map((q) => <button key={q} onClick={() => ask(q)}>{q}</button>)}
          </div>
          <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu pregunta" aria-label="Escribe tu pregunta" maxLength={140} />
            <button className="tool" type="submit" aria-label="Enviar pregunta" disabled={!text.trim()}><Icon name="send" size={18} /></button>
          </form>
        </section>
      )}
      <div className="mic-row">
        <button className={`mic ${phase}`} aria-label={micLabel} title={micLabel} onClick={onMic}>
          {phase === 'speaking'
            ? <span className="wave small" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * 160}ms` }} />)}</span>
            : <Icon name="mic" size={26} />}
        </button>
        {!open && <button className="av-open" aria-label="Abrir el asistente" title="Abrir el asistente" onClick={() => setOpen(true)}><Avatar state={phase} variant={profile.id} size={54} /></button>}
        {!open && (
          <button className="keys" aria-label="Escribir al asistente" title="Escribir al asistente"
            onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 50) }}><Icon name="keys" size={18} /></button>
        )}
      </div>
    </div>
  )
}
