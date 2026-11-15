/**
 * Modo colegio: la unidad es el AULA. El tutor registra un "conteo rápido" al día
 * (cuántos, nunca quiénes) y de ahí sale el semáforo. No hay datos individuales ni nombres.
 * Funciones puras.
 */
import { DESTINATIONS, type Destination, type Status } from '../config/rules'
import { SCHOOL_ZONES, type Issue } from './issues'
import type { MetricKey, Reading, Scenario } from './simulator'

/** Umbrales del semáforo del aula. VALORES DE EJEMPLO: validar con MINSA/MINEDU. */
export const AULA_RULES = {
  note: 'Valores de ejemplo. Validar con MINSA/MINEDU.',
  warnPct: 20, // ámbar desde este % del aula
  badPct: 40, // rojo por encima de este %
  climate: { normal: 'ok', alto: 'warn', bajo: 'warn', extreme: 'bad' } as Record<string, Status>,
  noRecess: 'warn' as Status,
  redDaysToEscalate: 3, // días seguidos en rojo antes de sugerir hablar con la familia o la posta
  defaults: { total: 30, sleptLittle: 3, noBreakfast: 2, low: 2 },
}
export const ESCALATE = 'Lleva 3 días seguidos en rojo: conversa con la familia o la posta de salud.'

export type Climate = 'normal' | 'alto' | 'bajo'
export interface DayCount {
  sleptLittle: number // cuántos durmieron poco
  noBreakfast: number // cuántos no desayunaron
  low: number // cuántos están decaídos
  climate: Climate
  extreme: boolean // ola de calor o friaje (evento del día)
  recess: boolean // hubo recreo activo
  // Nivel 2, opcional: null = sin registrar
  noWater: number | null
  heavyPack: number | null
  posture: number | null
}
export interface Aula {
  total: number
  region: Destination
  firstDay: number // número del día escolar de days[0]
  days: DayCount[] // el último es el día de hoy (en edición); se guardan hasta 7
}

export type CountKey = 'sleptLittle' | 'noBreakfast' | 'low' | 'noWater' | 'heavyPack' | 'posture'
/** Las 5 preguntas del conteo rápido, en el orden en que se hacen. */
export const QUESTIONS: { key: MetricKey; ask: string; short: string }[] = [
  { key: 'sleep', ask: '¿Cuántos durmieron poco?', short: 'Sueño' },
  { key: 'breakfast', ask: '¿Cuántos no desayunaron?', short: 'Desayuno' },
  { key: 'mood', ask: '¿Cuántos están decaídos?', short: 'Ánimo' },
  { key: 'radiation', ask: '¿Cómo está el clima hoy?', short: 'Clima' },
  { key: 'exercise', ask: '¿Hubo recreo activo?', short: 'Recreo activo' },
]
export const LEVEL2: { key: MetricKey; field: CountKey; ask: string; short: string }[] = [
  { key: 'hydration', field: 'noWater', ask: '¿Cuántos no trajeron agua?', short: 'Agua' },
  { key: 'backpack', field: 'heavyPack', ask: '¿Cuántos traen mochila muy pesada?', short: 'Mochila' },
  { key: 'posture', field: 'posture', ask: '¿Cuántos se sientan encorvados?', short: 'Postura' },
]

export const newDay = (): DayCount => ({
  sleptLittle: AULA_RULES.defaults.sleptLittle, noBreakfast: AULA_RULES.defaults.noBreakfast, low: AULA_RULES.defaults.low,
  climate: 'normal', extreme: false, recess: true, noWater: null, heavyPack: null, posture: null,
})

/** Aula de demostración con seis días ya registrados y el de hoy por llenar. */
export function createAula(region: Destination = 'costa'): Aula {
  const past: [number, number, number, Climate, boolean][] = [
    [4, 3, 2, 'normal', true], [5, 2, 3, 'normal', true], [7, 4, 2, 'alto', true],
    [6, 3, 4, 'alto', false], [3, 2, 2, 'normal', true], [4, 5, 3, 'normal', true],
  ]
  return {
    total: AULA_RULES.defaults.total, region, firstDay: 17,
    days: [...past.map(([sleptLittle, noBreakfast, low, climate, recess]) => ({ ...newDay(), sleptLittle, noBreakfast, low, climate, recess })), newDay()],
  }
}

export const today = (a: Aula): DayCount => a.days[a.days.length - 1]
export const dayNumber = (a: Aula, i = a.days.length - 1): number => a.firstDay + i
export const pct = (n: number, total: number): number => (total > 0 ? Math.round((n / total) * 100) : 0)

