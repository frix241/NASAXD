/**
 * Perfil "Comunidad rural: heladas y friaje".
 * Apoyo a la decisión para un agente comunitario de salud, sin sensores y sin internet.
 * NUNCA es un diagnóstico. Funciones puras.
 *
 * CONTRATO: estos tipos y firmas los usan la interfaz y el estado global. No cambiar nombres ni formas.
 * Los umbrales viven en src/config/communityRules.ts (valores de ejemplo, pendientes de validar).
 */
import { DESTINATIONS } from '../config/rules'
import type { Destination, Status } from '../config/rules'
import { COMMUNITY_RULES as R } from '../config/communityRules'

export type PersonKind = 'child' | 'elder' | 'adult' // niño menor de 5, adulto mayor, adulto
export type Cold = 'normal' | 'frio' | 'helada'
export type DangerSign = 'noDrink' | 'vomits' | 'convulsions' | 'sleepy' | 'breathless' | 'chestIndrawing' | 'blueLips'
export type YesNo = boolean | null // null = sin responder
export type BodyZone = 'head' | 'chest' | 'hands' | 'feet'

export interface Visit {
  alias: string // alias, nunca el nombre real
  kind: PersonKind
  ageMonths: number // solo para niño menor de 5: 0 a 59
  danger: Record<DangerSign, boolean> // señales de alarma marcadas
  cough: YesNo
  feverTouch: YesNo // fiebre al tacto
  warmEnough: YesNo // tiene abrigo suficiente
  ateDrank: YesNo // comió y tomó líquidos hoy
  breaths: number | null // respiraciones en un minuto, contadas a mano
  cold: Cold
  altitude: number // metros sobre el nivel del mar, aproximado
  hoursToPost: number // horas hasta la posta de salud
  tempC: number | null // termómetro, opcional
  spo2: number | null // pulsioxímetro, opcional
  startedAt: string // hora de la evaluación, 'HH:MM'
  region: Destination
}

export interface Finding { id: string; status: Status; text: string }
export interface Result {
  status: Status // ok = atiendo yo, warn = vigilo, bad = derivo
  label: string // 'Atiendo yo' | 'Vigilo y vuelvo a revisar' | 'Derivo a la posta'
  reason: string // la razón en una frase simple
  actions: [string, string] // dos acciones concretas
  confidence: { level: 'alta' | 'media' | 'baja'; answered: number; total: number; text: string }
  findings: Finding[] // reglas que se activaron, de la más grave a la menos grave
  zones: Record<BodyZone, Status> // qué pintar en el gemelo
  onTheWay: string[] // qué hacer en el camino a la posta (si deriva)
}
export interface Referral { title: string; rows: [string, string][]; onTheWay: string[] }
export interface FrostSeries { hours: string[]; temp: number[]; risk: number[] }

export const DANGER_SIGNS: DangerSign[] = ['noDrink', 'vomits', 'convulsions', 'sleepy', 'breathless', 'chestIndrawing', 'blueLips']
const noDanger = (): Record<DangerSign, boolean> =>
  ({ noDrink: false, vomits: false, convulsions: false, sleepy: false, breathless: false, chestIndrawing: false, blueLips: false })

/** Cómo se dice cada señal de alarma, en palabras simples (sin punto final). */
export const DANGER_TEXT: Record<DangerSign, string> = {
  noDrink: 'no puede beber ni lactar',
  vomits: 'vomita todo',
  convulsions: 'tuvo convulsiones',
  sleepy: 'está muy dormida o no despierta',
  breathless: 'le cuesta respirar',
  chestIndrawing: 'se le hunde el pecho al respirar',
  blueLips: 'tiene los labios morados',
}
const DANGER_ZONES: Record<DangerSign, BodyZone[]> = {
  noDrink: ['head'], vomits: ['head'], convulsions: ['head'], sleepy: ['head'],
  breathless: ['chest'], chestIndrawing: ['chest'], blueLips: ['chest', 'head'],
}

