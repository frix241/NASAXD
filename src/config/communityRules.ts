/**
 * Umbrales del perfil "Comunidad rural: heladas y friaje".
 * Único lugar donde viven: cambia aquí y cambia todo el motor de reglas.
 *
 * IMPORTANTE: todos los números son VALORES DE EJEMPLO para la demostración.
 * No son una norma clínica. Antes de cualquier uso real hay que validarlos con
 * las normas del MINSA (AIEPI) y con personal de salud de la zona.
 */
export const COMMUNITY_RULES = {
  note: 'Valores de ejemplo. Validar con normas MINSA (AIEPI) antes de uso real.',

  // Respiraciones por minuto, contadas a mano durante un minuto completo.
  // "Respira rápido" = igual o más que el valor. Referencia AIEPI/OMS para niños;
  // los valores de adulto y adulto mayor son ejemplos propios y prudentes.
  breathing: {
    under2Months: 60, // menor de 2 meses
    from2To11Months: 50, // 2 a 11 meses
    from1To4Years: 40, // 1 a 4 años
    adult: 25, // ejemplo
    elder: 25, // ejemplo
    // En altura se respira algo más rápido: margen que se SUMA al umbral. Ejemplo, pendiente de validar.
    altitude: { midFrom: 2500, midAdd: 5, highFrom: 3500, highAdd: 10 },
    veryFastMargin: 10, // desde umbral + este margen se considera "muy rápido" y se deriva (ejemplo)
  },

  // Saturación con pulsioxímetro (%), según altitud. "Menos de" el valor.
  // Ejemplos: en altura lo normal es más bajo. Pendiente de validar por piso altitudinal.
  spo2: {
    low: { watch: 92, refer: 90 }, // por debajo de 2500 m
    mid: { from: 2500, watch: 88, refer: 85 }, // de 2500 a 3500 m
    high: { above: 3500, watch: 85, refer: 82 }, // por encima de 3500 m
  },

  // Temperatura con termómetro (°C).
  temp: {
    fever: 38.0, // desde aquí: fiebre
    feverYoungInfant: 37.5, // menor de 2 meses: fiebre desde aquí
    highFever: 39.5, // desde aquí: fiebre alta, se deriva (ejemplo)
    coldWatch: 36.0, // menos de esto: frío en el cuerpo, vigilar
    coldRefer: 35.5, // menos de esto: derivar
  },

  youngInfantMonths: 2, // por debajo de esta edad, la fiebre siempre se deriva
  babyMonths: 12, // por debajo de esta edad se recomienda contacto piel con piel

  // Distancia a la posta de salud.
  post: {
    farHours: 3, // desde cuántas horas se considera "lejos" (ejemplo)
    farWarnings: 2, // con la posta lejos, desde cuántas señales en ámbar se deriva antes
  },

  manyWarnings: 4, // desde cuántas señales en ámbar juntas se deriva, aunque la posta esté cerca

  // Confianza: cuántas de las 5 preguntas clave se respondieron
  // (tos, fiebre al tacto, abrigo, comió y tomó líquidos, respiración contada).
  confidence: { total: 5, highMin: 4, mediumMin: 2 },

  // Demostración de 48 horas de frío (no es un pronóstico).
  frost: {
    highlandFrom: 2500, // desde esta altitud se usa la oscilación de sierra
    dayRangeHighland: 17, // °C entre la madrugada y la tarde en la sierra
    dayRangeLowland: 10, // °C entre la madrugada y la tarde en la selva
    coldestHour: 5, // hora más fría
    warmestHour: 14, // hora más cálida
    drop: 8, // °C extra que cae la madrugada de helada o friaje
    dropWidthHours: 4, // cuánto dura el pico de frío
    riskNormalNight: 40, // riesgo (0–100) de una madrugada normal
  },
} as const

const R = COMMUNITY_RULES

/** Lista legible de umbrales pendientes de validar. Se muestra al usuario. */
export const PENDING_VALIDATION: { id: string; what: string; value: string }[] = [
  { id: 'resp-menor-2-meses', what: 'Respira rápido, menor de 2 meses', value: `${R.breathing.under2Months} o más por minuto` },
  { id: 'resp-2-11-meses', what: 'Respira rápido, de 2 a 11 meses', value: `${R.breathing.from2To11Months} o más por minuto` },
  { id: 'resp-1-4-anios', what: 'Respira rápido, de 1 a 4 años', value: `${R.breathing.from1To4Years} o más por minuto` },
  { id: 'resp-adulto', what: 'Respira rápido, adulto', value: `${R.breathing.adult} o más por minuto` },
  { id: 'resp-adulto-mayor', what: 'Respira rápido, adulto mayor', value: `${R.breathing.elder} o más por minuto` },
  {
    id: 'resp-altitud', what: 'Margen de respiración por altura',
    value: `+${R.breathing.altitude.midAdd} desde ${R.breathing.altitude.midFrom} m; +${R.breathing.altitude.highAdd} sobre ${R.breathing.altitude.highFrom} m`,
  },
  { id: 'resp-muy-rapida', what: 'Respira muy rápido (derivar)', value: `umbral + ${R.breathing.veryFastMargin} por minuto` },
  { id: 'sat-baja', what: `Saturación baja, bajo ${R.spo2.mid.from} m`, value: `menos de ${R.spo2.low.watch} % vigilar; menos de ${R.spo2.low.refer} % derivar` },
  {
    id: 'sat-media', what: `Saturación baja, de ${R.spo2.mid.from} a ${R.spo2.high.above} m`,
    value: `menos de ${R.spo2.mid.watch} % vigilar; menos de ${R.spo2.mid.refer} % derivar`,
  },
  { id: 'sat-alta', what: `Saturación baja, sobre ${R.spo2.high.above} m`, value: `menos de ${R.spo2.high.watch} % vigilar; menos de ${R.spo2.high.refer} % derivar` },
  { id: 'temp-fiebre', what: 'Fiebre con termómetro', value: `${coma(R.temp.fever)} °C o más` },
  { id: 'temp-fiebre-bebe', what: 'Fiebre en menor de 2 meses (derivar)', value: `${coma(R.temp.feverYoungInfant)} °C o más` },
  { id: 'temp-fiebre-alta', what: 'Fiebre alta (derivar)', value: `${coma(R.temp.highFever)} °C o más` },
  { id: 'temp-frio', what: 'Frío en el cuerpo (vigilar)', value: `menos de ${coma(R.temp.coldWatch)} °C` },
  { id: 'temp-muy-frio', what: 'Mucho frío en el cuerpo (derivar)', value: `menos de ${coma(R.temp.coldRefer)} °C` },
  { id: 'posta-lejos', what: 'Posta lejos', value: `${R.post.farHours} horas o más` },
  { id: 'posta-lejos-senales', what: 'Con posta lejos, se deriva antes', value: `desde ${R.post.farWarnings} señales para vigilar` },
  { id: 'varias-senales', what: 'Varias señales juntas (derivar)', value: `${R.manyWarnings} o más señales para vigilar` },
  {
    id: 'confianza', what: 'Datos para la confianza',
    value: `alta: ${R.confidence.highMin} de ${R.confidence.total} preguntas; media: ${R.confidence.mediumMin}; baja: menos de ${R.confidence.mediumMin}`,
  },
  { id: 'helada-caida', what: 'Caída de temperatura en la helada simulada', value: `${R.frost.drop} °C bajo la madrugada normal` },
]

function coma(n: number): string { return n.toFixed(1).replace('.', ',') }
