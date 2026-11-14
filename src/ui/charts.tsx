/** Gráficos SVG propios. Un solo eje por gráfico, líneas finas, tooltip siempre. */
import { useState, type ReactNode } from 'react'
import { useSize } from './hooks'

export const SERIES = ['#3987e5', '#d95926', '#9085e9', '#d55181'] // validada para daltonismo sobre #050a14
export const ICE = '#6db3ff'
const GRID = 'rgba(109,179,255,0.13)'
export const nf = (v: number, d = 0) => v.toFixed(d).replace('.', ',')

type Tip = { x: number; y: number; node: ReactNode } | null
interface Ctx { w: number; h: number; tip: (t: Tip) => void }

export function Chart({ children, minH }: { children: (c: Ctx) => ReactNode; minH?: number }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  return (
    <div className="chart" ref={ref} style={minH ? { minHeight: minH } : undefined} onPointerLeave={() => setTip(null)}>
      {w > 40 && h > 30 && <svg width={w} height={h} role="img">{children({ w, h, tip: setTip })}</svg>}
      {tip && (
        <div className="tip" style={{ left: Math.min(Math.max(tip.x, 70), Math.max(70, w - 70)), top: Math.max(tip.y - 8, 26) }}>{tip.node}</div>
      )}
    </div>
  )
}

interface Ref { v: number; label: string }
const M = { l: 30, r: 8, t: 8, b: 18 }

function YAxis({ w, h, min, max, ticks, d = 0 }: { w: number; h: number; min: number; max: number; ticks: number[]; d?: number }) {
  const y = (v: number) => M.t + (1 - (v - min) / (max - min)) * (h - M.t - M.b)
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={w - M.r} y1={y(t)} y2={y(t)} stroke={GRID} />
          <text x={M.l - 5} y={y(t) + 3.5} textAnchor="end">{nf(t, d)}</text>
        </g>
      ))}
    </g>
  )
}
function XLabels({ labels, x, h }: { labels: string[]; x: (i: number) => number; h: number }) {
  const gap = labels.length > 1 ? Math.abs(x(1) - x(0)) : 999
  const idx = gap >= 46 ? labels.map((_, i) => i) : [0, Math.floor((labels.length - 1) / 2), labels.length - 1]
  return <g>{idx.map((i) => <text key={i} x={x(i)} y={h - 4} textAnchor="middle">{labels[i]}</text>)}</g>
}
function RefLine({ r, y, w }: { r: Ref; y: number; w: number }) {
  return (
    <g>
      <line x1={M.l} x2={w - M.r} y1={y} y2={y} stroke="#86a3cb" strokeDasharray="4 4" />
      <text className="lab" x={w - M.r - 2} y={y - 4} textAnchor="end"
        style={{ fill: '#a9c3e6', paintOrder: 'stroke', stroke: '#050a14', strokeWidth: 4, strokeLinejoin: 'round' }}>{r.label}</text>
    </g>
  )
}

export function Bars({ values, labels, max, ticks, color, refLine, tipText, d = 0 }: {
  values: number[]; labels: string[]; max: number; ticks: number[]; color: (v: number, i: number) => string
  refLine?: Ref; tipText: (v: number, i: number) => ReactNode; d?: number
}) {
  const [hover, setHover] = useState(-1)
  return (
    <Chart>
      {({ w, h, tip }) => {
        const iw = w - M.l - M.r; const ih = h - M.t - M.b
        const band = iw / values.length; const bw = Math.max(3, Math.min(24, band - 3))
        const y = (v: number) => M.t + (1 - Math.min(v, max) / max) * ih
        const x = (i: number) => M.l + band * (i + 0.5)
        return (
          <g onPointerLeave={() => setHover(-1)}>
            <YAxis w={w} h={h} min={0} max={max} ticks={ticks} d={d} />
            {values.map((v, i) => {
              const top = y(v); const bh = Math.max(1, M.t + ih - top); const r = Math.min(3, bw / 2, bh)
              return (
                <path key={i} fill={color(v, i)} opacity={hover < 0 || hover === i ? 0.95 : 0.45}
                  d={`M${x(i) - bw / 2},${top + bh}V${top + r}q0,${-r} ${r},${-r}h${bw - 2 * r}q${r},0 ${r},${r}V${top + bh}Z`} />
              )
            })}
            {refLine && <RefLine r={refLine} y={y(refLine.v)} w={w} />}
            <XLabels labels={labels} x={x} h={h} />
            {values.map((v, i) => (
              <rect key={i} x={M.l + band * i} y={M.t} width={band} height={ih} fill="transparent"
                onPointerMove={() => { setHover(i); tip({ x: x(i), y: y(v), node: tipText(v, i) }) }}
                onPointerDown={() => { setHover(i); tip({ x: x(i), y: y(v), node: tipText(v, i) }) }} />
            ))}
          </g>
        )
      }}
    </Chart>
  )
}