export const STATUS_LABEL: Record<Status, string> = { ok: 'Atiendo yo', warn: 'Vigilo y vuelvo a revisar', bad: 'Derivo a la posta' }
export const COLD_LABEL: Record<Cold, string> = { normal: 'Normal', frio: 'Frío', helada: 'Helada' }
const CONFIDENCE_TEXT = {
  baja: 'Con pocos datos: seré más cautelosa.',
  media: 'Con algunos datos: revisa lo que falta.',
  alta: 'Con datos suficientes.',
} as const

// ── Ayudas ──────────────────────────────────────────────────────────────────
const num = (n: number, decimals = 0) => n.toFixed(decimals).replace('.', ',')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const noDot = (s: string) => s.replace(/\.$/, '')
const pad2 = (n: number) => String(n).padStart(2, '0')
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const isChild = (v: Visit) => v.kind === 'child'
const isBaby = (v: Visit) => isChild(v) && v.ageMonths < R.babyMonths
const isYoungInfant = (v: Visit) => isChild(v) && v.ageMonths < R.youngInfantMonths
const isVulnerable = (v: Visit) => v.kind === 'child' || v.kind === 'elder'
const hoursText = (h: number) => (h === 1 ? '1 hora' : `${num(h, Number.isInteger(h) ? 0 : 1)} horas`)

/** Desde cuántas respiraciones por minuto se considera "respira rápido", según edad y altitud. */
export function fastBreathingFrom(v: Pick<Visit, 'kind' | 'ageMonths' | 'altitude'>): number {
  const b = R.breathing
  const base = v.kind === 'adult' ? b.adult
    : v.kind === 'elder' ? b.elder
    : v.ageMonths < 2 ? b.under2Months
    : v.ageMonths < 12 ? b.from2To11Months
    : b.from1To4Years
  const add = v.altitude > b.altitude.highFrom ? b.altitude.highAdd : v.altitude >= b.altitude.midFrom ? b.altitude.midAdd : 0
  return base + add
}

/** Límites de saturación (%) para vigilar y para derivar, según altitud. */
export function spo2Limits(altitude: number): { watch: number; refer: number } {
  const s = R.spo2
  const band = altitude > s.high.above ? s.high : altitude >= s.mid.from ? s.mid : s.low
  return { watch: band.watch, refer: band.refer }
}

/** Quién es la persona y su edad, en palabras simples. */
export function whoText(v: Visit): string {
  if (v.kind === 'elder') return 'Persona adulta mayor'
  if (v.kind === 'adult') return 'Persona adulta'
  const m = Math.max(0, Math.round(v.ageMonths))
  if (m < 1) return 'Bebé de menos de 1 mes'
  if (m < 12) return `Bebé de ${m} ${m === 1 ? 'mes' : 'meses'}`
  const y = Math.floor(m / 12)
  return `Niño o niña de ${y} ${y === 1 ? 'año' : 'años'}`
}

