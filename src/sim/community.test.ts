import { describe, expect, it } from 'vitest'
import { COMMUNITY_RULES, PENDING_VALIDATION } from '../config/communityRules'
import { DESTINATIONS } from '../config/rules'
import {
  DANGER_SIGNS, assess, fastBreathingFrom, frostSeries, newVisit, radioScript, referral, simulateFrost, spo2Limits,
} from './community'
import type { Result, Visit } from './community'

/** Visita con todas las preguntas respondidas y nada que vigilar. */
const healthy = (over: Partial<Visit> = {}): Visit => ({
  ...newVisit('sierraAlta'), cough: false, feverTouch: false, warmEnough: true, ateDrank: true, breaths: 30, ...over,
})
const withAlarm = (v: Visit, k: (typeof DANGER_SIGNS)[number]): Visit => ({ ...v, danger: { ...v.danger, [k]: true } })

describe('newVisit', () => {
  it('toma la altitud de la región y empieza sin respuestas', () => {
    for (const region of ['sierraAlta', 'sierraMedia', 'selvaFriaje'] as const) {
      const v = newVisit(region)
      expect(v.altitude).toBe(DESTINATIONS[region].altitude)
      expect(v.region).toBe(region)
    }
    const v = newVisit()
    expect(v.alias).toBe('Person 1')
    expect(v.startedAt).toMatch(/^\d{2}:\d{2}$/)
    expect([v.cough, v.feverTouch, v.warmEnough, v.ateDrank, v.breaths, v.tempC, v.spo2]).toEqual(Array(7).fill(null))
  })
})

describe('señales de alarma', () => {
  it('cualquier alarma deriva siempre, aunque todo lo demás esté sin responder', () => {
    for (const k of DANGER_SIGNS) {
      for (const kind of ['child', 'adult', 'elder'] as const) {
        const r = assess(withAlarm({ ...newVisit(), kind }, k))
        expect(r.status).toBe('bad')
        expect(r.label).toBe('Refer to the health post')
        expect(r.findings[0].id).toBe(`alarma-${k}`)
        expect(r.onTheWay.length).toBeGreaterThan(0)
      }
    }
  })
  it('una alarma manda aunque lo demás esté bien', () => {
    expect(assess(withAlarm(healthy(), 'sleepy')).status).toBe('bad')
  })
  it('pinta la zona de la señal', () => {
    expect(assess(withAlarm(newVisit(), 'chestIndrawing')).zones.chest).toBe('bad')
    expect(assess(withAlarm(newVisit(), 'convulsions')).zones.head).toBe('bad')
  })
})

describe('respiración contada', () => {
  it('el umbral cambia con la edad', () => {
    const at = (kind: Visit['kind'], ageMonths: number) => fastBreathingFrom({ kind, ageMonths, altitude: 100 })
    expect(at('child', 1)).toBe(60)
    expect(at('child', 2)).toBe(50)
    expect(at('child', 11)).toBe(50)
    expect(at('child', 12)).toBe(40)
    expect(at('child', 59)).toBe(40)
    expect(at('adult', 0)).toBe(25)
    expect(at('elder', 0)).toBe(25)
  })
  it('el umbral sube con la altitud', () => {
    const at = (altitude: number) => fastBreathingFrom({ kind: 'child', ageMonths: 24, altitude })
    expect(at(100)).toBe(40)
    expect(at(3400)).toBe(40 + COMMUNITY_RULES.breathing.altitude.midAdd)
    expect(at(4300)).toBe(40 + COMMUNITY_RULES.breathing.altitude.highAdd)
  })
  it('justo en el umbral ya es respiración rápida; uno menos, no', () => {
    const low = healthy({ altitude: 100 })
    expect(assess({ ...low, breaths: 39 }).status).toBe('ok')
    const fast = assess({ ...low, breaths: 40 })
    expect(fast.status).toBe('warn')
    expect(fast.findings[0].id).toBe('respiracion-rapida')
    expect(fast.zones.chest).toBe('warn')
  })
  it('la misma cuenta puede ser rápida abajo y normal en altura', () => {
    expect(assess(healthy({ altitude: 100, breaths: 45 })).status).toBe('warn')
    expect(assess(healthy({ altitude: 4300, breaths: 45 })).status).toBe('ok')
  })
  it('la misma cuenta puede ser normal en un bebé y rápida en un niño mayor', () => {
    expect(assess(healthy({ altitude: 100, ageMonths: 6, breaths: 45 })).status).toBe('ok')
    expect(assess(healthy({ altitude: 100, ageMonths: 36, breaths: 45 })).status).toBe('warn')
  })
  it('respiración rápida con tos, o muy rápida, deriva', () => {
    expect(assess(healthy({ altitude: 100, breaths: 42, cough: true })).status).toBe('bad')
    expect(assess(healthy({ altitude: 100, breaths: 40 + COMMUNITY_RULES.breathing.veryFastMargin })).status).toBe('bad')
  })
})

