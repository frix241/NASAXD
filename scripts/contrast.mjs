// Comprueba el contraste WCAG del tema "Luz del día" (src/theme-day.css).
// Uso: node scripts/contrast.mjs   → código 1 si algún par baja de su mínimo.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../src/theme-day.css', import.meta.url))
const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Primer bloque cuyo selector es exactamente `.app.theme-day`
const block = css.match(/(?:^|[}\s,])\.app\.theme-day\s*\{([^}]*)\}/)
if (!block) { console.error('No encuentro el bloque `.app.theme-day { … }` en', file); process.exit(1) }

const vars = {}
for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim()

const toRgb = (name) => {
  const v = vars[name]
  if (!v) throw new Error(`Falta la variable --${name}`)
  let h = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (!h) throw new Error(`--${name}: "${v}" no es un color hexadecimal opaco`)
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
// Igual que color-mix(in srgb, a p%, b)
const mix = (a, b, p) => a.map((c, i) => Math.round(c * p + b[i] * (1 - p)))

const TEXT = 4.5
// [texto, fondo, mínimo]
const pairs = [
  ['ink', 'bg', 7], ['ink', 'surface', TEXT],
  ['muted', 'bg', TEXT], ['muted', 'surface', TEXT],
  ['ice', 'bg', TEXT], ['ice', 'surface', TEXT],
  ['ok', 'bg', TEXT], ['warn', 'bg', TEXT], ['bad', 'bg', TEXT],
  ['ok', 'surface', TEXT], ['warn', 'surface', TEXT], ['bad', 'surface', TEXT],
  ['on-accent', 'ice', TEXT],
]
// Pares que el tema usa además de los pedidos: controles, texto sobre estados y estados sobre su propio tinte.
const extra = [
  ['ink', 'surface-2', TEXT], ['muted', 'surface-2', TEXT], ['ice', 'surface-2', TEXT],
  ['on-accent', 'ok', TEXT], ['on-accent', 'warn', TEXT], ['on-accent', 'bad', TEXT],
  ['bg', 'ink', TEXT],
  ['border', 'bg', 3], ['line', 'bg', 3], ['line', 'surface', 3],
]
const TINT = 0.22 // el tinte de estado más fuerte que usa el tema sobre --surface

const rows = []
const add = (label, fg, bg, min) => { const r = ratio(fg, bg); rows.push({ label, r, min, ok: r >= min }) }
try {
  for (const [f, b, min] of pairs) add(`${f} / ${b}`, toRgb(f), toRgb(b), min)
  for (const [f, b, min] of extra) add(`${f} / ${b}`, toRgb(f), toRgb(b), min)
  for (const s of ['ok', 'warn', 'bad']) {
    add(`${s} / tinte ${s} ${TINT * 100}%`, toRgb(s), mix(toRgb(s), toRgb('surface'), TINT), TEXT)
    add(`ink / tinte ${s} ${TINT * 100}%`, toRgb('ink'), mix(toRgb(s), toRgb('surface'), TINT), TEXT)
  }
} catch (e) { console.error(e.message); process.exit(1) }

const w = Math.max(...rows.map((r) => r.label.length))
console.log(`${'par'.padEnd(w)}  contraste  mínimo  nivel  resultado`)
console.log('-'.repeat(w + 37))
for (const { label, r, min, ok } of rows) {
  const level = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA*' : '-'
  console.log(`${label.padEnd(w)}  ${(r.toFixed(2) + ':1').padStart(9)}  ${String(min).padStart(6)}  ${level.padEnd(5)}  ${ok ? 'pasa' : 'FALLA'}`)
}
console.log('\n(AA* = solo válido para bordes y texto grande, mínimo 3:1)')
const failed = rows.filter((r) => !r.ok)
if (failed.length) { console.error(`\n${failed.length} par(es) por debajo del mínimo.`); process.exit(1) }
console.log('\nTodos los pares pasan.')