export interface Line { name: string; color: string; dash?: boolean; values: (number | null)[] }

export function Lines({ series, labels, min, max, ticks, refLines = [], unit = '', d = 0, endLabels = false }: {
  series: Line[]; labels: string[]; min: number; max: number; ticks: number[]; refLines?: Ref[]
  unit?: string; d?: number; endLabels?: boolean
}) {
  const [hover, setHover] = useState(-1)
  const n = labels.length
  return (
    <Chart>
      {({ w, h, tip }) => {
        const mr = endLabels ? 64 : M.r + 4
        const iw = w - M.l - mr; const ih = h - M.t - M.b
        const x = (i: number) => M.l + 4 + (iw - 4) * (n === 1 ? 0.5 : i / (n - 1))
        const y = (v: number) => M.t + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * ih
        const path = (vals: (number | null)[]) => {
          let dd = ''; let pen = false
          vals.forEach((v, i) => { if (v === null) { pen = false; return } dd += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true })
          return dd
        }
        const move = (e: React.PointerEvent<SVGRectElement>) => {
          const box = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - box.left
          const i = Math.max(0, Math.min(n - 1, Math.round(((px - 4) / (iw - 4)) * (n - 1))))
          setHover(i)
          const present = series.map((s) => s.values[i]).filter((v): v is number => v !== null)
          tip({
            x: x(i), y: present.length ? Math.min(...present.map(y)) : M.t + 20,
            node: (
              <>
                <div className="muted">{labels[i]}</div>
                {series.map((s) => (
                  <div key={s.name}>
                    <i style={{ display: 'inline-block', width: 10, borderTop: `2px ${s.dash ? 'dashed' : 'solid'} ${s.color}`, verticalAlign: 'middle', marginRight: 6 }} />
                    {series.length > 1 && `${s.name}: `}<b>{s.values[i] === null ? 'sin dato' : `${nf(s.values[i]!, d)}${unit}`}</b>
                  </div>
                ))}
              </>
            ),
          })
        }
        return (
          <g>
            <YAxis w={w - mr + M.r} h={h} min={min} max={max} ticks={ticks} d={d >= 2 ? 1 : 0} />
            {refLines.map((r) => <RefLine key={r.label} r={r} y={y(r.v)} w={w - mr + M.r} />)}
            {hover >= 0 && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} stroke="#86a3cb" strokeOpacity="0.6" />}
            {series.map((s) => (
              <g key={s.name}>
                <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) => v !== null && (n <= 8 || i === hover) && (
                  <circle key={i} cx={x(i)} cy={y(v)} r={i === hover ? 4.5 : 3} fill={s.color} stroke="#050a14" strokeWidth="2" />
                ))}
                {endLabels && (() => {
                  let last = -1
                  s.values.forEach((v, i) => { if (v !== null) last = i })
                  return last >= 0 ? <text className="lab" x={x(last) + 8} y={y(s.values[last]!) + 4}>{s.name}</text> : null
                })()}
              </g>
            ))}
            <XLabels labels={labels} x={x} h={h} />
            <rect x={M.l} y={M.t} width={iw} height={ih} fill="transparent" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(-1)} />
          </g>
        )
      }}
    </Chart>
  )
}

/** Escala divergente: azul (más bajo) – gris neutro (igual) – magenta (más alto). */
export function diverge(pct: number, limit: number): string {
  const t = Math.max(-1, Math.min(1, pct / limit))
  const mid = [38, 46, 60]; const lo = [57, 135, 229]; const hi = [213, 81, 129]
  const end = t < 0 ? lo : hi; const k = Math.pow(Math.abs(t), 0.8)
  return `rgb(${mid.map((m, i) => Math.round(m + (end[i] - m) * k)).join(',')})`
}

