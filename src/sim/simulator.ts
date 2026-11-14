/**
 * Simulador de signos vitales. Funciones puras: mismo estado + misma semilla = mismo resultado.
 * Un paso (`step`) equivale a 1 minuto de la nave. La app da un paso por segundo real.
 */
import {
  DESTINATIONS, RULES, type Destination, type Status,
  statusMood, statusPercent, statusPulse, statusRadiation, statusResp, statusSleep,
  statusSpo2, statusSys, statusTemp,
} from '../config/rules'

export interface Vitals {
  pulse: number; sys: number; dia: number; spo2: number
  hydration: number; temp: number; resp: number
}
export interface History {
  sleep: number[] // 14 noches, horas
  hydration: number[] // 14 días, %
  sys: number[] // 14 días, mmHg
  pulse: number[] // 14 días, lpm
  exercise: number[] // 7 días, minutos
  radDaily: number[] // 14 días, mSv
}
export interface SimState {
  seed: number
  missionDay: number
  minuteOfDay: number
  destination: Destination
  vitals: Vitals
  noise: Vitals
  hydTarget: number
  sleepHours: number
  moodBoost: number
  mood: number
  exerciseWeek: number
  radRate: number // µSv/h
  radToday: number // mSv
  radTotal: number // mSv
  storm: boolean
  stormLeft: number // minutos
  sheltered: boolean
  fever: boolean
  highBP: boolean
  exercisingLeft: number // minutos
  recentTemp: number[]
  history: History
}

export type Scenario = 'storm' | 'badNight' | 'lowWater' | 'highBP' | 'fever'
export type MetricKey =
  | 'pulse' | 'bp' | 'spo2' | 'hydration' | 'temp' | 'resp'
  | 'sleep' | 'exercise' | 'radiation' | 'mood'

export const EXERCISE_GOAL_MIN = 60 // minutos por día
const STORM_MINUTES = 600

