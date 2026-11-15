/**
 * Asistente de AstroTwin.
 *
 * Hoy responde con reglas sencillas. Para conectar un modelo local, cambia SOLO el cuerpo de
 * `askAssistant` (por ejemplo, un fetch a http://localhost:11434) y conserva la firma:
 * la interfaz no necesita ningún cambio.
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
const n1 = (v: number) => v.toFixed(1).replace('.', ',')
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function health(c: AssistantContext): string {
  const { issues, readings: r } = c
  if (!issues.length) {
    return `Todo en verde. Pulso ${r.pulse.text}, presión ${r.bp.text} y oxígeno ${r.spo2.text} %. Sigue con tu ruta del día.`
  }
  const first = issues[0]
  const head = issues.length === 1 ? 'Hay 1 cosa para vigilar.' : `Hay ${issues.length} cosas para vigilar.`
  const rest = issues.slice(1).map((i) => i.title.toLowerCase())
  const also = rest.length ? ` También: ${rest.join(', ')}.` : ''
  const earth = first.level === 'bad' && first.action !== 'earth' ? ' Si no mejora, avisa a la Tierra.' : ''
  return `${head} ${first.title}. ${first.why} Lo que toca: ${first.actionLabel.toLowerCase()}.${also}${earth}`
}

function data(c: AssistantContext): string {
  const h = c.sim.history
  return `En 14 días dormiste ${n1(avg(h.sleep))} horas por noche en promedio. Llevas el ${c.readings.exercise.text} % de tu ejercicio semanal y ${n1(c.sim.radTotal)} milisieverts de radiación acumulada. ${c.issues.length ? health(c) : 'No veo nada fuera de lo normal.'}`
}

function next(c: AssistantContext): string {
  const urgent = c.issues.find((i) => i.level === 'bad')
  if (urgent) return `Primero: ${urgent.actionLabel.toLowerCase()}. ${urgent.why}`
  const left = c.tasks.filter((t) => !c.tasksDone[t.id])
  if (!left.length) return `Terminaste tu ruta de hoy. Tienes ${c.points} puntos y ${c.streak} días de racha.`
  return `Te ${left.length === 1 ? 'falta 1 tarea' : `faltan ${left.length} tareas`}. Sigue ${left[0].title.toLowerCase()}: dura ${left[0].minutes} minutos y cuida ${left[0].cares.toLowerCase()}.`
}

function rules(text: string, c: AssistantContext): string {
  const q = plain(text)
  const r = c.readings
  if (/agua|hidrat|sed|beber/.test(q)) return `Tu hidratación está en ${r.hydration.text} %. ${r.hydration.status === 'ok' ? 'Vas bien.' : 'Bebe una bolsa de agua ahora.'}`
  if (/suen|dorm|descans|cansad/.test(q)) return `Anoche dormiste ${r.sleep.text} horas. ${r.sleep.status === 'ok' ? 'Es suficiente.' : 'Te conviene una siesta corta hoy.'}`
  if (/radiaci|tormenta|refugio/.test(q)) return c.sim.storm
    ? (c.sim.sheltered ? 'Hay tormenta solar, pero estás en el refugio. Quédate hasta que pase.' : 'Hay tormenta solar. Ve al refugio ahora.')
    : `La radiación está normal. Llevas ${n1(c.sim.radTotal)} milisieverts en la misión.`
  if (/presi|coraz|pulso|latid/.test(q)) return `Tu presión es ${r.bp.text} y tu pulso ${r.pulse.text}. ${r.bp.status === 'ok' && r.pulse.status === 'ok' ? 'Todo normal.' : 'Descansa y toma agua.'}`
  if (/temperatura|fiebre|calor|frio/.test(q)) return `Tu temperatura es ${r.temp.text} grados. ${r.temp.status === 'ok' ? 'Es normal.' : 'Descansa, toma agua y avisa a la Tierra si sigue así.'}`
  if (/oxigen|respir|aire/.test(q)) return `Tu oxígeno está en ${r.spo2.text} % y respiras ${r.resp.text} veces por minuto. ${r.spo2.status === 'ok' ? 'Todo normal.' : 'Respira lento y profundo.'}`
  if (/ejercicio|muscul|hueso|fuerza/.test(q)) return `Llevas el ${r.exercise.text} % de tu ejercicio de la semana. ${r.exercise.status === 'ok' ? 'Así proteges músculos y huesos.' : 'Haz hoy tu ejercicio de resistencia: sin él se pierde músculo y hueso.'}`
  if (/animo|triste|estres|siento/.test(q)) return `Tu ánimo está en ${r.mood.text} de 100. ${r.mood.status === 'ok' ? 'Vas bien.' : 'Un descanso o hablar con alguien ayuda. Haz tu chequeo de ánimo.'}`
  if (/punto|racha|nivel/.test(q)) return `Tienes ${c.points} puntos, nivel ${Math.floor(c.points / 100) + 1} y ${c.streak} días de racha.`
  if (/toca|sigue|tarea|ruta|hacer|ahora/.test(q)) return next(c)
  if (/dato|historial|semana|resumen/.test(q)) return data(c)
  if (/como estoy|salud|estado|pasando|todo bien|hola|buen/.test(q)) return c.scene === 0 ? 'Estoy encendiendo tus sensores. En unos segundos verás tu monitor.' : health(c)
  return 'Puedo contarte de tu pulso, presión, agua, sueño, radiación, ejercicio, ánimo y tus tareas del día. Pregúntame por una de esas.'
}

/**
 * Perfil comunidad: el mismo sistema de reglas explicables. Habla con la agente comunitaria,
 * en frases cortas. Es apoyo a la decisión con reglas basadas en protocolos MINSA, nunca un diagnóstico.
 */
