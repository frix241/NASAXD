import type { ReactNode } from 'react'
import type { Cold, DangerSign, PersonKind } from '../../sim/community'

/**
 * Pictogramas propios del perfil comunidad. Un solo estilo: caja de 48x48, trazo de 3,
 * puntas y esquinas redondeadas, color heredado (`currentColor`). Pensados para leerse a pleno sol
 * y por personas con poca lectura.
 */
export type PictogramName =
  | DangerSign
  | 'cough' | 'feverTouch' | 'warmEnough' | 'ateDrank'
  | PersonKind
  | Cold
  | 'timer' | 'post' | 'mountain' | 'thermometer' | 'oximeter' | 'speaker'
  | 'plus' | 'minus' | 'stop' | 'sheet' | 'newPerson'

const P = (d: string) => <path d={d} />

const SHAPES: Record<PictogramName, ReactNode> = {
  // ── Señales de alarma ──
  /** Taza tachada: no puede beber ni comer */
  noDrink: <>{P('M11 16h22l-2 22H13z')}{P('M33 21h4a4 4 0 0 1 0 8h-5')}{P('M6 42L42 6')}</>,
  /** Cabeza y chorro que cae: vomita todo */
  vomits: <><circle cx="16" cy="16" r="10" />{P('M11 14h3M19 14h2')}{P('M24 22c9 1 14 7 14 16')}{P('M22 27c5 2 8 6 8 11')}{P('M24 43h18')}</>,
  /** Persona que tiembla, con rayas de sacudida a los lados */
  convulsions: <><circle cx="24" cy="9" r="5" />{P('M24 14v15M24 29l-7 13M24 29l7 13M14 17l10 5 10-8')}{P('M5 14l4 5-4 5 4 5')}{P('M43 22l-4 5 4 5-4 5')}</>,
  /** Cara con los ojos cerrados y zetas: muy somnoliento */
  sleepy: <><circle cx="19" cy="29" r="14" />{P('M11 27q3 3 6 0M21 27q3 3 6 0')}{P('M15 36h8')}{P('M32 5h10L32 15h10')}</>,
  /** Pulmones */
  breathless: <>{P('M24 5v15M24 20l-6 5M24 20l6 5')}{P('M17 15C10 18 6 28 6 37c0 6 11 4 11-2z')}{P('M31 15c7 3 11 13 11 22 0 6-11 4-11-2z')}</>,
  /** Pecho que se hunde hacia dentro al respirar */
  chestIndrawing: <>{P('M10 7h28')}{P('M16 7v10c0 6 5 8 5 14s-5 6-5 11')}{P('M32 7v10c0 6-5 8-5 14s5 6 5 11')}{P('M3 31h9M8 27l4 4-4 4')}{P('M45 31h-9M40 27l-4 4 4 4')}</>,
  /** Labios */
  blueLips: <>{P('M5 24c5-8 13-11 19-5 6-6 14-3 19 5')}{P('M5 24c6 13 32 13 38 0')}{P('M5 24c9 4 29 4 38 0')}</>,

  // ── Observación ──
  /** Persona que tose: cabeza, hombros y golpes de aire */
  cough: <><circle cx="16" cy="16" r="9" />{P('M4 43c0-8 5-13 12-13s12 5 12 13')}{P('M31 17h7M31 10l6-4M31 24l6 4')}{P('M43 17h1')}</>,
  /** Mano sobre la frente */
  feverTouch: <><circle cx="22" cy="29" r="13" />{P('M16 31h1M27 31h1')}{P('M8 19h28a4.5 4.5 0 0 0 0-9H19')}{P('M41 25l4 1M40 33l4 3')}</>,
  /** Chullo: gorro andino con orejeras */
  warmEnough: <>{P('M24 9V4')}{P('M10 27c0-10 6-18 14-18s14 8 14 18')}{P('M10 27h28')}{P('M10 27v8l4 8M38 27v8l-4 8')}{P('M17 19l3 3 4-4 4 4 3-3')}</>,
  /** Plato hondo con vapor */
  ateDrank: <>{P('M5 24h38c0 10-8 17-19 17S5 34 5 24z')}{P('M17 17c-2-3 2-5 0-9M24 17c-2-3 2-5 0-9M31 17c-2-3 2-5 0-9')}</>,

  // ── Personas ──
  child: <><circle cx="24" cy="17" r="8" />{P('M14 43V35c0-5 4-8 10-8s10 3 10 8v8')}{P('M20 9c2-3 6-3 8 0')}</>,
  /** Persona encorvada con bastón */
  elder: <><circle cx="19" cy="10" r="6" />{P('M19 16c-3 6-3 12 1 17l-5 11M20 33l7 11')}{P('M18 21l12 6')}{P('M36 44V25c0-4-6-4-6 0')}</>,
  adult: <><circle cx="24" cy="9" r="6" />{P('M12 44V27c0-6 5-9 12-9s12 3 12 9v17')}{P('M24 31v13')}</>,

  // ── Frío ──
  /** Sol */
  normal: <><circle cx="24" cy="24" r="8" />{P('M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4')}</>,
  /** Viento */
  frio: <>{P('M5 17h23a5 5 0 1 0-5-5')}{P('M5 26h33a5 5 0 1 1-5 5')}{P('M5 35h15')}</>,
  /** Copo de hielo */
  helada: <>{P('M24 4v40M7 14l34 20M41 14L7 34')}{P('M19 8l5 4 5-4M19 40l5-4 5 4')}{P('M7 21l6-3-1-7M41 27l-6 3 1 7M41 21l-6-3 1-7M7 27l6 3-1 7')}</>,

  // ── Herramientas y lugares ──
  timer: <><circle cx="24" cy="28" r="15" />{P('M24 28v-9M19 5h10M24 5v8M37 14l3-3')}</>,
  /** Posta de salud: casa con cruz */
  post: <>{P('M5 22L24 7l19 15')}{P('M10 19v24h28V19')}{P('M24 25v12M18 31h12')}</>,
  mountain: <>{P('M3 41L18 13l8 14 5-8 14 22z')}{P('M13 23l5 3 4-4')}</>,
  thermometer: <>{P('M20 28V9a4 4 0 0 1 8 0v19a8 8 0 1 1-8 0z')}{P('M24 19v14')}{P('M34 12h6M34 20h4')}</>,
  /** Pinza de dedo con línea de pulso */
  oximeter: <>{P('M10 14h24a8 8 0 0 1 8 8v4a8 8 0 0 1-8 8H10z')}{P('M10 19H4M10 29H4')}{P('M15 24h5l3-5 4 10 3-5h6')}</>,
  speaker: <>{P('M6 19h8l10-8v26l-10-8H6z')}{P('M31 18a8 8 0 0 1 0 12M36 12a16 16 0 0 1 0 24')}</>,

  // ── Controles ──
  plus: P('M24 10v28M10 24h28'),
  minus: P('M10 24h28'),
  stop: P('M13 13h22v22H13z'),
  /** Hoja de derivación */
  sheet: <>{P('M11 5h18l9 9v29H11z')}{P('M29 5v9h9')}{P('M17 24h14M17 31h14M17 38h8')}</>,
  newPerson: <><circle cx="19" cy="14" r="7" />{P('M6 42v-5c0-7 5-11 13-11 4 0 7 1 9 3')}{P('M37 28v14M30 35h14')}</>,
}

export function Pictogram({ name, size = 48, title }: { name: PictogramName; size?: number; title?: string }) {
  return (
    <svg className="cm-pic" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={3}
      strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      focusable="false">
      {SHAPES[name]}
    </svg>
  )
}
