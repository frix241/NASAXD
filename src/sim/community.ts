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
  noDrink: 'cannot drink or breastfeed',
  vomits: 'vomits everything',
  convulsions: 'had a seizure',
  sleepy: 'is very drowsy or cannot be woken',
  breathless: 'has difficulty breathing',
  chestIndrawing: 'chest pulls in while breathing',
  blueLips: 'has bluish lips',
}
const DANGER_ZONES: Record<DangerSign, BodyZone[]> = {
  noDrink: ['head'], vomits: ['head'], convulsions: ['head'], sleepy: ['head'],
  breathless: ['chest'], chestIndrawing: ['chest'], blueLips: ['chest', 'head'],
}

export const STATUS_LABEL: Record<Status, string> = { ok: 'I will provide care', warn: 'Monitor and check again', bad: 'Refer to the health post' }
export const COLD_LABEL: Record<Cold, string> = { normal: 'Normal', frio: 'Cold', helada: 'Frost' }
const CONFIDENCE_TEXT = {
  baja: 'There is limited information, so I will be more cautious.',
  media: 'Some information is available; check what is missing.',
  alta: 'There is enough information.',
} as const

// ── Ayudas ──────────────────────────────────────────────────────────────────
const num = (n: number, decimals = 0) => n.toFixed(decimals)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const noDot = (s: string) => s.replace(/\.$/, '')
const pad2 = (n: number) => String(n).padStart(2, '0')
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const isChild = (v: Visit) => v.kind === 'child'
const isBaby = (v: Visit) => isChild(v) && v.ageMonths < R.babyMonths
const isYoungInfant = (v: Visit) => isChild(v) && v.ageMonths < R.youngInfantMonths
const isVulnerable = (v: Visit) => v.kind === 'child' || v.kind === 'elder'
const hoursText = (h: number) => (h === 1 ? '1 hour' : `${num(h, Number.isInteger(h) ? 0 : 1)} hours`)

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
  if (v.kind === 'elder') return 'Older adult'
  if (v.kind === 'adult') return 'Adult'
  const m = Math.max(0, Math.round(v.ageMonths))
  if (m < 1) return 'Baby under 1 month old'
  if (m < 12) return `${m}-month-old baby`
  const y = Math.floor(m / 12)
  return `${y}-year-old child`
}

export function newVisit(region: Destination = 'sierraAlta'): Visit {
  const now = new Date()
  return {
    alias: 'Person 1', kind: 'child', ageMonths: 24, danger: noDanger(), cough: null, feverTouch: null, warmEnough: null,
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
    case 'go': return v.hoursToPost >= R.post.farHours ? 'Leave for the health post now; it is far away.' : 'Leave for the health post now.'
    case 'wrap': return isBaby(v)
      ? 'Hold the baby skin-to-skin and keep them well covered.'
      : 'Dress in layers and cover the head, hands, and feet.'
    case 'liquids': return isBaby(v) ? 'Breastfeed more often.' : isChild(v) ? 'Offer warm fluids or breastfeed more often.' : 'Offer warm fluids often.'
    case 'recount': return 'Count breaths again in 1 hour.'
    case 'count': return 'Count breaths for one full minute.'
    case 'remeasure': return 'Measure oxygen saturation again in 1 hour.'
    case 'wind': return 'Protect the home from wind: seal gaps and close the door.'
    case 'complete': return 'Answer the remaining questions.'
    case 'review': return 'Check again in 2 hours.'
    case 'keep': return 'Keep the person warm and offer warm fluids.'
    case 'tomorrow': return 'Check again tomorrow, or sooner if anything changes.'
  }
}

function travelAdvice(v: Visit): string[] {
  const cannotDrink = v.danger.noDrink || v.danger.vomits || v.danger.convulsions || v.danger.sleepy
  return [
    isBaby(v) ? 'Carry the baby skin-to-skin and well covered.' : 'Dress in layers and cover the head, hands, and feet.',
    cannotDrink ? 'Do not give anything by mouth if the person cannot swallow.'
      : isBaby(v) ? 'Breastfeed on the way, if possible.'
      : 'Offer small sips of warm fluid, only if the person can drink.',
    'Do not leave the person alone.',
    'Notify the health post before leaving, if there is a signal.',
  ]
}

const ORDER: Record<Status, number> = { bad: 0, warn: 1, ok: 2 }

