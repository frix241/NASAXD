/**
 * Asistente de AstroTwin.
 *
 * The local rules always provide an answer; Groq optionally rephrases it through the Vite server.
 */
import type { Task, TaskId } from '../config/tasks'
import { radioScript, type Result, type Visit } from '../sim/community'
import type { Issue } from '../sim/issues'
import type { MetricKey, Reading, SimState } from '../sim/simulator'

export interface AssistantContext {
  scene: number // 0 Arranque, 1 Monitor, 2 Datos, 3 Ruta
  sim: SimState
  readings: Record<MetricKey, Reading>
  issues: Issue[]
  tasksDone: Partial<Record<TaskId, boolean>>
  points: number
  streak: number
  profile: 'space' | 'community'
  tasks: Task[]
  visit: Visit
  result: Result
}

const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
const n1 = (v: number) => v.toFixed(1)
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function health(c: AssistantContext): string {
  const { issues, readings: r } = c
  if (!issues.length) {
    return `All clear. Heart rate ${r.pulse.text}, blood pressure ${r.bp.text}, and oxygen ${r.spo2.text}%. Continue with your plan for the day.`
  }
  const first = issues[0]
  const head = issues.length === 1 ? 'There is 1 item to watch.' : `There are ${issues.length} items to watch.`
  const rest = issues.slice(1).map((i) => i.title.toLowerCase())
  const also = rest.length ? ` Also: ${rest.join(', ')}.` : ''
  const earth = first.level === 'bad' && first.action !== 'earth' ? ' Notify Earth if it does not improve.' : ''
  return `${head} ${first.title}. ${first.why} Next step: ${first.actionLabel.toLowerCase()}.${also}${earth}`
}

function data(c: AssistantContext): string {
  const h = c.sim.history
  return `Over the last 14 days, you slept an average of ${n1(avg(h.sleep))} hours per night. You have completed ${c.readings.exercise.text}% of your weekly exercise goal and accumulated ${n1(c.sim.radTotal)} millisieverts of radiation. ${c.issues.length ? health(c) : 'I do not see anything unusual.'}`
}

function next(c: AssistantContext): string {
  const urgent = c.issues.find((i) => i.level === 'bad')
  if (urgent) return `First: ${urgent.actionLabel.toLowerCase()}. ${urgent.why}`
  const left = c.tasks.filter((t) => !c.tasksDone[t.id])
  if (!left.length) return `You have completed today's plan. You have ${c.points} points and a ${c.streak}-day streak.`
  return `${left.length === 1 ? 'You have 1 task left' : `You have ${left.length} tasks left`}. Next, ${left[0].title.toLowerCase()}: it takes ${left[0].minutes} minutes and cares for ${left[0].cares.toLowerCase()}.`
}

function rules(text: string, c: AssistantContext): string {
  const q = plain(text)
  const r = c.readings
  if (/water|hydr|thirst|drink/.test(q)) return `Your hydration is at ${r.hydration.text}%. ${r.hydration.status === 'ok' ? 'You are doing well.' : 'Drink a pouch of water now.'}`
  if (/sleep|rest|tired/.test(q)) return `You slept ${r.sleep.text} hours last night. ${r.sleep.status === 'ok' ? 'That is enough.' : 'A short nap today may help.'}`
  if (/radiat|storm|shelter/.test(q)) return c.sim.storm
    ? (c.sim.sheltered ? 'There is a solar storm, but you are in the shelter. Stay there until it passes.' : 'There is a solar storm. Go to the shelter now.')
    : `Radiation is normal. You have accumulated ${n1(c.sim.radTotal)} millisieverts during the mission.`
  if (/pressure|heart|pulse|beat/.test(q)) return `Your blood pressure is ${r.bp.text} and your heart rate is ${r.pulse.text}. ${r.bp.status === 'ok' && r.pulse.status === 'ok' ? 'Everything is normal.' : 'Rest and drink water.'}`
  if (/temperature|fever|hot|cold/.test(q)) return `Your temperature is ${r.temp.text} degrees. ${r.temp.status === 'ok' ? 'That is normal.' : 'Rest, drink water, and notify Earth if it continues.'}`
  if (/oxygen|breath|air/.test(q)) return `Your oxygen is ${r.spo2.text}% and you are breathing ${r.resp.text} times per minute. ${r.spo2.status === 'ok' ? 'Everything is normal.' : 'Breathe slowly and deeply.'}`
  if (/exercise|muscle|bone|strength/.test(q)) return `You have completed ${r.exercise.text}% of your weekly exercise goal. ${r.exercise.status === 'ok' ? 'This helps protect your muscles and bones.' : 'Do your resistance exercise today: without it, you lose muscle and bone.'}`
  if (/mood|sad|stress|feel/.test(q)) return `Your mood is ${r.mood.text} out of 100. ${r.mood.status === 'ok' ? 'You are doing well.' : 'Resting or talking with someone may help. Complete your mood check-in.'}`
  if (/point|streak|level/.test(q)) return `You have ${c.points} points, are at level ${Math.floor(c.points / 100) + 1}, and have a ${c.streak}-day streak.`
  if (/next|task|plan|do|now/.test(q)) return next(c)
  if (/data|history|week|summary/.test(q)) return data(c)
  if (/how am i|health|status|happening|everything okay|hello|hi/.test(q)) return c.scene === 0 ? 'I am starting your sensors. Your monitor will appear in a few seconds.' : health(c)
  return 'I can tell you about your heart rate, blood pressure, hydration, sleep, radiation, exercise, mood, and daily tasks. Ask me about one of those.'
}

