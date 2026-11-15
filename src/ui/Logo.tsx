import { useId } from 'react'
import '../intro.css'

export type LogoVariant = 'space' | 'community'

interface LogoProps {
  /** `space`: gemelo dentro de una órbita. `community`: gemelo delante del sol que sale tras los cerros. */
  variant?: LogoVariant
  /** Solo el isotipo, sin letras. */
  compact?: boolean
  /** Reproduce la animación de entrada (trazos que se dibujan, el eco se separa, el satélite da una vuelta). */
  animate?: boolean
  /** Alto del isotipo en px. Las letras se escalan con él. */
  size?: number
  /** Text below the name. Defaults to "Community" for the `community` variant. */
  sub?: string
  className?: string
}

// Figura: cabeza y hombros. El eco es la misma figura desplazada, solo en trazo.
const BODY = 'M31 94V70a19 19 0 0 1 38 0v24z'
const HEAD = { cx: 50, cy: 37, r: 10.5 }
const TWIN_DX = 22
// Órbita inclinada: mitad de atrás (pasa detrás de la figura) y mitad de delante
const ORBIT_BACK = 'M9.93 82.23A54 18 -22 0 1 110.07 41.77'
const ORBIT_FRONT = 'M110.07 41.77A54 18 -22 0 1 9.93 82.23'
// Sol que sale y perfil de cerros (variante comunidad)
const SUN = 'M20.8 98A46 46 0 1 1 99.2 98'
const RIDGE = 'M4 100L21 79l9 9 15-19 13 15 9-8 11 12 12-15 8 8 14 19z'
const RAYS = [-75, -50, -25, 0, 25, 50, 75].map((deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  const p = (r: number) => `${(60 + r * Math.cos(a)).toFixed(2)} ${(74 + r * Math.sin(a)).toFixed(2)}`
  return `M${p(51.5)}L${p(deg % 50 === 0 ? 58.5 : 56.5)}`
})

/**
 * Logo de AstroTwin: una persona y su gemelo digital (el eco en trazo).
 * Colores: `--logo-ink` y `--logo-accent`, que por defecto toman `--ink` y `--ice`.
 */
export function Logo({ variant = 'space', compact = false, animate = false, size = 120, sub, className = '' }: LogoProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const community = variant === 'community'
  const under = sub ?? (community ? 'Community' : '')
  const label = `AstroTwin${under ? ` ${under}` : ''}`
  const figure = (
    <>
      <circle {...HEAD} />
      <path d={BODY} />
    </>
  )
  return (
    <span className={`in-logo in-logo-${variant}${animate ? ' is-anim' : ''}${compact ? ' is-compact' : ''} ${className}`}
      role="img" aria-label={label} style={{ '--logo-size': `${size}px` } as React.CSSProperties}>
      <svg className="in-logo-mark" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          {/* Hueco alrededor de la figura sólida: lo que pasa por detrás no la toca */}
          <mask id={`${id}b`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
            <rect width="120" height="120" fill="#fff" />
            <g fill="#000" stroke="#000" strokeWidth="6" strokeLinejoin="round">{figure}</g>
            {community && <g transform={`translate(${TWIN_DX} 0)`} fill="#000" stroke="#000" strokeWidth="6">{figure}</g>}
          </mask>
          {/* Solo la figura sólida: el eco se recorta con ella, no con su propio hueco */}
          <mask id={`${id}e`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
            <rect width="120" height="120" fill="#fff" />
            <g fill="#000" stroke="#000" strokeWidth="6" strokeLinejoin="round">{figure}</g>
          </mask>
          {/* Hueco donde la órbita cruza por delante */}
          <mask id={`${id}f`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
            <rect width="120" height="120" fill="#fff" />
            {!community && <path d={ORBIT_FRONT} fill="none" stroke="#000" strokeWidth="9" />}
          </mask>
          <mask id={`${id}s`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
            <rect width="120" height="120" fill="#fff" />
            <path d={RIDGE} fill="#000" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
            <g fill="#000" stroke="#000" strokeWidth="6">{figure}<g transform={`translate(${TWIN_DX} 0)`}>{figure}</g></g>
          </mask>
        </defs>

        {community ? (
          <>
            <g mask={`url(#${id}s)`}>
              <g className="in-logo-sun">
                <path className="in-logo-accent in-logo-draw" d={SUN} pathLength={1} style={{ '--d': '0.1s', '--t': '1.1s' } as React.CSSProperties} />
                {RAYS.map((d, i) => (
                  <path key={d} className="in-logo-accent in-logo-draw in-logo-ray" d={d} pathLength={1}
                    style={{ '--d': `${0.75 + Math.abs(i - 3) * 0.07}s`, '--t': '0.4s' } as React.CSSProperties} />
                ))}
              </g>
            </g>
            <g mask={`url(#${id}b)`}>
              <path className="in-logo-inkline in-logo-draw" d={RIDGE} pathLength={1} style={{ '--d': '0s', '--t': '1.2s' } as React.CSSProperties} />
            </g>
          </>
        ) : (
          <g mask={`url(#${id}b)`}>
            <path className="in-logo-accent in-logo-draw" d={ORBIT_BACK} pathLength={1} style={{ '--d': '0.15s', '--t': '0.7s' } as React.CSSProperties} />
          </g>
        )}

        {/* El eco: nace sobre la figura y se separa hacia la derecha */}
        <g mask={`url(#${id}e)`}>
          <g mask={`url(#${id}f)`}>
            <g className="in-logo-echo" transform={`translate(${TWIN_DX} 0)`}>
              <g className="in-logo-echo-in">
                <g className="in-logo-accent">{figure}</g>
                <g className="in-logo-scan">
                  {[58, 64, 70, 76, 82, 88].map((y) => <path key={y} d={`M${y < 62 ? 35 : 32} ${y}H${y < 62 ? 65 : 68}`} />)}
                </g>
              </g>
            </g>
          </g>
        </g>

        <g mask={`url(#${id}f)`}>
          <g className="in-logo-body">{figure}</g>
        </g>

        {!community && (
          <>
            <path className="in-logo-accent in-logo-draw" d={ORBIT_FRONT} pathLength={1} style={{ '--d': '0.6s', '--t': '0.75s' } as React.CSSProperties} />
            <circle className="in-logo-sat in-logo-sat-s" cx="110.07" cy="41.77" r="4.2" />
            <circle className="in-logo-sat in-logo-sat-m" cx="0" cy="0" r="4.2" />
          </>
        )}
      </svg>
      {!compact && (
        <span className="in-logo-text" aria-hidden="true">
          <span className="in-logo-word">
            {'AstroTwin'.split('').map((ch, i) => (
              <span key={i} className={i >= 5 ? 'tw' : ''} style={{ '--i': i } as React.CSSProperties}>{ch}</span>
            ))}
          </span>
          {under && <span className="in-logo-sub">{under}</span>}
        </span>
      )}
    </span>
  )
}