/** mulberry32: devuelve [valor 0..1, nueva semilla] */
export function rand(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Ritmo diario: -1 de madrugada (≈04:00), +1 por la tarde (≈16:00) */
export function circadian(minuteOfDay: number): number {
  return Math.sin(((minuteOfDay - 600) / 1440) * Math.PI * 2)
}

export function exerciseWeekPercent(exercise: number[]): number {
  const total = exercise.reduce((a, b) => a + b, 0)
  return clamp((total / (EXERCISE_GOAL_MIN * exercise.length)) * 100, 0, 100)
}

/** Valores hacia los que tiende el cuerpo en este momento (sin ruido). */
export function targets(s: SimState): Vitals & { mood: number; radRate: number } {
  const c = circadian(s.minuteOfDay)
  const sleepLost = Math.max(0, 7 - s.sleepHours)
  const waterLow = Math.max(0, RULES.percent.okMin - s.vitals.hydration)
  const ex = s.exercisingLeft > 0
  const base = DESTINATIONS[s.destination].radBase
  return {
    pulse: 66 + 5 * c + (s.fever ? 14 : 0) + waterLow * 0.25 + sleepLost * 1.5 + (ex ? 52 : 0),
    sys:
      110 + 3 * c + sleepLost * RULES.links.sysPerSleepHourLost +
      waterLow * RULES.links.sysPerHydrationPoint + (s.highBP ? 32 : 0) + (ex ? 14 : 0),
    dia: 71 + 2 * c + sleepLost * 2 + waterLow * 0.12 + (s.highBP ? 16 : 0),
    spo2: 97.6,
    hydration: s.hydTarget,
    temp: 36.6 + 0.25 * c + (s.fever ? 1.8 : 0) + (ex ? 0.3 : 0),
    resp: 14 + c + (s.fever ? 4 : 0) + (ex ? 11 : 0),
    mood: clamp(80 - sleepLost * RULES.links.moodPerSleepHourLost - (s.storm ? 8 : 0) + s.moodBoost, 0, 100),
    radRate: base * (s.storm ? (s.sheltered ? 1.4 : 9) : 1),
  }
}

export function createSim(seed = 7, destination: Destination = 'luna'): SimState {
  let sd = seed
  const next = () => { const [v, n] = rand(sd); sd = n; return v }
  const base = DESTINATIONS[destination].radBase
  const sleep = Array.from({ length: 14 }, () => +(6.9 + next() * 1.3).toFixed(1))
  sleep[13] = 7.6
  const exercise = Array.from({ length: 7 }, () => Math.round(44 + next() * 24))
  const history: History = {
    sleep,
    hydration: Array.from({ length: 14 }, () => Math.round(72 + next() * 10)),
    sys: sleep.map((h) => Math.round(110 + Math.max(0, 7 - h) * 5 + next() * 5)),
    pulse: Array.from({ length: 14 }, () => Math.round(63 + next() * 8)),
    exercise,
    radDaily: Array.from({ length: 14 }, () => +((base * 24) / 1000 * (0.9 + next() * 0.2)).toFixed(2)),
  }
  const missionDay = 23
  const s: SimState = {
    seed: sd,
    missionDay,
    minuteOfDay: 14 * 60 + 32,
    destination,
    vitals: { pulse: 68, sys: 112, dia: 72, spo2: 97.6, hydration: 78, temp: 36.7, resp: 15 },
    noise: { pulse: 0, sys: 0, dia: 0, spo2: 0, hydration: 0, temp: 0, resp: 0 },
    hydTarget: 78,
    sleepHours: sleep[13],
    moodBoost: 0,
    mood: 80,
    exerciseWeek: exerciseWeekPercent(exercise),
    radRate: base,
    radToday: +((base * 14.5) / 1000).toFixed(3),
    radTotal: +((base * 24 * missionDay) / 1000).toFixed(2),
    storm: false, stormLeft: 0, sheltered: false, fever: false, highBP: false,
    exercisingLeft: 0,
    recentTemp: Array.from({ length: 40 }, () => 36.7),
    history,
  }
  const t = targets(s)
  s.vitals = { pulse: t.pulse, sys: t.sys, dia: t.dia, spo2: t.spo2, hydration: 78, temp: t.temp, resp: t.resp }
  s.recentTemp = s.recentTemp.map(() => t.temp)
  return s
}

const NOISE: Vitals = { pulse: 1.1, sys: 1.2, dia: 0.9, spo2: 0.25, hydration: 0.15, temp: 0.03, resp: 0.5 }
const EASE: Vitals = { pulse: 0.3, sys: 0.25, dia: 0.25, spo2: 0.3, hydration: 0.3, temp: 0.22, resp: 0.3 }
const KEYS = Object.keys(NOISE) as (keyof Vitals)[]

/** Avanza un minuto de la nave. */
export function step(prev: SimState): SimState {
  const s: SimState = {
    ...prev, vitals: { ...prev.vitals }, noise: { ...prev.noise },
    history: { ...prev.history },
  }
  let sd = s.seed
  const next = () => { const [v, n] = rand(sd); sd = n; return v }

  s.minuteOfDay += 1
  if (s.minuteOfDay >= 1440) {
    // Nuevo día: se cierra el anterior y entra uno nuevo en el historial
    s.minuteOfDay = 0
    s.missionDay += 1
    const night = +(6.9 + next() * 1.2).toFixed(1)
    const h = s.history
    s.history = {
      sleep: [...h.sleep.slice(1), night],
      hydration: [...h.hydration.slice(1), Math.round(s.vitals.hydration)],
      sys: [...h.sys.slice(1), Math.round(s.vitals.sys)],
      pulse: [...h.pulse.slice(1), Math.round(s.vitals.pulse)],
      exercise: [...h.exercise.slice(1), 0],
      radDaily: [...h.radDaily.slice(1), 0],
    }
    s.sleepHours = night
    s.radToday = 0
    s.moodBoost = 0
  }
  if (s.exercisingLeft > 0) s.exercisingLeft -= 1
  if (s.storm) {
    s.stormLeft -= 1
    if (s.stormLeft <= 0) { s.storm = false; s.sheltered = false }
  }
  // El agua objetivo vuelve despacio a lo normal cuando se bebió de más
  if (s.hydTarget > 78) s.hydTarget = Math.max(78, s.hydTarget - 0.02)

  const t = targets(s)
  for (const k of KEYS) {
    s.noise[k] = s.noise[k] * 0.82 + (next() - 0.5) * 2 * NOISE[k]
    s.vitals[k] += (t[k] + s.noise[k] - s.vitals[k]) * EASE[k]
  }
  s.vitals.spo2 = clamp(s.vitals.spo2, 80, 100)
  s.vitals.hydration = clamp(s.vitals.hydration, 20, 100)
  s.mood += (t.mood - s.mood) * 0.25
  s.radRate += (t.radRate * (0.96 + next() * 0.08) - s.radRate) * 0.6

  const dose = s.radRate / 60 / 1000 // mSv en este minuto
  s.radToday += dose
  s.radTotal += dose
  const rd = s.history.radDaily.slice(); rd[rd.length - 1] = +s.radToday.toFixed(3); s.history.radDaily = rd
  const hs = s.history.sys.slice(); hs[hs.length - 1] = Math.round(s.vitals.sys); s.history.sys = hs
  const hp = s.history.pulse.slice()
  if (s.exercisingLeft <= 0) hp[hp.length - 1] = Math.round(s.vitals.pulse)
  s.history.pulse = hp
  const hh = s.history.hydration.slice(); hh[hh.length - 1] = Math.round(s.vitals.hydration); s.history.hydration = hh
  s.recentTemp = [...s.recentTemp.slice(1), s.vitals.temp]
  s.seed = sd
  return s
}

export function stepMany(s: SimState, n: number): SimState {
  for (let i = 0; i < n; i++) s = step(s)
  return s
}

function setSleep(s: SimState, hours: number): SimState {
  const sleep = s.history.sleep.slice()
  sleep[sleep.length - 1] = +hours.toFixed(1)
  return { ...s, sleepHours: +hours.toFixed(1), history: { ...s.history, sleep } }
}

export function applyScenario(s: SimState, sc: Scenario): SimState {
  switch (sc) {
    case 'storm': return { ...s, storm: true, stormLeft: STORM_MINUTES, sheltered: false }
    case 'badNight': return setSleep(s, 4.8)
    case 'lowWater': return { ...s, hydTarget: 41 }
    case 'highBP': return { ...s, highBP: true }
    case 'fever': return { ...s, fever: true }
  }
}

// ── Acciones de la tripulante ───────────────────────────────────────────────
export const drinkWater = (s: SimState): SimState =>
  ({ ...s, hydTarget: Math.min(90, s.hydTarget + (s.hydTarget < 60 ? 34 : 8)) })
export const goToShelter = (s: SimState): SimState => ({ ...s, sheltered: true })
export const rest = (s: SimState, hours = 0.6): SimState =>
  ({ ...setSleep(s, Math.min(8.5, s.sleepHours + hours)), highBP: false, moodBoost: s.moodBoost + 3 })
export const moodCheck = (s: SimState): SimState => ({ ...s, moodBoost: s.moodBoost + 8 })
export const notifyEarth = (s: SimState): SimState => ({ ...s, fever: false, highBP: false })
export function doExercise(s: SimState, minutes = 30): SimState {
  const exercise = s.history.exercise.slice()
  exercise[exercise.length - 1] += minutes
  return {
    ...s, exercisingLeft: minutes, exerciseWeek: exerciseWeekPercent(exercise),
    history: { ...s.history, exercise },
  }
}
export function setDestination(s: SimState, d: Destination): SimState {
  const k = DESTINATIONS[d].radBase / DESTINATIONS[s.destination].radBase
  return {
    ...s, destination: d, radRate: s.radRate * k, radToday: s.radToday * k, radTotal: s.radTotal * k,
    history: { ...s.history, radDaily: s.history.radDaily.map((v) => +(v * k).toFixed(3)) },
  }
}

// ── Evaluación ──────────────────────────────────────────────────────────────
export interface Reading { status: Status; value: number; text: string; unit: string; label: string }

const fmt = (v: number, d = 0) => v.toFixed(d).replace('.', ',')

export function evaluate(s: SimState): Record<MetricKey, Reading> {
  const v = s.vitals
  const base = DESTINATIONS[s.destination].radBase
  const ex = s.exercisingLeft > 0
  return {
    pulse: { label: 'Pulso', status: statusPulse(v.pulse, ex), value: v.pulse, text: fmt(v.pulse), unit: 'lpm' },
    bp: { label: 'Presión', status: statusSys(v.sys), value: v.sys, text: `${fmt(v.sys)}/${fmt(v.dia)}`, unit: 'mmHg' },
    spo2: { label: 'Oxígeno', status: statusSpo2(v.spo2), value: v.spo2, text: fmt(v.spo2), unit: '%' },
    hydration: { label: 'Hidratación', status: statusPercent(v.hydration), value: v.hydration, text: fmt(v.hydration), unit: '%' },
    temp: { label: 'Temperatura', status: statusTemp(v.temp), value: v.temp, text: fmt(v.temp, 1), unit: '°C' },
    resp: { label: 'Respiración', status: ex ? 'ok' : statusResp(v.resp), value: v.resp, text: fmt(v.resp), unit: 'rpm' },
    sleep: { label: 'Sueño', status: statusSleep(s.sleepHours), value: s.sleepHours, text: fmt(s.sleepHours, 1), unit: 'h' },
    exercise: { label: 'Ejercicio', status: statusPercent(s.exerciseWeek), value: s.exerciseWeek, text: fmt(s.exerciseWeek), unit: '%' },
    radiation: { label: 'Radiación', status: statusRadiation(s.radRate, base), value: s.radRate / base, text: fmt(s.radRate / base, 1), unit: '× normal' },
    mood: { label: 'Ánimo', status: statusMood(s.mood), value: s.mood, text: fmt(s.mood), unit: '/100' },
  }
}