export function statusPct(n: number, total: number): Status {
  const p = pct(n, total)
  return p > AULA_RULES.badPct ? 'bad' : p >= AULA_RULES.warnPct ? 'warn' : 'ok'
}
export function statusClimate(d: DayCount): Status {
  if (d.climate !== 'normal' && d.extreme) return AULA_RULES.climate.extreme
  return AULA_RULES.climate[d.climate]
}

const OFF: Reading = { label: '', status: 'ok', value: 0, text: '', unit: '' }
const count = (label: string, n: number | null, total: number, what: string): Reading =>
  n === null
    ? { label, status: 'ok', value: 0, text: 'Sin dato', unit: 'no se registró hoy' }
    : { label, status: statusPct(n, total), value: pct(n, total), text: String(n), unit: `de ${total} ${what}` }

const CLIMATE_TEXT: Record<Climate, string> = { normal: 'Normal', alto: 'Calor', bajo: 'Frío' }

/** Semáforo de un día. Usa las mismas claves que el monitor para reutilizar la interfaz. */
export function evaluateAula(a: Aula, d: DayCount = today(a)): Record<MetricKey, Reading> {
  const t = a.total
  const reg = DESTINATIONS[a.region]
  return {
    pulse: OFF, bp: OFF, spo2: OFF, temp: OFF, resp: OFF, glucose: OFF,
    sleep: count('Sueño', d.sleptLittle, t, 'durmieron poco'),
    breakfast: count('Desayuno', d.noBreakfast, t, 'no desayunaron'),
    mood: count('Ánimo', d.low, t, 'están decaídos'),
    radiation: {
      label: 'Clima del día', status: statusClimate(d), value: d.climate === 'normal' ? 0 : 100,
      text: d.climate !== 'normal' && d.extreme ? (d.climate === 'alto' ? 'Ola de calor' : 'Friaje') : CLIMATE_TEXT[d.climate],
      unit: `lo normal en ${reg.label.split(' (')[0].toLowerCase()}: ${reg.temp} °C`,
    },
    exercise: { label: 'Recreo activo', status: d.recess ? 'ok' : AULA_RULES.noRecess, value: d.recess ? 100 : 0, text: d.recess ? 'Sí' : 'No', unit: 'hubo juego con movimiento' },
    hydration: count('Agua', d.noWater, t, 'sin agua'),
    backpack: count('Mochila', d.heavyPack, t, 'con mochila muy pesada'),
    posture: count('Postura', d.posture, t, 'se sientan encorvados'),
  }
}

/** Días seguidos en rojo de una medida, contando hacia atrás desde hoy. */
export function redStreak(a: Aula, key: MetricKey): number {
  let n = 0
  for (let i = a.days.length - 1; i >= 0; i--) {
    if (evaluateAula(a, a.days[i])[key].status !== 'bad') break
    n++
  }
  return n
}

type Copy = { title: string; why: string }
function copy(key: MetricKey, d: DayCount): Copy {
  switch (key) {
    case 'sleep': return { title: 'Hay mucho sueño en el aula', why: 'Haz una pausa activa de 3 minutos y deja el trabajo difícil para después del recreo.' }
    case 'breakfast': return { title: 'Varios llegaron sin desayunar', why: 'Empieza con una actividad ligera y, si puedes, adelanta el momento de la lonchera.' }
    case 'mood': return { title: 'Hay varios decaídos', why: 'Abre con una ronda corta: cada quien dice cómo llegó hoy. Luego, trabajo en parejas.' }
    case 'radiation': return d.climate === 'alto'
      ? { title: d.extreme ? 'Ola de calor' : 'Día de calor', why: 'Abre las ventanas, haz una pausa para tomar agua cada hora y lleva el recreo a la sombra.' }
      : { title: d.extreme ? 'Friaje' : 'Día de frío', why: 'Cierra las corrientes de aire, que se abriguen y empieza con una actividad de movimiento.' }
    case 'exercise': return { title: 'Hoy no hubo recreo activo', why: 'Haz 5 minutos de juego con movimiento antes de la última hora.' }
    case 'hydration': return { title: 'Falta agua en el aula', why: 'Haz una pausa para tomar agua ahora y otra después del recreo.' }
    case 'backpack': return { title: 'Mochilas muy pesadas', why: 'Pide que mañana traigan solo lo del día y que usen las dos correas.' }
    case 'posture': return { title: 'Muchos se sientan encorvados', why: 'Haz una pausa de estiramiento de 2 minutos y revisa la altura de sillas y mesas.' }
    default: return { title: '', why: '' }
  }
}

