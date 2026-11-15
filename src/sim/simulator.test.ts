import { describe, expect, it } from 'vitest'
import {
  bodyRemaining, statusPercent, statusPulse, statusRadiation, statusSleep, statusSpo2,
  statusSys, statusTemp, worst,
} from '../config/rules'
import {
  applyScenario, createSim, doExercise, drinkWater, evaluate, goToShelter, rest, setMeasurement, step,
  stepMany, targets,
} from './simulator'

describe('reglas de estado', () => {
  it('presión sistólica', () => {
    expect(statusSys(119)).toBe('ok'); expect(statusSys(120)).toBe('warn')
    expect(statusSys(139)).toBe('warn'); expect(statusSys(140)).toBe('bad')
  })
  it('pulso en reposo, ignorado en ejercicio', () => {
    expect(statusPulse(85)).toBe('ok'); expect(statusPulse(86)).toBe('warn')
    expect(statusPulse(100)).toBe('warn'); expect(statusPulse(101)).toBe('bad')
    expect(statusPulse(150, true)).toBe('ok')
  })
  it('oxígeno', () => {
    expect(statusSpo2(95)).toBe('ok'); expect(statusSpo2(94)).toBe('warn')
    expect(statusSpo2(90)).toBe('warn'); expect(statusSpo2(89)).toBe('bad')
  })
  it('temperatura', () => {
    expect(statusTemp(36.0)).toBe('ok'); expect(statusTemp(37.5)).toBe('ok')
    expect(statusTemp(37.6)).toBe('warn'); expect(statusTemp(38.0)).toBe('warn')
    expect(statusTemp(38.1)).toBe('bad'); expect(statusTemp(35.4)).toBe('bad')
    expect(statusTemp(35.7)).toBe('warn')
  })
  it('sueño', () => {
    expect(statusSleep(7)).toBe('ok'); expect(statusSleep(6.9)).toBe('warn')
    expect(statusSleep(6)).toBe('warn'); expect(statusSleep(5.9)).toBe('bad')
  })
  it('hidratación y ejercicio', () => {
    expect(statusPercent(70)).toBe('ok'); expect(statusPercent(69)).toBe('warn')
    expect(statusPercent(45)).toBe('warn'); expect(statusPercent(44)).toBe('bad')
  })
  it('radiación respecto al nivel base', () => {
    expect(statusRadiation(1.9 * 55, 55)).toBe('ok'); expect(statusRadiation(2 * 55, 55)).toBe('warn')
    expect(statusRadiation(5 * 55, 55)).toBe('warn'); expect(statusRadiation(5.1 * 55, 55)).toBe('bad')
  })
  it('peor estado', () => {
    expect(worst(['ok', 'warn'])).toBe('warn'); expect(worst(['ok', 'bad', 'warn'])).toBe('bad')
    expect(worst([])).toBe('ok')
  })
  it('músculo y hueso: 1–1,5 % al mes sin ejercicio, mejor con rutina', () => {
    expect(100 - bodyRemaining('muscle', 1, 0)).toBeCloseTo(1.5, 5)
    expect(100 - bodyRemaining('bone', 1, 0)).toBeCloseTo(1.0, 5)
    expect(bodyRemaining('bone', 6, 1)).toBeGreaterThan(bodyRemaining('bone', 6, 0))
    expect(bodyRemaining('muscle', 6, 0)).toBeLessThan(92)
  })
})