function rulesCommunity(text: string, c: AssistantContext): string {
  const q = plain(text)
  const r = c.result; const v = c.visit
  const what = `${r.label}. ${r.reason} Primero: ${r.actions[0]} Después: ${r.actions[1]}`
  if (c.scene === 0) return 'Estoy cargando las reglas en este equipo. No hace falta internet.'
  if (/radio|telefono|dict|llam/.test(q)) return radioScript(v, r).filter(Boolean).join(' ')
  if (/camino|traslad|llevar/.test(q)) return r.onTheWay.length ? `En el camino: ${r.onTheWay.join(' ')}` : 'Ahora no hace falta derivar. Si aparece una señal de alarma, la hoja de derivación te dice qué hacer en el camino.'
  if (/segur|confian|dato|falta/.test(q)) return `${r.confidence.text} Respondiste ${r.confidence.answered} de ${r.confidence.total} preguntas. Con pocos datos recomiendo derivar antes.`
  if (/respir|contar|cuento/.test(q)) return 'Con la persona tranquila, mira su pecho o su barriga y cuenta cada vez que sube, durante un minuto entero. Usa el cronómetro de la pantalla Evaluar.'
  if (/helada|friaje|frio|clima/.test(q)) return v.cold === 'helada' ? 'Hay helada. Los niños pequeños y los adultos mayores se enfrían rápido: abriga por capas y cubre cabeza, manos y pies.' : `El frío está en nivel ${v.cold === 'frio' ? 'frío' : 'normal'}. Si baja la temperatura, vuelve a revisar.`
  if (/vivienda|casa|abrig/.test(q)) return 'Tapa las rendijas de puertas y ventanas, sube la cama del suelo y que nadie duerma con ropa húmeda. Abriga por capas y cubre cabeza, manos y pies.'
  if (/por que|razon|explica/.test(q)) return r.findings.length ? `Lo decido por estas reglas: ${r.findings.slice(0, 3).map((f) => f.text).join(' ')}` : r.reason
  if (/diagnost|enfermedad|que tiene/.test(q)) return 'No doy diagnósticos. Soy un sistema de reglas basadas en protocolos MINSA que te ayuda a decidir si atiendes tú, vigilas o derivas a la posta.'
  if (/hago|pasando|como|estado|hola|ahora|toca/.test(q)) return what
  return 'Puedo decirte qué hacer con esta persona, por qué, qué tan segura estoy, cómo contar la respiración y qué dictar por radio.'
}

declare const __ASSISTANT_LLM__: boolean
declare const __ASSISTANT_MODEL__: string

const SYSTEM = `Eres el copiloto de salud de AstroTwin para una astronauta en una misión espacial. Respondes en español, en dos o tres frases cortas, sin jerga médica, sin listas ni formato.
Reglas que no puedes romper:
- Usa SOLO los datos que te doy. No inventes cifras ni mediciones.
- Nunca des un diagnóstico ni nombres enfermedades. Sugiere acciones sencillas y di cuándo avisar a la Tierra.
- Si algo está en "Atender" (rojo), empieza por eso.
- La "respuesta base" viene de las reglas de la nave y es correcta: puedes decirla con más naturalidad o ampliarla, pero no contradecirla.
- Si te preguntan algo que no tiene que ver con la salud de la tripulante o la misión, dilo en una frase y vuelve al tema.`

/** Resumen compacto del estado para el modelo. Son datos simulados, sin nombres. */
function snapshot(c: AssistantContext): string {
  const word = { ok: 'Bien', warn: 'Vigilar', bad: 'Atender' }
  const lines = Object.values(c.readings).filter((r) => r.label).map((r) => `${r.label}: ${r.text} ${r.unit} (${word[r.status]})`)
  const left = c.tasks.filter((t) => !c.tasksDone[t.id]).map((t) => t.title)
  return [
    `Escena: ${['arranque', 'monitor', 'datos completos', 'ruta diaria'][c.scene] ?? 'monitor'}`,
    `Día de misión ${c.sim.missionDay}. ${c.sim.storm ? (c.sim.sheltered ? 'Tormenta solar; está en el refugio.' : 'Tormenta solar en curso; no está en el refugio.') : 'Sin tormenta solar.'}`,
    ...lines,
    `Avisos activos: ${c.issues.length ? c.issues.map((i) => `${i.title} → ${i.actionLabel}`).join('; ') : 'ninguno'}`,
    `Tareas pendientes hoy: ${left.length ? left.join(', ') : 'ninguna'}. Puntos ${c.points}, racha ${c.streak} días.`,
  ].join('\n')
}