const ORDER: MetricKey[] = ['radiation', 'sleep', 'breakfast', 'mood', 'exercise', 'hydration', 'backpack', 'posture']

/** Avisos del día, del más grave al menos grave. El primero es la "acción del día". */
export function aulaIssues(a: Aula): Issue[] {
  const d = today(a)
  const r = evaluateAula(a, d)
  const list: Issue[] = []
  for (const level of ['bad', 'warn'] as const) {
    const keys = ORDER.filter((k) => r[k].status === level).sort((x, y) => r[y].value - r[x].value)
    for (const key of keys) {
      const c = copy(key, d)
      const escalate = level === 'bad' && redStreak(a, key) >= AULA_RULES.redDaysToEscalate
      list.push({
        key, level, zone: SCHOOL_ZONES.of[key], title: c.title, why: escalate ? `${c.why} ${ESCALATE}` : c.why,
        action: 'ack', actionLabel: 'Hecho', minutes: 5,
      })
    }
  }
  return list
}

/** La única acción que se le propone hoy al tutor. */
export function actionOfDay(a: Aula): { title: string; text: string; level: Status } {
  const first = aulaIssues(a)[0]
  return first
    ? { title: first.title, text: first.why, level: first.level }
    : { title: 'Todo en verde', text: 'Mantén la rutina de hoy: recreo activo y una pausa para tomar agua.', level: 'ok' }
}

// ── Cambios (siempre devuelven un aula nueva) ───────────────────────────────
const clampN = (n: number, total: number) => Math.max(0, Math.min(total, Math.round(n)))
export function setToday(a: Aula, patch: Partial<DayCount>): Aula {
  const d = { ...today(a), ...patch }
  for (const k of ['sleptLittle', 'noBreakfast', 'low'] as const) d[k] = clampN(d[k], a.total)
  for (const k of ['noWater', 'heavyPack', 'posture'] as const) if (d[k] !== null) d[k] = clampN(d[k]!, a.total)
  if (d.climate === 'normal') d.extreme = false
  return { ...a, days: [...a.days.slice(0, -1), d] }
}
export function setTotal(a: Aula, total: number): Aula {
  const t = Math.max(1, Math.min(60, Math.round(total)))
  return setToday({ ...a, total: t }, {})
}
/** Cierra el día de hoy y abre el siguiente con los valores por defecto. Se conservan 7 días. */
export function nextDay(a: Aula): Aula {
  const days = [...a.days, newDay()]
  const drop = Math.max(0, days.length - 7)
  return { ...a, days: days.slice(drop), firstDay: a.firstDay + drop }
}
export function applyAulaEvent(a: Aula, sc: Scenario): Aula {
  const big = Math.round(a.total * 0.47)
  switch (sc) {
    case 'sleepy': return setToday(a, { sleptLittle: big })
    case 'heat': return setToday(a, { climate: 'alto', extreme: true })
    case 'cold': return setToday(a, { climate: 'bajo', extreme: true })
    case 'hardWeek': {
      const days = a.days.map((d, i) => (i >= a.days.length - 3 ? { ...d, sleptLittle: big } : d))
      return { ...a, days }
    }
    default: return a
  }
}

/** Resumen de la semana para el informe: días en verde, ámbar y rojo por pregunta. */
export function weekSummary(a: Aula): { key: MetricKey; short: string; statuses: Status[]; worst: Status; title: string; action: string }[] {
  return QUESTIONS.map((q) => {
    const statuses = a.days.map((d) => evaluateAula(a, d)[q.key].status)
    const worst: Status = statuses.includes('bad') ? 'bad' : statuses.includes('warn') ? 'warn' : 'ok'
    const badDay = a.days[statuses.lastIndexOf(worst)] ?? today(a)
    const c = copy(q.key, badDay.climate === 'normal' ? { ...badDay, climate: 'alto' } : badDay)
    return { key: q.key, short: q.short, statuses, worst, title: c.title, action: c.why }
  })
}
/** Hasta 3 acciones para el director: lo que más días estuvo fuera de verde. */
export function topActions(a: Aula): { short: string; days: number; action: string }[] {
  return weekSummary(a)
    .map((w) => ({ short: w.short, action: w.action, days: w.statuses.filter((s) => s !== 'ok').length, red: w.statuses.filter((s) => s === 'bad').length }))
    .filter((w) => w.days > 0)
    .sort((x, y) => y.red - x.red || y.days - x.days)
    .slice(0, 3)
}