/**
 * Perfil comunidad: el mismo sistema de reglas explicables. Habla con la agente comunitaria,
 * en frases cortas. Es apoyo a la decisión con reglas basadas en protocolos MINSA, nunca un diagnóstico.
 */
function rulesCommunity(text: string, c: AssistantContext): string {
  const q = plain(text)
  const r = c.result; const v = c.visit
  const what = `${r.label}. ${r.reason} First: ${r.actions[0]} Then: ${r.actions[1]}`
  if (c.scene === 0) return 'I am loading the rules on this device. No internet is needed.'
  if (/radio|phone|dictat|call/.test(q)) return radioScript(v, r).filter(Boolean).join(' ')
  if (/way|travel|transport|carry/.test(q)) return r.onTheWay.length ? `On the way: ${r.onTheWay.join(' ')}` : 'Referral is not needed right now. If a warning sign appears, the referral form explains what to do on the way.'
  if (/confiden|sure|data|missing/.test(q)) return `${r.confidence.text} You answered ${r.confidence.answered} of ${r.confidence.total} questions. With limited information, earlier referral is recommended.`
  if (/breath|count/.test(q)) return 'When the person is calm, watch their chest or belly and count each rise for one full minute. Use the timer on the Assessment screen.'
  if (/frost|cold|weather/.test(q)) return v.cold === 'helada' ? 'Frost is expected. Young children and older adults get cold quickly: dress in layers and cover the head, hands, and feet.' : `The cold level is ${v.cold === 'frio' ? 'cold' : 'normal'}. Check again if the temperature drops.`
  if (/home|house|warm|insulat/.test(q)) return 'Seal gaps around doors and windows, raise beds off the floor, and do not let anyone sleep in wet clothes. Dress in layers and cover the head, hands, and feet.'
  if (/why|reason|explain/.test(q)) return r.findings.length ? `The rules indicate: ${r.findings.slice(0, 3).map((f) => f.text).join(' ')}` : r.reason
  if (/diagnos|illness|disease|what is wrong/.test(q)) return 'I do not provide diagnoses. I use rules based on MINSA protocols to help you decide whether to provide care, monitor, or refer to a health post.'
  if (/do|happening|how|status|hello|now|next/.test(q)) return what
  return 'I can explain what to do for this person, why, how confident the guidance is, how to count breaths, and what to say over the radio.'
}

declare const __ASSISTANT_LLM__: boolean
declare const __ASSISTANT_MODEL__: string

const SYSTEM = `You are AstroTwin's health copilot for an astronaut on a space mission. Respond in English, in two or three short sentences, without medical jargon, lists, or formatting.
Rules you must follow:
- Use ONLY the information provided. Do not invent numbers or measurements.
- Never diagnose or name diseases. Suggest simple actions and say when to notify Earth.
- If anything is marked "Act" (red), address it first.
- The "base answer" from the spacecraft rules is correct: you may phrase it more naturally or add context, but do not contradict it.
- If asked about something unrelated to the crew member's health or the mission, say so in one sentence and return to the topic.`

/** Resumen compacto del estado para el modelo. Son datos simulados, sin nombres. */
function snapshot(c: AssistantContext): string {
  const word = { ok: 'Good', warn: 'Watch', bad: 'Act' }
  const lines = Object.values(c.readings).filter((r) => r.label).map((r) => `${r.label}: ${r.text} ${r.unit} (${word[r.status]})`)
  const left = c.tasks.filter((t) => !c.tasksDone[t.id]).map((t) => t.title)
  return [
    `Scene: ${['launch', 'monitor', 'full data', 'daily plan'][c.scene] ?? 'monitor'}`,
    `Mission day ${c.sim.missionDay}. ${c.sim.storm ? (c.sim.sheltered ? 'Solar storm; in shelter.' : 'Solar storm in progress; not in shelter.') : 'No solar storm.'}`,
    ...lines,
    `Active alerts: ${c.issues.length ? c.issues.map((i) => `${i.title} → ${i.actionLabel}`).join('; ') : 'none'}`,
    `Tasks remaining today: ${left.length ? left.join(', ') : 'none'}. Points ${c.points}, streak ${c.streak} days.`,
  ].join('\n')
}