const SYSTEM_COMMUNITY = `Eres el copiloto de AstroTwin Comunidad. Ayudas a una agente comunitaria de salud de la sierra o la selva del Perú, sin formación médica avanzada, durante heladas y friaje. Respondes en español sencillo, en dos o tres frases cortas, sin jerga médica, sin listas ni formato.
Reglas que no puedes romper:
- Eres apoyo a la decisión con reglas basadas en protocolos MINSA. NUNCA das un diagnóstico ni nombras enfermedades ni medicamentos.
- La decisión ya está tomada por las reglas (atiendo yo, vigilo o derivo a la posta). No la cambies ni la suavices. Si es "Derivo a la posta", dilo primero.
- La decisión y las acciones son lo que la agente DEBE HACER AHORA, no algo que ya hizo. Háblale en imperativo ("deriva", "abriga", "sal ya"); nunca digas que ya lo hizo.
- Usa SOLO los datos que te doy. No inventes cifras.
- La "respuesta base" es correcta: puedes decirla con más naturalidad o ampliarla, pero no contradecirla.
- Si te preguntan algo que no tiene que ver con la persona atendida, el frío o la visita, dilo en una frase y vuelve al tema.`

/** Resumen de la visita para el modelo. Sin alias ni nombres: solo lo observado. */
function snapshotCommunity(c: AssistantContext): string {
  const v = c.visit; const r = c.result
  const yn = (x: boolean | null) => (x === null ? 'sin responder' : x ? 'sí' : 'no')
  const who = v.kind === 'child' ? `niño o niña menor de 5 años (${v.ageMonths} meses)` : v.kind === 'elder' ? 'adulto mayor' : 'adulto'
  const signs = (Object.keys(v.danger) as (keyof typeof v.danger)[]).filter((k) => v.danger[k])
  return [
    `Persona atendida: ${who}.`,
    `Señales de alarma marcadas: ${signs.length ? signs.join(', ') : 'ninguna'}.`,
    `Tos: ${yn(v.cough)}. Fiebre al tacto: ${yn(v.feverTouch)}. Abrigo suficiente: ${yn(v.warmEnough)}. Comió y tomó líquidos hoy: ${yn(v.ateDrank)}.`,
    `Respiraciones por minuto: ${v.breaths ?? 'sin contar'}. Termómetro: ${v.tempC ?? 'sin dato'}. Saturación: ${v.spo2 ?? 'sin dato'}.`,
    `Frío del entorno: ${v.cold}. Altitud: ${v.altitude} m. Posta de salud a ${v.hoursToPost} horas.`,
    `DECISIÓN DE LAS REGLAS: ${r.label}. Razón: ${r.reason}`,
    `Acciones: 1) ${r.actions[0]} 2) ${r.actions[1]}`,
    `Confianza: ${r.confidence.level} (${r.confidence.answered} de ${r.confidence.total} preguntas respondidas).`,
    `Hallazgos: ${r.findings.map((f) => f.text).join(' ') || 'ninguno'}`,
    r.onTheWay.length ? `En el camino a la posta: ${r.onTheWay.join(' ')}` : '',
  ].filter(Boolean).join('\n')
}

/** Pregunta al modelo (Groq) a través del servidor local. Devuelve null si no hay respuesta a tiempo. */
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
          { role: 'user', content: `Datos actuales:\n${community ? snapshotCommunity(c) : snapshot(c)}\n\nRespuesta base de las reglas: ${base}\n\nPregunta de ${community ? 'la agente comunitaria' : 'la tripulante'}: ${text}` },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const out = data?.choices?.[0]?.message?.content
    if (typeof out !== 'string') return null
    // El chat y la voz muestran texto plano: se quitan marcas de formato
    const clean = out.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim()
    return clean.length > 8 ? clean : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Punto único de entrada del asistente.
 * - Siempre hay respuesta de reglas (funciona sin internet).
 * - En los dos perfiles, si el servidor tiene clave de Groq y hay red, el modelo redacta la respuesta
 *   a partir de esas reglas y de los datos. Si falla o tarda, se usa la de reglas.
 * - En comunidad rural la decisión la toman siempre las reglas locales; al modelo se le envía la visita
 *   sin alias ni nombres, y no puede cambiar la decisión.
 * - En pruebas automáticas se usan solo las reglas (respuestas fijas y sin gastar la clave).
 */
export async function askAssistant(text: string, context: AssistantContext): Promise<string> {
  const base = context.profile === 'community' ? rulesCommunity(text, context) : rules(text, context)
  const online = typeof navigator === 'undefined' || (navigator.onLine && !navigator.webdriver)
  if (!__ASSISTANT_LLM__ || !online || context.scene === 0) return base
  return (await askModel(text, context, base)) ?? base
}