export function newVisit(region: Destination = 'sierraAlta'): Visit {
  const now = new Date()
  return {
    alias: 'Persona 1', kind: 'child', ageMonths: 24, danger: noDanger(), cough: null, feverTouch: null, warmEnough: null,
    ateDrank: null, breaths: null, cold: 'normal', altitude: DESTINATIONS[region].altitude ?? 0, hoursToPost: 2, tempC: null, spo2: null,
    startedAt: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`, region,
  }
}

// ── Motor de reglas ─────────────────────────────────────────────────────────
type Action = 'go' | 'wrap' | 'liquids' | 'recount' | 'count' | 'remeasure' | 'wind' | 'complete' | 'review' | 'keep' | 'tomorrow'
interface Rule extends Finding {
  zones: BodyZone[]
  acts: Action[]
  env?: boolean // viene del entorno, no de la persona
}

function actionText(a: Action, v: Visit): string {
  switch (a) {
    case 'go': return v.hoursToPost >= R.post.farHours ? 'Sal ya hacia la posta: está lejos.' : 'Sal ya hacia la posta.'
    case 'wrap': return isBaby(v)
      ? 'Pon al bebé en contacto piel con piel y cúbrelo bien.'
      : 'Abriga por capas y cubre cabeza, manos y pies.'
    case 'liquids': return isBaby(v) ? 'Da pecho más seguido.' : isChild(v) ? 'Da líquidos tibios o pecho más seguido.' : 'Da líquidos tibios seguido.'
    case 'recount': return 'Vuelve a contar la respiración en 1 hora.'
    case 'count': return 'Cuenta la respiración durante un minuto.'
    case 'remeasure': return 'Vuelve a medir la saturación en 1 hora.'
    case 'wind': return 'Protege la vivienda del viento: tapa rendijas y cierra la puerta.'
    case 'complete': return 'Completa las preguntas que faltan.'
    case 'review': return 'Vuelve a revisar en 2 horas.'
    case 'keep': return 'Mantén el abrigo y los líquidos tibios.'
    case 'tomorrow': return 'Vuelve a revisar mañana, o antes si algo cambia.'
  }
}

function travelAdvice(v: Visit): string[] {
  const cannotDrink = v.danger.noDrink || v.danger.vomits || v.danger.convulsions || v.danger.sleepy
  return [
    isBaby(v) ? 'Lleva al bebé en contacto piel con piel y bien cubierto.' : 'Abriga por capas y cubre cabeza, manos y pies.',
    cannotDrink ? 'No des nada por la boca si no puede tragar.'
      : isBaby(v) ? 'Da pecho en el camino, si puede lactar.'
      : 'Da sorbos de líquido tibio, solo si puede beber.',
    'No dejes sola a la persona.',
    'Avisa a la posta antes de salir, si hay señal.',
  ]
}

const ORDER: Record<Status, number> = { bad: 0, warn: 1, ok: 2 }

export function assess(v: Visit): Result {
  const rules: Rule[] = []
  const add = (id: string, status: Status, text: string, zones: BodyZone[], acts: Action[], env = false) =>
    rules.push({ id, status, text, zones, acts, env })

  // 0. Confianza: cuántas preguntas clave se respondieron. Los sensores opcionales no cuentan en contra.
  const answered = [v.cough, v.feverTouch, v.warmEnough, v.ateDrank, v.breaths].filter((x) => x !== null).length
  const total = R.confidence.total
  const level = answered >= R.confidence.highMin ? 'alta' : answered >= R.confidence.mediumMin ? 'media' : 'baja'
  const confidence: Result['confidence'] = { level, answered, total, text: CONFIDENCE_TEXT[level] }

  // 1. Señales de alarma: cualquiera deriva siempre.
  const alarms = DANGER_SIGNS.filter((k) => v.danger[k])
  for (const k of alarms) add(`alarma-${k}`, 'bad', `Señal de alarma: ${DANGER_TEXT[k]}.`, DANGER_ZONES[k], ['go', 'wrap'])

  // 2. Fiebre: manda el termómetro si existe; si no, el tacto.
  const feverFrom = isYoungInfant(v) ? R.temp.feverYoungInfant : R.temp.fever
  const feverByThermo = v.tempC !== null && v.tempC >= feverFrom
  const fever = v.tempC !== null ? feverByThermo : v.feverTouch === true

  // 3. Respiración contada, con umbral por edad y altitud.
  const fastFrom = fastBreathingFrom(v)
  if (v.breaths !== null && v.breaths >= fastFrom) {
    const count = `${num(v.breaths)} por minuto`
    if (v.breaths >= fastFrom + R.breathing.veryFastMargin) {
      add('respiracion-muy-rapida', 'bad', `Respira muy rápido: ${count}.`, ['chest'], ['go', 'wrap'])
    } else if (v.cough === true || fever) {
      const extra = v.cough === true && fever ? 'tos y fiebre' : v.cough === true ? 'tos' : 'fiebre'
      add('respiracion-rapida-con-senales', 'bad', `Respira rápido (${count}) y tiene ${extra}.`, fever ? ['chest', 'head'] : ['chest'], ['go', 'wrap'])
    } else {
      add('respiracion-rapida', 'warn', `Respira rápido: ${count}.`, ['chest'], ['recount'])
    }
  }

  // 4. Sensores opcionales.
  if (v.spo2 !== null) {
    const lim = spo2Limits(v.altitude)
    if (v.spo2 < lim.refer) add('saturacion-muy-baja', 'bad', `Saturación muy baja para esta altura: ${num(v.spo2)} %.`, ['chest'], ['go', 'wrap'])
    else if (v.spo2 < lim.watch) add('saturacion-baja', 'warn', `Saturación algo baja para esta altura: ${num(v.spo2)} %.`, ['chest'], ['remeasure'])
  }
  if (v.tempC !== null) {
    const t = `${num(v.tempC, 1)} °C`
    if (v.tempC < R.temp.coldRefer) add('cuerpo-muy-frio', 'bad', `Está muy frío: ${t}.`, ['hands', 'feet'], ['go', 'wrap'])
    else if (v.tempC < R.temp.coldWatch) add('cuerpo-frio', 'warn', `Tiene el cuerpo frío: ${t}.`, ['hands', 'feet'], ['wrap', 'liquids'])
  }
  if (fever) {
    const t = v.tempC !== null ? `: ${num(v.tempC, 1)} °C` : ' al tacto'
    if (isYoungInfant(v)) add('fiebre-bebe-pequeno', 'bad', `Bebé menor de 2 meses con fiebre${t}.`, ['head'], ['go', 'liquids'])
    else if (v.tempC !== null && v.tempC >= R.temp.highFever) add('fiebre-alta', 'bad', `Tiene fiebre alta${t}.`, ['head'], ['go', 'liquids'])
    else add('fiebre', 'warn', `Tiene fiebre${t}.`, ['head'], ['liquids', 'review'])
  }

  // 5. Lo observado.
  if (v.cough === true) add('tos', 'warn', 'Tiene tos.', ['chest'], [v.breaths === null ? 'count' : 'recount'])
  if (v.warmEnough === false) add('abrigo', 'warn', 'No tiene abrigo suficiente.', ['hands', 'feet'], ['wrap'])
  if (v.ateDrank === false) add('liquidos', 'warn', 'No comió ni tomó líquidos hoy.', [], ['liquids'])

  // 6. Frío del entorno. Con helada, niños pequeños y adultos mayores suben un nivel.
  if (v.cold === 'helada') {
    if (isVulnerable(v)) {
      add('helada', 'warn', v.kind === 'child' ? 'Hay helada y es un niño pequeño.' : 'Hay helada y es una persona mayor.', ['hands', 'feet'], ['wrap', 'wind'], true)
    } else add('helada', 'ok', 'Hay helada: cuidar el abrigo.', [], ['wrap', 'wind'], true)
  } else if (v.cold === 'frio') add('frio', 'ok', 'Hace frío: cuidar el abrigo.', [], ['wrap'], true)

  // 7. Cautela: varias señales juntas, pocos datos o posta lejos adelantan la derivación.
  const hasBad = rules.some((r) => r.status === 'bad')
  const warns = rules.filter((r) => r.status === 'warn')
  const personWarns = warns.filter((r) => !r.env)
  const far = v.hoursToPost >= R.post.farHours
  let reason = ''
  if (!hasBad && warns.length > 0) {
    const main = noDot(warns[0].text)
    if (warns.length >= R.manyWarnings) {
      add('varias-senales', 'bad', 'Hay varias señales juntas.', [], ['go', 'wrap'])
      reason = `${main} y hay otras señales a la vez.`
    } else if (level === 'baja' && personWarns.length > 0) {
      add('pocos-datos', 'bad', 'Hay una señal y faltan datos: mejor derivar.', [], ['go', 'wrap'])
      reason = `${noDot(personWarns[0].text)} y faltan datos: mejor derivar.`
    } else if (far && warns.length >= R.post.farWarnings) {
      add('posta-lejos', 'bad', 'Hay señales y la posta está lejos: mejor salir ya.', [], ['go', 'wrap'])
      reason = `${main} y la posta está lejos: mejor salir ya.`
    }
  }
  // Sin nada que vigilar pero casi sin datos: no se puede decir "atiendo yo".
  if (rules.every((r) => r.status === 'ok') && level === 'baja') {
    add('faltan-datos', 'warn', 'Faltan datos para decidir.', [], ['complete', v.breaths === null ? 'count' : 'review'])
  }

  // 8. Resultado.
  const sorted = rules.map((r, i) => ({ r, i })).sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status] || a.i - b.i).map((x) => x.r)
  const status: Status = alarms.length > 0 || sorted.some((r) => r.status === 'bad') ? 'bad' : sorted.some((r) => r.status === 'warn') ? 'warn' : 'ok'

  if (!reason) {
    if (alarms.length > 0) reason = `Hay una señal de alarma: ${DANGER_TEXT[alarms[0]]}.`
    else if (status === 'ok') {
      reason = v.cold === 'helada' ? 'No hay señales para vigilar, pero hay helada.'
        : v.cold === 'frio' ? 'No hay señales para vigilar, pero hace frío.'
        : 'No hay señales para vigilar.'
    }
    else reason = sorted[0].text
  }

  // Dos acciones distintas, en el orden de gravedad de los hallazgos.
  const wanted: Action[] = status === 'ok' ? ['keep', 'tomorrow'] : [
    ...(status === 'bad' ? (['go'] as Action[]) : []),
    ...sorted.filter((r) => r.status !== 'ok' || status !== 'bad').flatMap((r) => r.acts),
    ...(status === 'bad' ? (['wrap'] as Action[]) : (['review', 'liquids'] as Action[])),
  ]
  const texts = [...new Set(wanted.map((a) => actionText(a, v)))]
  const actions: [string, string] = [texts[0], texts[1]]

  const zones: Record<BodyZone, Status> = { head: 'ok', chest: 'ok', hands: 'ok', feet: 'ok' }
  for (const r of sorted) for (const z of r.zones) if (ORDER[r.status] < ORDER[zones[z]]) zones[z] = r.status

  return {
    status, label: STATUS_LABEL[status], reason, actions, confidence,
    findings: sorted.map(({ id, status: s, text }) => ({ id, status: s, text })),
    zones, onTheWay: status === 'bad' ? travelAdvice(v) : [],
  }
}

/**
 * Demostración "Simular helada": madrugada helada típica.
 * Poco abrigo y tos, respiración normal para la edad, sin fiebre y con líquidos.
 * No toca las señales de alarma ni los sensores.
 */
export function simulateFrost(v: Visit): Visit {
  return {
    ...v, cold: 'helada', cough: true, warmEnough: false, feverTouch: false, ateDrank: true,
    breaths: fastBreathingFrom(v) - 12,
  }
}

// ── Hoja de derivación y guion de radio ─────────────────────────────────────
function observed(v: Visit): string[] {
  const out: string[] = []
  if (v.cough !== null) out.push(v.cough ? 'tiene tos' : 'sin tos')
  if (v.feverTouch !== null) out.push(v.feverTouch ? 'fiebre al tacto' : 'sin fiebre al tacto')
  if (v.warmEnough !== null) out.push(v.warmEnough ? 'abrigo suficiente' : 'poco abrigo')
  if (v.ateDrank !== null) out.push(v.ateDrank ? 'comió y tomó líquidos' : 'no comió ni tomó líquidos')
  return out
}
const breathsText = (v: Visit) =>
  v.breaths === null ? 'No se contó' : `${num(v.breaths)} por minuto${v.breaths >= fastBreathingFrom(v) ? ' (rápida)' : ''}`

export function referral(v: Visit, r: Result): Referral {
  const alarms = DANGER_SIGNS.filter((k) => v.danger[k]).map((k) => cap(DANGER_TEXT[k]))
  const obs = observed(v)
  const rows: [string, string][] = [
    ['Alias', v.alias],
    ['Quién es', whoText(v)],
    ['Hora', v.startedAt],
    ['Lugar', `${DESTINATIONS[v.region].label}, unos ${num(v.altitude)} m`],
    ['Frío del entorno', COLD_LABEL[v.cold]],
    ['Señales de alarma', alarms.length > 0 ? alarms.join('; ') : 'Ninguna'],
    ['Lo observado', obs.length > 0 ? cap(obs.join('; ')) : 'Sin datos'],
    ['Respiración contada', breathsText(v)],
  ]
  if (v.tempC !== null) rows.push(['Temperatura', `${num(v.tempC, 1)} °C`])
  if (v.spo2 !== null) rows.push(['Saturación', `${num(v.spo2)} %`])
  rows.push(
    ['Decisión', r.label],
    ['Razón', r.reason],
    ['Confianza', `${cap(r.confidence.level)} (${r.confidence.answered} de ${r.confidence.total} preguntas)`],
    ['Distancia a la posta', hoursText(v.hoursToPost)],
  )
  return { title: r.status === 'bad' ? 'Hoja de derivación' : 'Hoja de visita', rows, onTheWay: r.onTheWay }
}

/** Cinco líneas cortas para dictar por radio o teléfono. */
export function radioScript(v: Visit, r: Result): string[] {
  const alarms = DANGER_SIGNS.filter((k) => v.danger[k]).map((k) => DANGER_TEXT[k])
  const obs = observed(v)
  const signs = alarms.length > 0 ? `Señales de alarma: ${alarms.join(', ')}.`
    : `Sin señales de alarma. ${obs.length > 0 ? `${cap(obs.join(', '))}.` : 'Sin más datos.'}`
  const sensors = [v.tempC !== null ? `Temperatura: ${num(v.tempC, 1)} grados.` : '', v.spo2 !== null ? `Saturación: ${num(v.spo2)}.` : ''].filter(Boolean).join(' ')
  const doing = r.status === 'bad'
    ? `En el camino: ${isBaby(v) ? 'piel con piel y bien cubierto' : 'abrigo por capas'}, no queda sola y aviso al salir.`
    : `Por ahora: ${r.actions.map((a) => noDot(a).toLowerCase()).join('; ')}.`
  return [
    `Persona: ${v.alias}. ${whoText(v)}.`,
    signs,
    `Respiración: ${breathsText(v).toLowerCase()}. Frío: ${COLD_LABEL[v.cold].toLowerCase()}.${sensors ? ` ${sensors}` : ''}`,
    `Decisión: ${r.label.toLowerCase()}. Posta a ${hoursText(v.hoursToPost)}.`,
    doing,
  ]
}

// ── 48 horas de frío (demostración, no pronóstico) ──────────────────────────
export function frostSeries(region: Destination, frost: boolean): FrostSeries {
  const f = R.frost
  const d = DESTINATIONS[region]
  const night = d.nightTemp ?? 5
  const range = (d.altitude ?? 0) >= f.highlandFrom ? f.dayRangeHighland : f.dayRangeLowland
  const startHour = 12
  const n = 48
  const rise = f.warmestHour - f.coldestHour // horas de subida
  const fall = 24 - rise // horas de bajada
  // Madrugada del pico: la última hora más fría de la serie.
  let peak = 0
  for (let i = 0; i < n; i++) if ((startHour + i) % 24 === f.coldestHour) peak = i

  const hours: string[] = []; const temp: number[] = []; const risk: number[] = []
  for (let i = 0; i < n; i++) {
    const h = (startHour + i) % 24
    const sinceCold = (h - f.coldestHour + 24) % 24
    const frac = sinceCold <= rise ? sinceCold / rise : 1 - (sinceCold - rise) / fall
    let t = night + range * (0.5 - 0.5 * Math.cos(Math.PI * frac))
    if (frost) t -= f.drop * Math.exp(-(((i - peak) / f.dropWidthHours) ** 2))
    const k = t >= night
      ? (f.riskNormalNight * (night + range - t)) / range
      : f.riskNormalNight + ((100 - f.riskNormalNight) * (night - t)) / f.drop
    hours.push(`${pad2(h)} h`)
    temp.push(Math.round(t * 10) / 10)
    risk.push(Math.round(clamp(k, 0, 100)))
  }
  return { hours, temp, risk }
}
