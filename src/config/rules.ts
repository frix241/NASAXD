/**
 * Reglas de estado de AstroTwin.
 * Único lugar donde viven los umbrales: cambia aquí y cambia toda la app.
 */
export type Status = 'ok' | 'warn' | 'bad'
export type Destination = 'leo' | 'luna' | 'marte' | 'sierraAlta' | 'sierraMedia' | 'selvaFriaje'

export const DESTINATIONS: Record<Destination, { label: string; radBase: number; altitude?: number; nightTemp?: number }> = {
  // radBase: dosis normal en µSv por hora para ese destino
  leo: { label: 'Órbita baja', radBase: 12 },
  luna: { label: 'Luna', radBase: 55 },
  marte: { label: 'Marte', radBase: 75 },
  // Perfil comunidad: altitud aproximada (m) y temperatura normal de madrugada (°C)
  sierraAlta: { label: 'Sierra alta (Caylloma)', radBase: 10, altitude: 4300, nightTemp: -4 },
  sierraMedia: { label: 'Sierra media (Cusco)', radBase: 10, altitude: 3400, nightTemp: 2 },
  selvaFriaje: { label: 'Selva con friaje (Iquitos)', radBase: 10, altitude: 100, nightTemp: 21 },
}

export const RULES = {
  sys: { warn: 120, bad: 140 }, // mmHg
  pulse: { okMax: 85, warnMax: 100 }, // lpm en reposo
  spo2: { okMin: 95, warnMin: 90 }, // %
  temp: { okMin: 36.0, okMax: 37.5, warnMax: 38.0, badMin: 35.5 }, // °C
  sleep: { okMin: 7, warnMin: 6 }, // horas
  percent: { okMin: 70, warnMin: 45 }, // hidratación y ejercicio semanal
  radiation: { warn: 2, bad: 5 }, // veces el nivel base
  // Las dos siguientes no vienen en el reto; son valores propios y prudentes.
  resp: { okMin: 12, okMax: 20, warnMin: 10, warnMax: 24 }, // rpm
  mood: { okMin: 60, warnMin: 40 }, // 0–100
  glucose: { okMin: 70, okMax: 99, warnMax: 125, badMin: 54 }, // mg/dL en ayunas (referencia general)
  // Conexiones entre medidas
  links: {
    sysPerSleepHourLost: 5, // mmHg por cada hora dormida de menos (bajo 7 h)
    moodPerSleepHourLost: 9, // puntos de ánimo por cada hora de menos
    sysPerHydrationPoint: 0.3, // mmHg por cada punto de agua bajo 70 %
  },
  body: {
    muscleLossPerMonth: 1.5, // % al mes sin ejercicio
    boneLossPerMonth: 1.0, // % al mes sin ejercicio
    routineProtection: 0.8, // parte de la pérdida que evita la rutina completa
  },
} as const

const r1 = (v: number) => Math.round(v * 10) / 10

export function statusSys(v: number): Status {
  const x = Math.round(v)
  return x >= RULES.sys.bad ? 'bad' : x >= RULES.sys.warn ? 'warn' : 'ok'
}
export function statusPulse(v: number, exercising = false): Status {
  if (exercising) return 'ok'
  const x = Math.round(v)
  return x > RULES.pulse.warnMax ? 'bad' : x > RULES.pulse.okMax ? 'warn' : 'ok'
}
export function statusSpo2(v: number): Status {
  const x = Math.round(v)
  return x < RULES.spo2.warnMin ? 'bad' : x < RULES.spo2.okMin ? 'warn' : 'ok'
}
export function statusTemp(v: number): Status {
  const x = r1(v)
  if (x > RULES.temp.warnMax || x < RULES.temp.badMin) return 'bad'
  if (x > RULES.temp.okMax || x < RULES.temp.okMin) return 'warn'
  return 'ok'
}
export function statusSleep(h: number): Status {
  const x = r1(h)
  return x < RULES.sleep.warnMin ? 'bad' : x < RULES.sleep.okMin ? 'warn' : 'ok'
}
export function statusPercent(v: number): Status {
  const x = Math.round(v)
  return x < RULES.percent.warnMin ? 'bad' : x < RULES.percent.okMin ? 'warn' : 'ok'
}
export function statusRadiation(rate: number, base: number): Status {
  const x = r1(rate / base)
  return x > RULES.radiation.bad ? 'bad' : x >= RULES.radiation.warn ? 'warn' : 'ok'
}
export function statusResp(v: number): Status {
  const x = Math.round(v)
  if (x > RULES.resp.warnMax || x < RULES.resp.warnMin) return 'bad'
  if (x > RULES.resp.okMax || x < RULES.resp.okMin) return 'warn'
  return 'ok'
}
export function statusGlucose(v: number): Status {
  const x = Math.round(v); const g = RULES.glucose
  if (x > g.warnMax || x < g.badMin) return 'bad'
  if (x > g.okMax || x < g.okMin) return 'warn'
  return 'ok'
}
export function statusMood(v: number): Status {
  const x = Math.round(v)
  return x < RULES.mood.warnMin ? 'bad' : x < RULES.mood.okMin ? 'warn' : 'ok'
}

export const STATUS_WORD: Record<Status, string> = { ok: 'Bien', warn: 'Vigilar', bad: 'Atender' }
export const STATUS_SYMBOL: Record<Status, string> = { ok: '✓', warn: '!', bad: '✕' }
export const worst = (list: Status[]): Status =>
  list.includes('bad') ? 'bad' : list.includes('warn') ? 'warn' : 'ok'

/** % que queda de músculo o hueso tras `months` meses. adherence: 0 (nada) a 1 (rutina completa). */
export function bodyRemaining(kind: 'muscle' | 'bone', months: number, adherence: number): number {
  const base = kind === 'muscle' ? RULES.body.muscleLossPerMonth : RULES.body.boneLossPerMonth
  const a = Math.min(1, Math.max(0, adherence))
  const loss = (base / 100) * (1 - RULES.body.routineProtection * a)
  return 100 * Math.pow(1 - loss, months)
}
