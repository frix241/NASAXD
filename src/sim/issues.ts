/** Convierte lecturas fuera de rango en avisos con lenguaje sencillo y una acción. Nunca diagnostica. */
import type { Status } from '../config/rules'
import type { MetricKey, Reading, SimState } from './simulator'

export type Zone = 'heart' | 'kidneys' | 'bones' | 'head' | 'muscles' | 'body'
export type ActionId = 'shelter' | 'water' | 'rest' | 'earth' | 'exercise' | 'mood' | 'ack'

export interface ZoneMap { of: Record<MetricKey, Zone>; label: Record<Zone, string>; metrics: Record<Zone, MetricKey[]> }
export const SPACE_ZONES: ZoneMap = {
  of: {
    pulse: 'heart', bp: 'heart', spo2: 'heart', resp: 'heart', hydration: 'kidneys',
    sleep: 'head', mood: 'head', exercise: 'muscles', radiation: 'body', temp: 'body', glucose: 'body',
  },
  label: {
    heart: 'Corazón', kidneys: 'Riñones', bones: 'Huesos', head: 'Cabeza y sueño',
    muscles: 'Músculos', body: 'Cuerpo entero',
  },
  metrics: {
    heart: ['pulse', 'bp', 'spo2', 'resp'], kidneys: ['hydration'], bones: ['exercise'],
    head: ['sleep', 'mood'], muscles: ['exercise'], body: ['radiation', 'temp', 'glucose'],
  },
}
export interface Issue {
  key: MetricKey
  level: Exclude<Status, 'ok'>
  zone: Zone
  title: string
  why: string
  action: ActionId
  actionLabel: string
  minutes: number
}

const PRIORITY: MetricKey[] = ['radiation', 'temp', 'spo2', 'bp', 'pulse', 'glucose', 'hydration', 'sleep', 'resp', 'exercise', 'mood']

