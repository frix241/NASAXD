import '../../community-backdrop.css'

/**
 * Fondo permanente del perfil comunidad: amanecer en la sierra, con cerros nevados,
 * una casa de adobe e ichu con escarcha. Es decorativo: va detrás de todo, no recibe toques
 * y usa tonos cercanos al fondo para que el texto siga leyéndose a pleno sol.
 */
export function CommunityBackdrop() {
  const ichu = Array.from({ length: 46 }, (_, i) => {
    const x = (i * 97 + 31) % 1440
    const y = 846 + ((i * 53) % 46)
    const h = 14 + ((i * 29) % 16)
    return `M${x} ${y}l-3 ${-h}M${x} ${y}l1 ${-h - 4}M${x} ${y}l5 ${-h + 2}`
  }).join('')
  return (
    <div className="cm-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="bdSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="bd-sky0" /><stop offset="0.55" className="bd-sky1" /><stop offset="1" className="bd-sky2" />
          </linearGradient>
          <radialGradient id="bdSun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" className="bd-sun0" /><stop offset="0.35" className="bd-sun1" /><stop offset="1" className="bd-sun2" />
          </radialGradient>
          <linearGradient id="bdMist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="bd-mist0" /><stop offset="1" className="bd-mist1" />
          </linearGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#bdSky)" />
        <circle className="bd-glow" cx="1010" cy="560" r="330" fill="url(#bdSun)" />
        <circle className="bd-disc" cx="1010" cy="560" r="46" />
        {/* Cerros lejanos con nieve */}
        <path className="bd-m1" d="M0 640L120 560L230 610L380 470L500 575L640 500L790 600L930 520L1080 590L1230 480L1340 560L1440 510V900H0Z" />
        <path className="bd-snow" d="M380 470L425 512L398 506L372 524L345 503ZM1230 480L1272 520L1246 513L1222 532L1196 512ZM640 500L672 532L650 527L628 541L608 524Z" />
        {/* Cerros medios */}
        <path className="bd-m2" d="M0 720L170 640L300 700L470 610L610 690L760 640L900 715L1060 650L1210 705L1330 655L1440 700V900H0Z" />
        <rect className="bd-mist" x="0" y="660" width="1440" height="120" fill="url(#bdMist)" />
        {/* Lomas cercanas, casa de adobe e ichu */}
        <path className="bd-m3" d="M0 800C200 760 380 790 560 775C760 758 900 800 1100 780C1240 766 1350 790 1440 772V900H0Z" />
        <g className="bd-house">
          <path d="M214 786h92v-40h-92z" /><path className="bd-roof" d="M204 748l56-30l56 30z" />
          <path className="bd-door" d="M250 786v-24h18v24z" />
          <path className="bd-smoke" d="M292 716c-10-14 10-22 0-38c-8-14 8-20 2-34" />
        </g>
        <path className="bd-ichu" d={ichu} />
      </svg>
    </div>
  )
}