describe('sensores opcionales', () => {
  it('los límites de saturación bajan con la altitud', () => {
    expect(spo2Limits(100)).toEqual({ watch: 92, refer: 90 })
    expect(spo2Limits(3400)).toEqual({ watch: 88, refer: 85 })
    expect(spo2Limits(4300)).toEqual({ watch: 85, refer: 82 })
  })
  it('la misma saturación se lee distinto según la altitud', () => {
    expect(assess(healthy({ altitude: 100, spo2: 87 })).status).toBe('bad')
    expect(assess(healthy({ altitude: 3400, spo2: 87 })).status).toBe('warn')
    expect(assess(healthy({ altitude: 4300, spo2: 87 })).status).toBe('ok')
    expect(assess(healthy({ altitude: 4300, spo2: 81 })).status).toBe('bad')
  })
  it('termómetro: fiebre, frío en el cuerpo y bebé pequeño', () => {
    expect(assess(healthy({ tempC: 37.9 })).status).toBe('ok')
    const fever = assess(healthy({ tempC: 38.0 }))
    expect(fever.status).toBe('warn')
    expect(fever.zones.head).toBe('warn')
    expect(assess(healthy({ tempC: 35.9 })).status).toBe('warn')
    const cold = assess(healthy({ tempC: 35.4 }))
    expect(cold.status).toBe('bad')
    expect(cold.zones.hands).toBe('bad')
    expect(cold.zones.feet).toBe('bad')
    expect(assess(healthy({ ageMonths: 1, breaths: 40, tempC: 37.5 })).status).toBe('bad')
    expect(assess(healthy({ ageMonths: 6, breaths: 40, tempC: 37.5 })).status).toBe('ok')
  })
  it('no tener sensores no baja la confianza', () => {
    expect(assess(healthy()).confidence).toMatchObject({ level: 'alta', answered: 5, total: 5 })
  })
})

describe('incertidumbre', () => {
  it('la confianza depende de cuántas preguntas se respondieron', () => {
    expect(assess(newVisit()).confidence).toMatchObject({ level: 'baja', answered: 0, text: 'There is limited information, so I will be more cautious.' })
    expect(assess({ ...newVisit(), cough: false, ateDrank: true }).confidence).toMatchObject({ level: 'media', text: 'Some information is available; check what is missing.' })
    expect(assess(healthy()).confidence).toMatchObject({ level: 'alta', text: 'There is enough information.' })
  })
  it('con pocos datos deriva antes que con datos completos', () => {
    const few = assess({ ...newVisit(), cough: true })
    expect(few.confidence.level).toBe('baja')
    expect(few.status).toBe('bad')
    expect(few.findings[0].id).toBe('pocos-datos')
    const full = assess(healthy({ cough: true }))
    expect(full.confidence.level).toBe('alta')
    expect(full.status).toBe('warn')
  })
  it('sin ningún dato no dice "atiendo yo"', () => {
    const r = assess(newVisit())
    expect(r.status).toBe('warn')
    expect(r.findings[0].id).toBe('faltan-datos')
  })
  it('la posta lejos adelanta la derivación', () => {
    const v = healthy({ cough: true, warmEnough: false })
    const near = assess({ ...v, hoursToPost: 1 })
    const far = assess({ ...v, hoursToPost: COMMUNITY_RULES.post.farHours })
    expect(near.status).toBe('warn')
    expect(far.status).toBe('bad')
    expect(far.findings[0].id).toBe('posta-lejos')
    expect(far.actions[0]).toContain('far away')
  })
})

describe('frío del entorno y vulnerabilidad', () => {
  it('con helada, niño pequeño y adulto mayor suben un nivel; el adulto no', () => {
    expect(assess(healthy({ kind: 'adult', breaths: 18, cold: 'helada' })).status).toBe('ok')
    expect(assess(healthy({ kind: 'elder', breaths: 18, cold: 'helada' })).status).toBe('warn')
    const child = assess(healthy({ cold: 'helada' }))
    expect(child.status).toBe('warn')
    expect(child.zones.hands).toBe('warn')
    expect(child.zones.feet).toBe('warn')
  })
  it('sin nada que vigilar: atiendo yo', () => {
    const r = assess(healthy())
    expect(r.status).toBe('ok')
    expect(r.label).toBe('I will provide care')
    expect(r.onTheWay).toEqual([])
    expect(r.zones).toEqual({ head: 'ok', chest: 'ok', hands: 'ok', feet: 'ok' })
  })
  it('los hallazgos van del más grave al menos grave', () => {
    const order = { bad: 0, warn: 1, ok: 2 }
    const r = assess(withAlarm(healthy({ cough: true, warmEnough: false, cold: 'frio' }), 'vomits'))
    const ranks = r.findings.map((f) => order[f.status])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(r.findings.map((f) => f.id)).size).toBe(r.findings.length)
  })
})

