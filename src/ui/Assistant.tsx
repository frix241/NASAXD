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

/** System voices may load late in some browsers, so wait briefly. */
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
/** Record and transcribe with Whisper. Requires HTTPS or localhost. */
const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

let msgId = 0
const keep: { u: SpeechSynthesisUtterance | null } = { u: null } // evita que el navegador corte la voz a medias

/** Assistant: ask by voice (if supported) or text; responses are spoken and displayed. */
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

  const hush = () => { try { synth?.cancel() } catch { /* no-op */ } }
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
    if (!synth) { setNote('This browser does not support speech: I can only respond with text.'); setPhase('idle'); return }
    const voices = await loadVoices()
    try {
      synth.cancel()
      const u = new SpeechSynthesisUtterance(t)
      const v = voices.find((x) => x.lang.toLowerCase().startsWith('en')) ?? null
      if (v) { u.voice = v; u.lang = v.lang } else u.lang = 'en-US'
      u.rate = 1.02
      u.onstart = () => setPhase('speaking')
      u.onend = () => setPhase('idle')
      u.onerror = (e) => {
        setPhase('idle')
        if (e.error !== 'canceled' && e.error !== 'interrupted') setNote('I could not use this device’s voice: I can only respond with text.')
      }
      keep.u = u
      synth.speak(u)
      // Avoid leaving the UI in a speaking state if the voice never starts.
      timers.current.push(setTimeout(() => { if (!synth.speaking) setPhase((p) => (p === 'speaking' ? 'idle' : p)) }, 2500))
      if (!voices.length) setNote('No English voice is installed. If you cannot hear anything, the response is still available as text.')
    } catch { setPhase('idle') }
  }

  const ask = (q: string) => {
    const question = q.trim()
    if (!question) return
    stopAll(); setNote(''); setHeard(''); setText('')
    setMsgs((m) => [...m.slice(-7), { id: ++msgId, from: 'me', text: question }])
    setPhase('thinking')
    timers.current.push(setTimeout(async () => {
      const s = useStore.getState()
      const answer = await askAssistant(question, {
        scene: s.scene, sim: s.sim, readings: s.readings, issues: s.issues,
        tasksDone: s.tasksDone, points: s.points, streak: s.streak,
        profile: s.profile, tasks: PROFILES[s.profile].tasks, visit: s.visit, result: s.result,
      }, (reason) => {
        const messages = {
          'not-configured': 'Groq is not configured on this server. Using the built-in rules.',
          offline: 'No internet connection. Using the built-in rules.',
          unavailable: 'Groq could not answer. Check the server connection or API key. Using the built-in rules.',
        }
        setNote(messages[reason])
      })
      setMsgs((m) => [...m.slice(-7), { id: ++msgId, from: 'bot', text: answer }])
      setPhase('idle')
      void speak(answer)
    }, 650))
  }

  /** Without speech recognition, show "listening" and use a sample question. */
  const mockListen = (why: string) => {
    setNote(why)
    setPhase('listening')
    timers.current.push(setTimeout(() => { const s = useStore.getState(); ask(PROFILES[s.profile].assistant.samples[s.scene]) }, 1700))
  }

  /** Record for up to 8 seconds (or until tapped again) and transcribe with Whisper. */
  const recordAndTranscribe = async () => {
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch (e) {
      const name = (e as Error).name
      setPhase('idle')
      setNote(name === 'NotAllowedError' ? 'The microphone is blocked. Allow access in your browser (the icon beside the address bar) or type your question.'
        : name === 'NotFoundError' ? 'No microphone was found on this device. Type your question.'
          : 'I could not access the microphone. Type your question.')
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
        form.append('file', new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), 'voice.webm')
        form.append('model', 'whisper-large-v3-turbo'); form.append('language', 'en'); form.append('response_format', 'json')
        const res = await fetch('/api/groq-stt', { method: 'POST', body: form })
        const said = res.ok ? String((await res.json()).text ?? '').trim() : ''
        if (said.length > 1) { ask(said); return }
        setPhase('idle'); setNote(res.ok ? 'I did not understand. Tap the microphone and try again, or type your question.' : 'I could not transcribe your voice right now. Type your question.')
      } catch { setPhase('idle'); setNote('No connection for voice transcription. Type your question.') }
    }
    mr.start()
    setPhase('listening'); setHeard("I'm listening. Tap the microphone when you are finished.")
    timers.current.push(setTimeout(() => { if (mr.state !== 'inactive') mr.stop() }, 8000))
  }

  const listen = () => {
    stopAll(); setOpen(true); setNote(''); setHeard('')
    // Browsers require HTTPS or localhost for microphone access.
    if (!window.isSecureContext && !navigator.webdriver) {
      setNote('The browser only allows microphone access on a secure address (HTTPS) or localhost. Open the app’s HTTPS address, or type your question.')
      return
    }
    if (__ASSISTANT_LLM__ && canRecord() && navigator.onLine && !navigator.webdriver) { void recordAndTranscribe(); return }
    if (!Recognition) { mockListen('This browser does not support speech recognition. I used a sample question; you can also type your own.'); return }
    try {
      const r = new Recognition()
      rec.current = r
      r.lang = 'en-US'; r.interimResults = true; r.maxAlternatives = 1
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
        if (failed === 'not-allowed' || failed === 'service-not-allowed') setNote('The microphone is blocked. Allow access in your browser or type your question.')
        else if (failed === 'network') mockListen('This browser’s speech recognition requires an internet connection. I used a sample question; you can also type.')
        else setNote('I did not hear you. Tap the microphone to try again or type your question.')
      }
      r.start()
      setPhase('listening')
      timers.current.push(setTimeout(() => { try { r.stop() } catch { /* nada */ } }, 7000))
    } catch {
      mockListen('I could not access the microphone. I used a sample question; you can also type your own.')
    }
  }

  const onMic = () => {
    if (phase === 'listening') { try { rec.current?.stop() } catch { /* nada */ } if (!rec.current) { stopAll(); setPhase('idle') } return }
    if (phase === 'speaking' || phase === 'thinking') { stopAll(); setPhase('idle'); return }
    listen()
  }
  const close = () => { stopAll(); setPhase('idle'); setOpen(false) }
  const micLabel = phase === 'listening' ? 'Stop listening' : phase === 'speaking' ? 'Stop the assistant' : 'Talk to the assistant'

  return (
    <div className="assistant">
      {open && (
        <section className="chat" aria-label="Assistant">
          <header>
            <Avatar state={phase} variant={profile.id} size={52} />
            <h2>Assistant</h2>
            <button className="tool" aria-label={muted ? 'Enable voice' : 'Mute voice'} title={muted ? 'Enable voice' : 'Mute voice'} aria-pressed={muted}
              onClick={() => { if (!muted) hush(); setMuted(!muted) }}><Icon name={muted ? 'mute' : 'sound'} size={18} /></button>
            <button className="tool" aria-label="Close assistant" onClick={close}><Icon name="close" size={18} /></button>
          </header>
          <div className="msgs" ref={list} aria-live="polite">
            {msgs.length === 0 && phase === 'idle' && <p className="hint">Tap the microphone and speak, or type below.</p>}
            {msgs.map((m) => <p key={m.id} className={`msg ${m.from}`}>{m.text}</p>)}
            {phase === 'listening' && (
              <div className="msg me live">
                <span className="wave" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ animationDelay: `${(i * 137) % 900}ms` }} />)}</span>
                <span>{heard || 'Listening…'}</span>
              </div>
            )}
            {phase === 'thinking' && <div className="msg bot live"><span className="think" aria-hidden="true"><i /><i /><i /></span><span>Thinking…</span></div>}
          </div>
          {note && <p className="note" role="status">{note}</p>}
          <div className="chips">
            {(profile.assistant.suggestions[scene] ?? []).map((q) => <button key={q} onClick={() => ask(q)}>{q}</button>)}
          </div>
          <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your question" aria-label="Type your question" maxLength={140} />
            <button className="tool" type="submit" aria-label="Send question" disabled={!text.trim()}><Icon name="send" size={18} /></button>
          </form>
        </section>
      )}
      <div className="mic-row">
        <button className={`mic ${phase}`} aria-label={micLabel} title={micLabel} onClick={onMic}>
          {phase === 'speaking'
            ? <span className="wave small" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * 160}ms` }} />)}</span>
            : <Icon name="mic" size={26} />}
        </button>
        {!open && <button className="av-open" aria-label="Open assistant" title="Open assistant" onClick={() => setOpen(true)}><Avatar state={phase} variant={profile.id} size={54} /></button>}
        {!open && (
          <button className="keys" aria-label="Type to the assistant" title="Type to the assistant"
            onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 50) }}><Icon name="keys" size={18} /></button>
        )}
      </div>
    </div>
  )
}
