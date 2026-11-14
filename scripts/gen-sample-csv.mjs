// Genera un CSV de EJEMPLO con la misma forma que el real de NASA OSDR (OSD-569 / OSD-575).
// Cuando llegue el archivo real, reemplaza data/inspiration4_laboratorios_tidy.csv:
// la columna "fuente" con valor "simulado" es lo que activa el aviso "Datos de ejemplo".
import { writeFileSync } from 'node:fs'
let seed = 569
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const measures = [
  ['Hemoglobina', 'g/dL', 14.2, 0.9, -4], ['Hematocrito', '%', 42, 2.5, -4], ['Glóbulos rojos', 'M/µL', 4.8, 0.3, -5],
  ['Glóbulos blancos', 'K/µL', 6.1, 1.1, 14], ['Plaquetas', 'K/µL', 250, 35, 6], ['Glucosa', 'mg/dL', 90, 6, 5],
  ['Creatinina', 'mg/dL', 0.9, 0.1, 4], ['Sodio', 'mmol/L', 140, 1.5, -1], ['Potasio', 'mmol/L', 4.2, 0.25, -3],
  ['Calcio', 'mg/dL', 9.5, 0.3, 2], ['Colesterol total', 'mg/dL', 180, 18, -6], ['Proteína total', 'g/dL', 7.1, 0.3, 3],
  ['Vitamina D', 'ng/mL', 34, 6, -9],
]
const times = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194']
const post = [0, 0, 0, 1, 0.35, 0.15, 0]
const rows = ['tripulante,medida,unidad,momento,valor,calidad,fuente']
for (const crew of ['C001', 'C002', 'C003', 'C004']) {
  for (const [name, unit, mean, sd, shift] of measures) {
    const own = mean + (rnd() - 0.5) * 2 * sd
    times.forEach((t, i) => {
      const v = own * (1 + (shift / 100) * post[i] * (0.6 + rnd() * 0.8)) + (rnd() - 0.5) * sd * 0.5
      const r = rnd()
      const quality = r < 0.04 ? 'faltante' : r < 0.07 ? 'dudoso' : 'ok'
      const dec = mean < 20 ? 2 : mean < 100 ? 1 : 0
      rows.push([crew, name, unit, t, quality === 'faltante' ? '' : v.toFixed(dec), quality, 'simulado'].join(','))
    })
  }
}
writeFileSync(new URL('../data/inspiration4_laboratorios_tidy.csv', import.meta.url), rows.join('\n') + '\n')
console.log(rows.length - 1, 'filas')