describe('simular helada', () => {
  it('un niño menor de 5 pasa a vigilar', () => {
    const v = simulateFrost(newVisit())
    expect(v.cold).toBe('helada')
    const r = assess(v)
    expect(r.status).toBe('warn')
    expect(r.label).toBe('Monitor and check again')
    expect(r.onTheWay).toEqual([])
  })
  it('funciona en las tres regiones', () => {
    for (const region of ['sierraAlta', 'sierraMedia', 'selvaFriaje'] as const) {
      expect(assess(simulateFrost(newVisit(region))).status).toBe('warn')
    }
  })
  it('con cualquier señal de alarma pasa a derivar', () => {
    for (const k of DANGER_SIGNS) expect(assess(withAlarm(simulateFrost(newVisit()), k)).status).toBe('bad')
  })
})

/** Casos variados para revisar las salidas de texto. */
const CASES: Visit[] = [
  newVisit(), healthy(), simulateFrost(newVisit()), simulateFrost(newVisit('selvaFriaje')),
  ...DANGER_SIGNS.map((k) => withAlarm(newVisit(), k)),
  withAlarm(simulateFrost({ ...newVisit(), ageMonths: 3 }), 'noDrink'),
  { ...newVisit(), cough: true },
  { ...newVisit(), cold: 'helada' },
  { ...newVisit(), breaths: 30 },
  healthy({ cough: true, warmEnough: false, hoursToPost: 5 }),
  healthy({ cough: true, feverTouch: true, warmEnough: false, ateDrank: false, cold: 'helada' }),
  healthy({ altitude: 100, breaths: 44, feverTouch: true }),
  healthy({ altitude: 100, breaths: 70 }),
  healthy({ ageMonths: 1, breaths: 40, feverTouch: true }),
  healthy({ ageMonths: 8, breaths: 40, warmEnough: false, cold: 'frio' }),
  healthy({ tempC: 39.8, spo2: 80 }),
  healthy({ tempC: 35.2 }),
  healthy({ tempC: 35.8, spo2: 84 }),
  healthy({ kind: 'elder', breaths: 26, ateDrank: false, cold: 'helada', hoursToPost: 1.5 }),
  healthy({ kind: 'adult', breaths: 18, cold: 'helada' }),
  healthy({ kind: 'adult', breaths: 18, cold: 'frio', hoursToPost: 1 }),
]
const LABELS = { ok: 'I will provide care', warn: 'Monitor and check again', bad: 'Refer to the health post' }
const allText = (v: Visit, r: Result): string[] => {
  const sheet = referral(v, r)
  return [
    r.label, r.reason, ...r.actions, r.confidence.text, ...r.findings.map((f) => f.text), ...r.onTheWay,
    sheet.title, ...sheet.rows.flat(), ...sheet.onTheWay, ...radioScript(v, r),
  ]
}