describe('simulador', () => {
  it('es determinista con la misma semilla', () => {
    expect(stepMany(createSim(3), 200)).toEqual(stepMany(createSim(3), 200))
    expect(stepMany(createSim(3), 50).vitals).not.toEqual(stepMany(createSim(4), 50).vitals)
  })
  it('arranca todo en verde y sigue así un día entero', () => {
    let s = createSim()
    for (let i = 0; i < 1500; i++) {
      s = step(s)
      const bad = Object.entries(evaluate(s)).filter(([, r]) => r.status !== 'ok')
      expect(bad, `minuto ${i}`).toEqual([])
    }
    expect(s.missionDay).toBe(24)
    expect(s.history.sleep).toHaveLength(14)
  })
  it('el ruido es suave', () => {
    let s = createSim()
    for (let i = 0; i < 300; i++) {
      const n = step(s)
      expect(Math.abs(n.vitals.pulse - s.vitals.pulse)).toBeLessThan(4)
      expect(Math.abs(n.vitals.temp - s.vitals.temp)).toBeLessThan(0.15)
      s = n
    }
  })
  it('dormir poco sube la presión y baja el ánimo', () => {
    const a = createSim(); const b = applyScenario(a, 'badNight')
    expect(targets(b).sys).toBeGreaterThan(targets(a).sys + 8)
    expect(targets(b).mood).toBeLessThan(targets(a).mood - 15)
    const e = evaluate(stepMany(b, 30))
    expect(e.sleep.status).toBe('bad'); expect(e.bp.status).toBe('warn')
  })
  it('poca agua sube la presión; beber agua lo arregla', () => {
    const a = stepMany(createSim(), 30)
    let b = stepMany(applyScenario(createSim(), 'lowWater'), 30)
    expect(evaluate(b).hydration.status).toBe('bad')
    expect(b.vitals.sys).toBeGreaterThan(a.vitals.sys + 4)
    b = stepMany(drinkWater(b), 30)
    expect(evaluate(b).hydration.status).toBe('ok')
  })
  it('tormenta solar: rojo fuera, verde en el refugio', () => {
    let s = stepMany(applyScenario(createSim(), 'storm'), 10)
    expect(evaluate(s).radiation.status).toBe('bad')
    s = stepMany(goToShelter(s), 10)
    expect(evaluate(s).radiation.status).toBe('ok')
    const before = s.radTotal
    s = stepMany(s, 700)
    expect(s.storm).toBe(false); expect(s.sheltered).toBe(false)
    expect(s.radTotal).toBeGreaterThan(before)
  })
  it('fiebre y presión alta marcan rojo', () => {
    expect(evaluate(stepMany(applyScenario(createSim(), 'fever'), 30)).temp.status).toBe('bad')
    expect(evaluate(stepMany(applyScenario(createSim(), 'highBP'), 30)).bp.status).toBe('bad')
  })
  it('el ejercicio sube el pulso sin alarma y suma a la semana', () => {
    const a = createSim()
    const b = stepMany(doExercise(a, 30), 15)
    expect(b.vitals.pulse).toBeGreaterThan(105)
    expect(evaluate(b).pulse.status).toBe('ok')
    expect(b.exerciseWeek).toBeGreaterThan(a.exerciseWeek)
    expect(evaluate(stepMany(b, 40)).pulse.status).toBe('ok')
  })
  it('una medición a mano se queda y cambia el semáforo', () => {
    let s = setMeasurement(createSim(), 'sys', 146)
    expect(evaluate(s).bp.status).toBe('bad')
    s = stepMany(s, 60)
    expect(s.vitals.sys).toBeGreaterThan(140)
    s = setMeasurement(s, 'glucose', 132)
    expect(evaluate(stepMany(s, 20)).glucose.status).toBe('bad')
    expect(evaluate(setMeasurement(s, 'glucose', 65)).glucose.status).toBe('warn')
    expect(evaluate(setMeasurement(s, 'sleep', 5)).sleep.status).toBe('bad')
    expect(evaluate(stepMany(setMeasurement(s, 'mood', 30), 3)).mood.status).toBe('bad')
  })
  it('descansar recupera sueño', () => {
    const s = rest(applyScenario(createSim(), 'badNight'), 1.3)
    expect(s.sleepHours).toBeCloseTo(6.1, 5)
    expect(s.history.sleep[13]).toBeCloseTo(6.1, 5)
  })
})