export function Heatmap({ rows, cols, cell, limit, selected, onSelect, tipText }: {
  rows: string[]; cols: string[]; cell: (r: number, c: number) => number | null; limit: number
  selected?: number; onSelect?: (r: number) => void; tipText: (r: number, c: number) => ReactNode
}) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  return (
    <Chart>
      {({ w, h, tip }) => {
        const left = Math.min(128, w * 0.36); const top = 16
        const cw = (w - left - 2) / cols.length; const ch = (h - top) / rows.length
        return (
          <g onPointerLeave={() => setHover(null)}>
            <defs>
              <pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#86a3cb" strokeOpacity="0.45" strokeWidth="1.5" />
              </pattern>
            </defs>
            {cols.map((c, j) => <text key={c} x={left + cw * (j + 0.5)} y={10} textAnchor="middle" style={{ fontSize: cw < 40 ? 8.5 : undefined }}>{c}</text>)}
            {rows.map((name, i) => (
              <g key={name} onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(i) } : undefined} style={onSelect ? { cursor: 'pointer' } : undefined}>
                <text className="lab" x={left - 8} y={top + ch * (i + 0.5) + 4} textAnchor="end"
                  style={{ fontWeight: selected === i ? 700 : 400, fill: selected === i ? '#fff' : undefined, fontSize: Math.min(11.5, ch * 0.75) }}>
                  {selected === i ? '▸ ' : ''}{name}
                </text>
                {cols.map((_, j) => {
                  const v = cell(i, j)
                  const on = hover?.[0] === i && hover?.[1] === j
                  return (
                    <rect key={j} x={left + cw * j + 1} y={top + ch * i + 1} width={Math.max(1, cw - 2)} height={Math.max(1, ch - 2)} rx="2"
                      fill={v === null ? 'url(#nodata)' : diverge(v, limit)} stroke={on ? '#fff' : 'none'} strokeWidth="1.5"
                      onPointerMove={() => { setHover([i, j]); tip({ x: left + cw * (j + 0.5), y: top + ch * i, node: tipText(i, j) }) }}
                      onPointerDown={() => { setHover([i, j]); tip({ x: left + cw * (j + 0.5), y: top + ch * i, node: tipText(i, j) }) }} />
                  )
                })}
              </g>
            ))}
          </g>
        )
      }}
    </Chart>
  )
}

/** Barras horizontales desde cero: cambio % por medida. */
export function ChangeBars({ rows, limit, columns = 1 }: { rows: { name: string; pct: number | null }[]; limit: number; columns?: number }) {
  const [hover, setHover] = useState(-1)
  return (
    <Chart>
      {({ w, h, tip }) => {
        const per = Math.ceil(rows.length / columns)
        const colW = w / columns; const rh = Math.min(30, h / per)
        const label = Math.min(124, colW * 0.42); const num = 52
        return (
          <g onPointerLeave={() => setHover(-1)}>
            {rows.map((r, i) => {
              const c = Math.floor(i / per); const k = i % per
              const x0 = c * colW; const bx = x0 + label + 6; const bw = colW - label - num - 18
              const zero = bx + bw / 2; const cy = rh * (k + 0.5)
              const len = r.pct === null ? 0 : (Math.max(-limit, Math.min(limit, r.pct)) / limit) * (bw / 2)
              const text = r.pct === null ? 'sin dato' : `${r.pct > 0 ? '+' : ''}${nf(r.pct, 1)} %`
              const show = () => {
                setHover(i)
                tip({ x: zero, y: cy - rh / 2 + 4, node: <><span className="muted">{r.name}: </span><b>{text}</b>{r.pct !== null && <span className="muted"> {r.pct > 0 ? 'subió' : r.pct < 0 ? 'bajó' : 'igual'}</span>}</> })
              }
              return (
                <g key={r.name} opacity={hover < 0 || hover === i ? 1 : 0.5}>
                  <text className="lab" x={x0 + label} y={cy + 4} textAnchor="end">{r.name}</text>
                  <line x1={zero} x2={zero} y1={cy - rh / 2 + 2} y2={cy + rh / 2 - 2} stroke="#86a3cb" strokeOpacity="0.6" />
                  {r.pct !== null && (
                    <rect x={len < 0 ? zero + len : zero} y={cy - Math.min(7, rh / 2 - 3)} width={Math.max(1.5, Math.abs(len))} height={Math.min(14, rh - 6)} rx="2"
                      fill={r.pct < 0 ? SERIES[0] : SERIES[3]} />
                  )}
                  <text x={bx + bw + 6} y={cy + 4} style={r.pct === null ? { fontStyle: 'italic' } : { fill: '#dcebff' }}>{text}</text>
                  <rect x={x0} y={cy - rh / 2} width={colW} height={rh} fill="transparent" onPointerMove={show} onPointerDown={show} />
                </g>
              )
            })}
          </g>
        )
      }}
    </Chart>
  )
}

export function Legend({ items }: { items: { name: string; color: string; dash?: boolean; box?: boolean; pattern?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.name}>
          <i className={it.box || it.pattern ? 'box' : it.dash ? 'dash' : ''}
            style={it.pattern
              ? { background: 'repeating-linear-gradient(45deg,#86a3cb88 0 1.5px,transparent 1.5px 4px)' }
              : it.box ? { background: it.color } : { borderColor: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  )
}