describe('salidas', () => {
  it('siempre da exactamente dos acciones distintas y una razón', () => {
    for (const v of CASES) {
      const r = assess(v)
      expect(r.actions).toHaveLength(2)
      expect(r.actions[0]).toBeTruthy()
      expect(r.actions[1]).toBeTruthy()
      expect(r.actions[0]).not.toBe(r.actions[1])
      expect(r.reason.length).toBeGreaterThan(5)
      expect(r.label).toBe(LABELS[r.status])
      expect(r.onTheWay.length > 0).toBe(r.status === 'bad')
      if (r.status === 'bad') expect(r.actions[0]).toContain('health post')
    }
  })
  it('las acciones cambian según el caso', () => {
    const baby = assess(simulateFrost({ ...newVisit(), ageMonths: 6 }))
    expect(baby.actions.join(' ')).toContain('skin-to-skin')
    const child = assess(simulateFrost(newVisit()))
    expect(child.actions).toEqual(['Count breaths again in 1 hour.', 'Dress in layers and cover the head, hands, and feet.'])
    expect(assess(healthy({ ateDrank: false })).actions[0]).toContain('fluids')
    expect(assess(healthy({ kind: 'elder', breaths: 18, cold: 'helada' })).actions.join(' ')).toContain('wind')
  })
  it('el guion de radio tiene exactamente 5 líneas con contenido', () => {
    for (const v of CASES) {
      const lines = radioScript(v, assess(v))
      expect(lines).toHaveLength(5)
      for (const line of lines) {
        expect(line.trim().length).toBeGreaterThan(0)
        expect(line).not.toContain('\n')
      }
    }
  })
  it('la hoja de derivación lleva todos los datos', () => {
    const v = withAlarm(healthy({ cough: true, breaths: 62, tempC: 38.4, spo2: 80, cold: 'helada' }), 'breathless')
    const r = assess(v)
    const sheet = referral(v, r)
    const row = Object.fromEntries(sheet.rows)
    expect(row['Alias']).toBe('Person 1')
    expect(row['Person']).toBe('2-year-old child')
    expect(row['Time']).toBe(v.startedAt)
    expect(row['Location']).toContain('4300')
    expect(row['Environmental cold']).toBe('Frost')
    expect(row['Warning signs']).toBe('Has difficulty breathing')
    expect(row['Observations']).toContain('Has a cough')
    expect(row['Counted breaths']).toContain('62')
    expect(row['Temperature']).toBe('38.4 °C')
    expect(row['Oxygen saturation']).toBe('80%')
    expect(row['Decision']).toBe('Refer to the health post')
    expect(row['Reason']).toBe(r.reason)
    expect(row['Confidence']).toContain('5 of 5')
    expect(row['Distance to health post']).toBe('2 hours')
    expect(sheet.onTheWay).toEqual(r.onTheWay)

    const empty = Object.fromEntries(referral(newVisit(), assess(newVisit())).rows)
    expect(empty['Warning signs']).toBe('None')
    expect(empty['Temperature']).toBeUndefined()
    expect(empty['Oxygen saturation']).toBeUndefined()
  })
  it('ningún texto usa palabras de diagnóstico', () => {
    const banned = /neumon[ií]a|diagn[oó]stic|hipotermia|bronquiolitis|infecci[oó]n|influenza|gripe/i
    for (const v of CASES) for (const text of allText(v, assess(v))) expect(text).not.toMatch(banned)
    for (const p of PENDING_VALIDATION) expect(`${p.what} ${p.value}`).not.toMatch(banned)
  })
  it('assess no modifica la visita', () => {
    const v = simulateFrost(newVisit())
    const copy = JSON.parse(JSON.stringify(v))
    assess(v); referral(v, assess(v)); radioScript(v, assess(v))
    expect(v).toEqual(copy)
  })
})

describe('frostSeries', () => {
  it('da 48 horas con etiquetas "HH h" y riesgo entre 0 y 100', () => {
    for (const region of ['sierraAlta', 'sierraMedia', 'selvaFriaje'] as const) {
      for (const frost of [false, true]) {
        const s = frostSeries(region, frost)
        expect(s.hours).toHaveLength(48)
        expect(s.temp).toHaveLength(48)
        expect(s.risk).toHaveLength(48)
        for (const h of s.hours) expect(h).toMatch(/^([01]\d|2[0-3]) h$/)
        for (const k of s.risk) { expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(100) }
      }
    }
  })
  it('sin helada, la madrugada llega a la temperatura normal de la región', () => {
    for (const region of ['sierraAlta', 'sierraMedia', 'selvaFriaje'] as const) {
      expect(Math.min(...frostSeries(region, false).temp)).toBeCloseTo(DESTINATIONS[region].nightTemp!, 1)
    }
  })
  it('con helada el mínimo es bastante más bajo, en la última noche, y luego se recupera', () => {
    for (const region of ['sierraAlta', 'sierraMedia', 'selvaFriaje'] as const) {
      const normal = frostSeries(region, false)
      const frost = frostSeries(region, true)
      const min = Math.min(...frost.temp)
      const at = frost.temp.indexOf(min)
      expect(min).toBeLessThan(Math.min(...normal.temp) - 5)
      expect(at).toBeGreaterThan(24)
      expect(frost.temp[47]).toBeGreaterThan(min + 5)
      // El riesgo sube con el frío y baja al recuperarse.
      expect(frost.risk[at]).toBe(Math.max(...frost.risk))
      expect(frost.risk[at]).toBeGreaterThan(Math.max(...normal.risk))
      expect(frost.risk[47]).toBeLessThan(frost.risk[at] - 30)
      // La primera noche no cambia.
      expect(frost.temp.slice(0, 20)).toEqual(normal.temp.slice(0, 20))
    }
  })
  it('es determinista', () => {
    expect(frostSeries('sierraAlta', true)).toEqual(frostSeries('sierraAlta', true))
  })
})
