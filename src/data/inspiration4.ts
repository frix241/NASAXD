/**
 * Análisis de sangre de Inspiration4 (NASA OSDR, OSD-569 y OSD-575).
 * El CSV se empaqueta con la app (sin red). Solo se usan filas con calidad "ok";
 * lo que falta se queda como null y se muestra "sin dato". Nunca se interpola.
 */
import raw from '../../data/inspiration4_laboratorios_tidy.csv?raw'

export const TIMEPOINTS = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194'] as const
export const TIMEPOINT_HINT: Record<string, string> = {
  'L-92': '92 days before flight', 'L-44': '44 days before', 'L-3': '3 days before',
  'R+1': '1 day after return', 'R+45': '45 days after', 'R+82': '82 days after',
  'R+194': '194 days after',
}

export interface LabData {
  crews: string[]
  measures: { name: string; unit: string }[]
  /** values[medida][tripulante][momento] */
  values: Record<string, Record<string, (number | null)[]>>
  isSample: boolean
}

function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ''; let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const pick = (head: string[], names: string[]) => head.findIndex((h) => names.includes(h.toLowerCase()))

export function parseLabs(csv: string): LabData {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '')
  const head = splitLine(lines[0] ?? '')
  const iCrew = pick(head, ['tripulante', 'crew', 'crew_id', 'sujeto'])
  const iMeasure = pick(head, ['medida', 'analito', 'analyte', 'measure', 'prueba'])
  const iUnit = pick(head, ['unidad', 'unidades', 'unit', 'units'])
  const iTime = pick(head, ['momento', 'timepoint', 'tiempo', 'fecha'])
  const iValue = pick(head, ['valor', 'value'])
  const iQuality = pick(head, ['calidad', 'quality', 'qc'])
  const iSource = pick(head, ['fuente', 'source'])
  const data: LabData = { crews: [], measures: [], values: {}, isSample: false }
  for (const line of lines.slice(1)) {
    const c = splitLine(line)
    if (iSource >= 0 && c[iSource]?.toLowerCase() === 'simulado') data.isSample = true
    const crew = c[iCrew]; const measure = c[iMeasure]
    const t = TIMEPOINTS.indexOf(c[iTime] as (typeof TIMEPOINTS)[number])
    if (!crew || !measure || t < 0) continue
    if (!data.crews.includes(crew)) data.crews.push(crew)
    if (!data.values[measure]) {
      data.values[measure] = {}
      data.measures.push({ name: measure, unit: iUnit >= 0 ? c[iUnit] ?? '' : '' })
    }
    const row = (data.values[measure][crew] ??= TIMEPOINTS.map(() => null))
    if (iQuality >= 0 && c[iQuality]?.toLowerCase() !== 'ok') continue
    const txt = c[iValue]
    const v = txt === '' || txt === undefined ? NaN : Number(txt)
    if (Number.isFinite(v)) row[t] = v
  }
  data.crews.sort()
  for (const m of data.measures) for (const crew of data.crews) data.values[m.name][crew] ??= TIMEPOINTS.map(() => null)
  return data
}

/** Promedio de la tripulación por momento; null si nadie tiene dato. */
export function crewMean(d: LabData, measure: string): (number | null)[] {
  return TIMEPOINTS.map((_, t) => {
    const vs = d.crews.map((c) => d.values[measure][c][t]).filter((v): v is number => v !== null)
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null
  })
}

/** Cambio % respecto al promedio antes del vuelo (L-92, L-44, L-3) de esa misma serie. */
export function vsBaseline(series: (number | null)[]): (number | null)[] {
  const pre = series.slice(0, 3).filter((v): v is number => v !== null)
  if (!pre.length) return series.map(() => null)
  const base = pre.reduce((a, b) => a + b, 0) / pre.length
  return series.map((v) => (v === null || base === 0 ? null : ((v - base) / base) * 100))
}

/** Cambio % entre 3 días antes (L-3) y 1 día después (R+1). null si falta alguno. */
export function flightChange(series: (number | null)[]): number | null {
  const a = series[2]; const b = series[3]
  return a === null || b === null || a === 0 ? null : ((b - a) / a) * 100
}

export const LABS = parseLabs(raw)
