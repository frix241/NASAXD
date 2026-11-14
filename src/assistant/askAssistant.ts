/**
 * Asistente de AstroTwin.
 *
 * Hoy responde con reglas sencillas. Para conectar un modelo local, cambia SOLO el cuerpo de
 * `askAssistant` (por ejemplo, un fetch a http://localhost:11434) y conserva la firma:
 * la interfaz no necesita ningún cambio.
 */
import { TASKS, type TaskId } from '../config/tasks'
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
}

/** Pregunta de ejemplo por escena (se usa cuando el micrófono no puede oír). */
export const SAMPLE_QUESTION = ['¿Qué está pasando?', '¿Cómo estoy?', '¿Qué dicen mis datos?', '¿Qué me toca ahora?']
/** Preguntas sugeridas por escena. */
export const SUGGESTIONS: string[][] = [
  ['¿Qué está pasando?'],
  ['¿Cómo estoy?', '¿Cómo va mi agua?', '¿Hay radiación?'],
  ['¿Qué dicen mis datos?', '¿Cómo dormí?', '¿Cómo va mi ejercicio?'],
  ['¿Qué me toca ahora?', '¿Cuántos puntos tengo?', '¿Cómo estoy?'],
]

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
  const left = TASKS.filter((t) => !c.tasksDone[t.id])
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

export async function askAssistant(text: string, context: AssistantContext): Promise<string> {
  return rules(text, context)
}
