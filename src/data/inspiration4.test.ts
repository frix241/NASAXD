import { describe, expect, it } from 'vitest'
import { crewMean, flightChange, parseLabs, vsBaseline } from './inspiration4'

const csv = `tripulante,medida,unidad,momento,valor,calidad
C001,Sodio,mmol/L,L-92,140,ok
C001,Sodio,mmol/L,L-3,100,ok
C001,Sodio,mmol/L,R+1,110,ok
C001,Sodio,mmol/L,R+45,999,dudoso
C001,Sodio,mmol/L,R+82,,faltante
C002,Sodio,mmol/L,L-3,120,ok
C002,Sodio,mmol/L,R+1,,ok
`
describe('análisis de Inspiration4', () => {
  const d = parseLabs(csv)
  it('usa solo filas ok y deja el resto sin dato', () => {
    expect(d.values.Sodio.C001).toEqual([140, null, 100, 110, null, null, null])
    expect(d.values.Sodio.C002).toEqual([null, null, 120, null, null, null, null])
    expect(d.isSample).toBe(false)
  })
  it('promedia sin inventar datos', () => {
    expect(crewMean(d, 'Sodio')).toEqual([140, null, 110, 110, null, null, null])
  })
  it('cambio L-3 → R+1', () => {
    expect(flightChange(d.values.Sodio.C001)).toBeCloseTo(10)
    expect(flightChange(d.values.Sodio.C002)).toBeNull()
    expect(vsBaseline([100, null, 100, 110, null, null, null])[3]).toBeCloseTo(10)
  })
})