const SYSTEM_COMMUNITY = `You are AstroTwin Community's copilot. You assist a community health worker in the Peruvian highlands or jungle during cold spells. Respond in simple English, in two or three short sentences, without medical jargon, lists, or formatting.
Rules you must follow:
- You provide decision support using rules based on MINSA protocols. NEVER diagnose or name diseases or medications.
- The rules have already made the decision (provide care, monitor, or refer to a health post). Do not change or soften it. If the result is "Refer to the health post", say so first.
- The decision and actions are what the worker MUST DO NOW, not what they have already done. Use imperative language ("refer", "keep warm", "leave now"); never claim they have already done it.
- Use ONLY the information provided. Do not invent numbers.
- The "base answer" is correct: you may phrase it more naturally or add context, but do not contradict it.
- If asked about something unrelated to the person, the cold, or the visit, say so in one sentence and return to the topic.`

/** Resumen de la visita para el modelo. Sin alias ni nombres: solo lo observado. */
function snapshotCommunity(c: AssistantContext): string {
  const v = c.visit; const r = c.result
  const yn = (x: boolean | null) => (x === null ? 'unanswered' : x ? 'yes' : 'no')
  const who = v.kind === 'child' ? `child under 5 (${v.ageMonths} months)` : v.kind === 'elder' ? 'older adult' : 'adult'
  const signs = (Object.keys(v.danger) as (keyof typeof v.danger)[]).filter((k) => v.danger[k])
  return [
    `Person being assessed: ${who}.`,
    `Selected warning signs: ${signs.length ? signs.join(', ') : 'none'}.`,
    `Cough: ${yn(v.cough)}. Fever to the touch: ${yn(v.feverTouch)}. Enough warm clothing: ${yn(v.warmEnough)}. Ate and drank fluids today: ${yn(v.ateDrank)}.`,
    `Breaths per minute: ${v.breaths ?? 'not counted'}. Thermometer: ${v.tempC ?? 'no data'}. Oxygen saturation: ${v.spo2 ?? 'no data'}.`,
    `Environmental cold: ${v.cold}. Elevation: ${v.altitude} m. Health post is ${v.hoursToPost} hours away.`,
    `RULE-BASED DECISION: ${r.label}. Reason: ${r.reason}`,
    `Actions: 1) ${r.actions[0]} 2) ${r.actions[1]}`,
    `Confidence: ${r.confidence.level} (${r.confidence.answered} of ${r.confidence.total} questions answered).`,
    `Findings: ${r.findings.map((f) => f.text).join(' ') || 'none'}`,
    r.onTheWay.length ? `On the way to the health post: ${r.onTheWay.join(' ')}` : '',
  ].filter(Boolean).join('\n')
}

/** Ask Groq through the local server. Returns null when the model cannot answer. */
async function askModel(text: string, c: AssistantContext, base: string): Promise<string | null> {
  const community = c.profile === 'community'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 9000)
  try {
    const res = await fetch('/api/groq', {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: __ASSISTANT_MODEL__, temperature: 0.3, max_completion_tokens: 700, reasoning_effort: 'low',
        messages: [
          { role: 'system', content: community ? SYSTEM_COMMUNITY : SYSTEM },
          { role: 'user', content: `Current data:\n${community ? snapshotCommunity(c) : snapshot(c)}\n\nRule-based answer: ${base}\n\nQuestion from ${community ? 'the community health worker' : 'the crew member'}: ${text}` },
        ],
      }),
    })
    if (!res.ok) {
      console.warn(`Groq assistant request failed with HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    const out = data?.choices?.[0]?.message?.content
    if (typeof out !== 'string') return null
    // El chat y la voz muestran texto plano: se quitan marcas de formato
    const clean = out.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim()
    return clean.length > 8 ? clean : null
  } catch (error) {
    console.warn('Groq assistant request failed', error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Single entry point for the assistant.
 * - Rule-based responses are always available (works offline).
 * - En los dos perfiles, si el servidor tiene clave de Groq y hay red, el modelo redacta la respuesta
 *   a partir de esas reglas y de los datos. Si falla o tarda, se usa la de reglas.
 * - En comunidad rural la decisión la toman siempre las reglas locales; al modelo se le envía la visita
 *   sin alias ni nombres, y no puede cambiar la decisión.
 * - En pruebas automáticas se usan solo las reglas (respuestas fijas y sin gastar la clave).
 */
export type AssistantFallbackReason = 'not-configured' | 'offline' | 'unavailable'

export async function askAssistant(
  text: string,
  context: AssistantContext,
  onFallback?: (reason: AssistantFallbackReason) => void,
): Promise<string> {
  const base = context.profile === 'community' ? rulesCommunity(text, context) : rules(text, context)
  if (typeof navigator !== 'undefined' && navigator.webdriver) return base
  if (!__ASSISTANT_LLM__) {
    onFallback?.('not-configured')
    return base
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    onFallback?.('offline')
    return base
  }
  const answer = await askModel(text, context, base)
  if (answer) return answer
  onFallback?.('unavailable')
  return base
}
