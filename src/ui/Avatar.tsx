/**
 * Avatar del asistente. Reacciona al estado: parpadea en reposo, escucha con ondas,
 * piensa con puntos y mueve la boca al hablar. Una cara para cada perfil:
 * `space` es un pequeño robot de a bordo; `community` lleva chullo.
 */
export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking'

export function Avatar({ state, variant, size = 56 }: { state: AvatarState; variant: 'space' | 'community'; size?: number }) {
  return (
    <svg className={`avatar av-${state} av-${variant}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle className="av-halo" cx="32" cy="34" r="29" />
      <circle className="av-ring av-ring1" cx="32" cy="34" r="27" />
      <circle className="av-ring av-ring2" cx="32" cy="34" r="27" />
      {variant === 'space' ? (
        <>
          <path className="av-antenna" d="M32 10v-5" /><circle className="av-tip" cx="32" cy="4.5" r="2.4" />
          <rect className="av-head" x="12" y="13" width="40" height="36" rx="13" />
          <rect className="av-visor" x="17" y="20" width="30" height="19" rx="8" />
          <path className="av-ear" d="M9 27v10M55 27v10" />
        </>
      ) : (
        <>
          <circle className="av-head" cx="32" cy="36" r="19" />
          <path className="av-chullo" d="M12.5 31C13 17 22 10 32 10s19 7 19.5 21Z" />
          <path className="av-band" d="M13 27h38M17 21l4 4 4-4 4 4 4-4 4 4 4-4 4 4 4-4" />
          <path className="av-flap" d="M13.5 31l-3 14M50.5 31l3 14" /><circle className="av-pom" cx="32" cy="8" r="3.2" />
        </>
      )}
      <g className="av-eyes">
        <ellipse cx="25" cy={variant === 'space' ? 29 : 37} rx="2.8" ry="3.4" />
        <ellipse cx="39" cy={variant === 'space' ? 29 : 37} rx="2.8" ry="3.4" />
      </g>
      <rect className="av-mouth" x="27" y={variant === 'space' ? 42 : 45.5} width="10" height="2.6" rx="1.3" />
      <g className="av-dots"><circle cx="25" cy="55.5" r="1.9" /><circle cx="32" cy="55.5" r="1.9" /><circle cx="39" cy="55.5" r="1.9" /></g>
    </svg>
  )
}