type Copy = Omit<Issue, 'key' | 'level' | 'zone'>
function copy(key: MetricKey, bad: boolean, r: Reading, s: SimState): Copy {
  switch (key) {
    case 'radiation': return bad
      ? { title: 'Tormenta solar', why: `La radiación está ${r.text} veces más alta de lo normal. Las paredes del refugio te protegen.`, action: 'shelter', actionLabel: 'Ir al refugio', minutes: 5 }
      : { title: 'Radiación algo alta', why: `Está ${r.text} veces sobre lo normal. Quédate en las zonas centrales de la nave.`, action: 'ack', actionLabel: 'Entendido', minutes: 1 }
    case 'temp': return bad
      ? { title: 'Temperatura fuera de lo normal', why: `Tu cuerpo marca ${r.text} °C. Descansa, toma agua y cuéntale a la Tierra.`, action: 'earth', actionLabel: 'Avisar a la Tierra', minutes: 3 }
      : { title: 'Temperatura un poco alta', why: `Marcas ${r.text} °C. Toma agua y vuelve a mirar en media hora.`, action: 'water', actionLabel: 'Beber agua', minutes: 2 }
    case 'spo2': return bad
      ? { title: 'Poco oxígeno en la sangre', why: `Está en ${r.text} %. Deja lo que haces, respira hondo y avisa a la Tierra.`, action: 'earth', actionLabel: 'Avisar a la Tierra', minutes: 3 }
      : { title: 'Oxígeno un poco bajo', why: `Está en ${r.text} %. Respira lento y profundo unos minutos.`, action: 'ack', actionLabel: 'Entendido', minutes: 3 }
    case 'bp': return bad
      ? { title: 'Presión alta', why: `Tu presión está en ${r.text}. Siéntate y respira lento. Si no baja en 15 minutos, avisa a la Tierra.`, action: 'rest', actionLabel: 'Descansar ahora', minutes: 15 }
      : { title: 'Presión algo alta', why: s.sleepHours < 7
          ? `Está en ${r.text}. Dormir poco sube la presión. Descansa y toma agua.`
          : `Está en ${r.text}. Toma agua y evita esfuerzos por un rato.`, action: 'water', actionLabel: 'Beber agua', minutes: 2 }
    case 'pulse': return bad
      ? { title: 'Pulso muy rápido en reposo', why: `Tu corazón late ${r.text} veces por minuto sin hacer ejercicio. Descansa y avisa a la Tierra.`, action: 'earth', actionLabel: 'Avisar a la Tierra', minutes: 3 }
      : { title: 'Pulso algo rápido', why: `Late ${r.text} veces por minuto. Siéntate y respira lento.`, action: 'rest', actionLabel: 'Descansar ahora', minutes: 10 }
    case 'hydration': return bad
      ? { title: 'Te falta agua', why: `Tu cuerpo está al ${r.text} % de agua. Con poca agua sube la presión y te cansas más.`, action: 'water', actionLabel: 'Beber agua', minutes: 2 }
      : { title: 'Toma un poco de agua', why: `Estás al ${r.text} % de agua. Un vaso ahora evita que baje más.`, action: 'water', actionLabel: 'Beber agua', minutes: 2 }
    case 'sleep': return bad
      ? { title: 'Dormiste muy poco', why: `Anoche dormiste ${r.text} horas. Con poco sueño sube la presión y baja el ánimo.`, action: 'rest', actionLabel: 'Tomar una siesta', minutes: 20 }
      : { title: 'Te faltó sueño', why: `Anoche dormiste ${r.text} horas. Busca un descanso corto hoy.`, action: 'rest', actionLabel: 'Tomar una siesta', minutes: 20 }
    case 'resp': return { title: bad ? 'Respiración fuera de lo normal' : 'Respiración algo rápida', why: `Respiras ${r.text} veces por minuto. Detente y respira lento.`, action: bad ? 'earth' : 'ack', actionLabel: bad ? 'Avisar a la Tierra' : 'Entendido', minutes: 3 }
    case 'exercise': return { title: bad ? 'Muy poco ejercicio esta semana' : 'Falta ejercicio esta semana', why: `Llevas el ${r.text} % de la meta. Sin ejercicio se pierden músculo y hueso.`, action: 'exercise', actionLabel: 'Hacer ejercicio', minutes: 30 }
    case 'mood': return { title: bad ? 'Ánimo muy bajo' : 'Ánimo bajo', why: 'Tu ánimo bajó. Un descanso o hablar con alguien ayuda.', action: 'mood', actionLabel: 'Chequeo de ánimo', minutes: 3 }
    case 'glucose': return r.value < 70
      ? { title: bad ? 'Azúcar en sangre muy baja' : 'Azúcar en sangre algo baja', why: `Tu glucosa marca ${r.text} mg/dL. Come algo dulce ahora y vuelve a medir en 15 minutos.${bad ? ' Avisa a la Tierra.' : ''}`, action: bad ? 'earth' : 'ack', actionLabel: bad ? 'Avisar a la Tierra' : 'Ya comí algo', minutes: 15 }
      : { title: bad ? 'Azúcar en sangre alta' : 'Azúcar en sangre algo alta', why: `Tu glucosa marca ${r.text} mg/dL en ayunas. ${bad ? 'Repite la medición y cuéntale a la Tierra.' : 'Toma agua, muévete un poco y mide otra vez mañana en ayunas.'}`, action: bad ? 'earth' : 'ack', actionLabel: bad ? 'Avisar a la Tierra' : 'Entendido', minutes: 5 }
    default: return { title: r.label, why: '', action: 'ack', actionLabel: 'Entendido', minutes: 1 }
  }
}

export function findIssues(s: SimState, readings: Record<MetricKey, Reading>): Issue[] {
  const list: Issue[] = []
  for (const level of ['bad', 'warn'] as const) {
    for (const key of PRIORITY) {
      const r = readings[key]
      if (r.status !== level) continue
      list.push({ key, level, zone: SPACE_ZONES.of[key], ...copy(key, level === 'bad', r, s) })
    }
  }
  return list
}

export function statusPhrase(issues: Issue[]): string {
  if (!issues.length) return 'Todo en verde'
  return issues.length === 1 ? '1 cosa para vigilar' : `${issues.length} cosas para vigilar`
}