export function assess(v: Visit): Result {
  const rules: Rule[] = []
  const add = (id: string, status: Status, text: string, zones: BodyZone[], acts: Action[], env = false) =>
    rules.push({ id, status, text, zones, acts, env })

  // 0. Confidence: number of key questions answered. Optional sensors do not count against it.
  const answered = [v.cough, v.feverTouch, v.warmEnough, v.ateDrank, v.breaths].filter((x) => x !== null).length
  const total = R.confidence.total
  const level = answered >= R.confidence.highMin ? 'alta' : answered >= R.confidence.mediumMin ? 'media' : 'baja'
  const confidence: Result['confidence'] = { level, answered, total, text: CONFIDENCE_TEXT[level] }

  // 1. Warning signs: any one of them always triggers referral.
  const alarms = DANGER_SIGNS.filter((k) => v.danger[k])
  for (const k of alarms) add(`alarma-${k}`, 'bad', `Warning sign: ${DANGER_TEXT[k]}.`, DANGER_ZONES[k], ['go', 'wrap'])

  // 2. Fever: use the thermometer when available; otherwise use touch.
  const feverFrom = isYoungInfant(v) ? R.temp.feverYoungInfant : R.temp.fever
  const feverByThermo = v.tempC !== null && v.tempC >= feverFrom
  const fever = v.tempC !== null ? feverByThermo : v.feverTouch === true

  // 3. Counted breathing, with thresholds based on age and elevation.
  const fastFrom = fastBreathingFrom(v)
  if (v.breaths !== null && v.breaths >= fastFrom) {
    const count = `${num(v.breaths)} breaths per minute`
    if (v.breaths >= fastFrom + R.breathing.veryFastMargin) {
      add('respiracion-muy-rapida', 'bad', `Breathing is very fast: ${count}.`, ['chest'], ['go', 'wrap'])
    } else if (v.cough === true || fever) {
      const extra = v.cough === true && fever ? 'a cough and fever' : v.cough === true ? 'a cough' : 'a fever'
      add('respiracion-rapida-con-senales', 'bad', `Breathing is fast (${count}) with ${extra}.`, fever ? ['chest', 'head'] : ['chest'], ['go', 'wrap'])
    } else {
      add('respiracion-rapida', 'warn', `Breathing is fast: ${count}.`, ['chest'], ['recount'])
    }
  }

  // 4. Optional sensors.
  if (v.spo2 !== null) {
    const lim = spo2Limits(v.altitude)
    if (v.spo2 < lim.refer) add('saturacion-muy-baja', 'bad', `Oxygen saturation is very low for this elevation: ${num(v.spo2)}%.`, ['chest'], ['go', 'wrap'])
    else if (v.spo2 < lim.watch) add('saturacion-baja', 'warn', `Oxygen saturation is slightly low for this elevation: ${num(v.spo2)}%.`, ['chest'], ['remeasure'])
  }
  if (v.tempC !== null) {
    const t = `${num(v.tempC, 1)} °C`
    if (v.tempC < R.temp.coldRefer) add('cuerpo-muy-frio', 'bad', `Body temperature is very low: ${t}.`, ['hands', 'feet'], ['go', 'wrap'])
    else if (v.tempC < R.temp.coldWatch) add('cuerpo-frio', 'warn', `Body temperature is low: ${t}.`, ['hands', 'feet'], ['wrap', 'liquids'])
  }
  if (fever) {
    const t = v.tempC !== null ? `: ${num(v.tempC, 1)} °C` : ' to the touch'
    if (isYoungInfant(v)) add('fiebre-bebe-pequeno', 'bad', `A baby under 2 months has a fever${t}.`, ['head'], ['go', 'liquids'])
    else if (v.tempC !== null && v.tempC >= R.temp.highFever) add('fiebre-alta', 'bad', `The person has a high fever${t}.`, ['head'], ['go', 'liquids'])
    else add('fiebre', 'warn', `The person has a fever${t}.`, ['head'], ['liquids', 'review'])
  }

  // 5. Observations.
  if (v.cough === true) add('tos', 'warn', 'The person has a cough.', ['chest'], [v.breaths === null ? 'count' : 'recount'])
  if (v.warmEnough === false) add('abrigo', 'warn', 'The person does not have enough warm clothing.', ['hands', 'feet'], ['wrap'])
  if (v.ateDrank === false) add('liquidos', 'warn', 'The person has not eaten or had fluids today.', [], ['liquids'])

  // 6. Environmental cold. Frost increases the risk level for young children and older adults.
  if (v.cold === 'helada') {
    if (isVulnerable(v)) {
      add('helada', 'warn', v.kind === 'child' ? 'Frost is expected and this is a young child.' : 'Frost is expected and this is an older adult.', ['hands', 'feet'], ['wrap', 'wind'], true)
    } else add('helada', 'ok', 'Frost is expected: keep warm.', [], ['wrap', 'wind'], true)
  } else if (v.cold === 'frio') add('frio', 'ok', 'It is cold: keep warm.', [], ['wrap'], true)

  // 7. Caution: multiple signs, limited information, or a distant health post can trigger earlier referral.
  const hasBad = rules.some((r) => r.status === 'bad')
  const warns = rules.filter((r) => r.status === 'warn')
  const personWarns = warns.filter((r) => !r.env)
  const far = v.hoursToPost >= R.post.farHours
  let reason = ''
  if (!hasBad && warns.length > 0) {
    const main = noDot(warns[0].text)
    if (warns.length >= R.manyWarnings) {
      add('varias-senales', 'bad', 'Several warning signs are present together.', [], ['go', 'wrap'])
      reason = `${main}, with other warning signs at the same time.`
    } else if (level === 'baja' && personWarns.length > 0) {
      add('pocos-datos', 'bad', 'There is a warning sign and information is missing: referral is safer.', [], ['go', 'wrap'])
      reason = `${noDot(personWarns[0].text)} Information is missing, so referral is safer.`
    } else if (far && warns.length >= R.post.farWarnings) {
      add('posta-lejos', 'bad', 'There are warning signs and the health post is far away: leave now.', [], ['go', 'wrap'])
      reason = `${main}, and the health post is far away: leave now.`
    }
  }
  // With no signs to monitor but very little information, "I will provide care" is not appropriate.
  if (rules.every((r) => r.status === 'ok') && level === 'baja') {
    add('faltan-datos', 'warn', 'More information is needed to decide.', [], ['complete', v.breaths === null ? 'count' : 'review'])
  }

  // 8. Result.
  const sorted = rules.map((r, i) => ({ r, i })).sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status] || a.i - b.i).map((x) => x.r)
  const status: Status = alarms.length > 0 || sorted.some((r) => r.status === 'bad') ? 'bad' : sorted.some((r) => r.status === 'warn') ? 'warn' : 'ok'

  if (!reason) {
    if (alarms.length > 0) reason = `There is a warning sign: ${DANGER_TEXT[alarms[0]]}.`
    else if (status === 'ok') {
      reason = v.cold === 'helada' ? 'There are no warning signs, but frost is expected.'
        : v.cold === 'frio' ? 'There are no warning signs, but it is cold.'
        : 'There are no warning signs to monitor.'
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
  if (v.cough !== null) out.push(v.cough ? 'has a cough' : 'no cough')
  if (v.feverTouch !== null) out.push(v.feverTouch ? 'feels feverish to the touch' : 'does not feel feverish to the touch')
  if (v.warmEnough !== null) out.push(v.warmEnough ? 'enough warm clothing' : 'not enough warm clothing')
  if (v.ateDrank !== null) out.push(v.ateDrank ? 'ate and drank fluids' : 'did not eat or drink fluids')
  return out
}
const breathsText = (v: Visit) =>
  v.breaths === null ? 'Not counted' : `${num(v.breaths)} per minute${v.breaths >= fastBreathingFrom(v) ? ' (fast)' : ''}`

export function referral(v: Visit, r: Result): Referral {
  const alarms = DANGER_SIGNS.filter((k) => v.danger[k]).map((k) => cap(DANGER_TEXT[k]))
  const obs = observed(v)
  const rows: [string, string][] = [
    ['Alias', v.alias],
    ['Person', whoText(v)],
    ['Time', v.startedAt],
    ['Location', `${DESTINATIONS[v.region].label}, about ${num(v.altitude)} m`],
    ['Environmental cold', COLD_LABEL[v.cold]],
    ['Warning signs', alarms.length > 0 ? alarms.join('; ') : 'None'],
    ['Observations', obs.length > 0 ? cap(obs.join('; ')) : 'No data'],
    ['Counted breaths', breathsText(v)],
  ]
  if (v.tempC !== null) rows.push(['Temperature', `${num(v.tempC, 1)} °C`])
  if (v.spo2 !== null) rows.push(['Oxygen saturation', `${num(v.spo2)}%`])
  rows.push(
    ['Decision', r.label],
    ['Reason', r.reason],
    ['Confidence', `${({ alta: 'High', media: 'Medium', baja: 'Low' } as const)[r.confidence.level]} (${r.confidence.answered} of ${r.confidence.total} questions)`],
    ['Distance to health post', hoursText(v.hoursToPost)],
  )
  return { title: r.status === 'bad' ? 'Referral form' : 'Visit form', rows, onTheWay: r.onTheWay }
}

/** Cinco líneas cortas para dictar por radio o teléfono. */
export function radioScript(v: Visit, r: Result): string[] {
  const alarms = DANGER_SIGNS.filter((k) => v.danger[k]).map((k) => DANGER_TEXT[k])
  const obs = observed(v)
  const signs = alarms.length > 0 ? `Warning signs: ${alarms.join(', ')}.`
    : `No warning signs. ${obs.length > 0 ? `${cap(obs.join(', '))}.` : 'No further information.'}`
  const sensors = [v.tempC !== null ? `Temperature: ${num(v.tempC, 1)} degrees.` : '', v.spo2 !== null ? `Oxygen saturation: ${num(v.spo2)}%.` : ''].filter(Boolean).join(' ')
  const doing = r.status === 'bad'
    ? `On the way: ${isBaby(v) ? 'skin-to-skin and well covered' : 'dress in layers'}, do not leave the person alone, and notify the health post when leaving.`
    : `For now: ${r.actions.map((a) => noDot(a).toLowerCase()).join('; ')}.`
  return [
    `Person: ${v.alias}. ${whoText(v)}.`,
    signs,
    `Breathing: ${breathsText(v).toLowerCase()}. Cold: ${COLD_LABEL[v.cold].toLowerCase()}.${sensors ? ` ${sensors}` : ''}`,
    `Decision: ${r.label.toLowerCase()}. Health post is ${hoursText(v.hoursToPost)} away.`,
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
