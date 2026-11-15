import { describe, expect, it } from 'vitest'
import {
  actionOfDay, applyAulaEvent, aulaIssues, createAula, ESCALATE, evaluateAula, nextDay, redStreak,
  setToday, setTotal, statusPct, today, topActions, weekSummary,
} from './aula'

describe('semáforo del aula', () => {
  it('umbrales por porcentaje: verde <20 %, ámbar 20–40 %, rojo >40 %', () => {
    expect(statusPct(5, 30)).toBe('ok') // 17 %
    expect(statusPct(6, 30)).toBe('warn') // 20 %
    expect(statusPct(12, 30)).toBe('warn') // 40 %
    expect(statusPct(13, 30)).toBe('bad') // 43 %
  })
  it('el día por defecto sale todo en verde y sin acción', () => {
    const a = createAula()
    expect(aulaIssues(a)).toEqual([])
    expect(actionOfDay(a).level).toBe('ok')
  })
  it('nunca usa medidas clínicas', () => {
    const r = evaluateAula(createAula())
    for (const k of ['pulse', 'bp', 'spo2', 'temp', 'resp'] as const) expect(r[k]).toMatchObject({ status: 'ok', text: '' })
  })
  it('una sola acción del día: la más grave primero', () => {
    let a = setToday(createAula(), { sleptLittle: 14, noBreakfast: 7, recess: false })
    const issues = aulaIssues(a)
    expect(issues.map((i) => i.key)).toEqual(['sleep', 'breakfast', 'exercise'])
    expect(actionOfDay(a).text).toMatch(/pausa activa de 3 minutos/)
    a = setToday(a, { climate: 'alto', extreme: true })
    expect(aulaIssues(a)[0].key).toBe('radiation')
  })
  it('clima: calor o frío en ámbar, ola de calor o friaje en rojo', () => {
    expect(evaluateAula(setToday(createAula(), { climate: 'bajo' })).radiation.status).toBe('warn')
    expect(evaluateAula(applyAulaEvent(createAula(), 'cold')).radiation).toMatchObject({ status: 'bad', text: 'Friaje' })
    expect(evaluateAula(setToday(applyAulaEvent(createAula(), 'heat'), { climate: 'normal' })).radiation.status).toBe('ok')
  })
  it('3 días seguidos en rojo: sugiere hablar con la familia o la posta, sin diagnosticar', () => {
    let a = setToday(createAula(), { sleptLittle: 15 })
    expect(redStreak(a, 'sleep')).toBe(1)
    expect(aulaIssues(a)[0].why).not.toContain(ESCALATE)
    a = setToday(nextDay(a), { sleptLittle: 15 })
    a = setToday(nextDay(a), { sleptLittle: 15 })
    expect(redStreak(a, 'sleep')).toBe(3)
    expect(aulaIssues(a)[0].why).toContain('conversa con la familia o la posta de salud')
    expect(applyAulaEvent(createAula(), 'hardWeek').days.slice(-3).every((d) => d.sleptLittle > 12)).toBe(true)
  })
  it('se guardan 7 días y los conteos no pasan del total', () => {
    let a = createAula()
    for (let i = 0; i < 5; i++) a = nextDay(a)
    expect(a.days).toHaveLength(7)
    expect(a.firstDay).toBe(22)
    a = setToday(a, { sleptLittle: 99, low: -4 })
    expect(today(a)).toMatchObject({ sleptLittle: 30, low: 0 })
    a = setTotal(a, 20)
    expect(today(a).sleptLittle).toBe(20)
  })
  it('nivel 2 opcional: sin registrar no cuenta', () => {
    const a = createAula()
    expect(evaluateAula(a).hydration).toMatchObject({ status: 'ok', text: 'Sin dato' })
    expect(evaluateAula(setToday(a, { heavyPack: 14 })).backpack.status).toBe('bad')
  })
  it('resumen semanal e informe: hasta 3 acciones', () => {
    const a = createAula()
    expect(weekSummary(a)).toHaveLength(5)
    expect(weekSummary(a)[0].statuses).toHaveLength(7)
    const top = topActions(a)
    expect(top.length).toBeGreaterThan(0); expect(top.length).toBeLessThanOrEqual(3)
  })
})
