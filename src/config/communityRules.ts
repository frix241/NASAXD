/**
 * Umbrales del perfil "Comunidad rural: heladas y friaje".
 * Único lugar donde viven: cambia aquí y cambia todo el motor de reglas.
 *
 * IMPORTANTE: todos los números son VALORES DE EJEMPLO para la demostración.
 * No son una norma clínica. Antes de cualquier uso real hay que validarlos con
 * las normas del MINSA (AIEPI) y con personal de salud de la zona.
 */
export const COMMUNITY_RULES = {
  note: 'Sample values. Validate against MINSA (AIEPI) guidelines before real-world use.',

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
  { id: 'resp-menor-2-meses', what: 'Fast breathing, under 2 months', value: `${R.breathing.under2Months} or more per minute` },
  { id: 'resp-2-11-meses', what: 'Fast breathing, 2 to 11 months', value: `${R.breathing.from2To11Months} or more per minute` },
  { id: 'resp-1-4-anios', what: 'Fast breathing, 1 to 4 years', value: `${R.breathing.from1To4Years} or more per minute` },
  { id: 'resp-adulto', what: 'Fast breathing, adult', value: `${R.breathing.adult} or more per minute` },
  { id: 'resp-adulto-mayor', what: 'Fast breathing, older adult', value: `${R.breathing.elder} or more per minute` },
  {
    id: 'resp-altitud', what: 'Breathing adjustment for elevation',
    value: `+${R.breathing.altitude.midAdd} from ${R.breathing.altitude.midFrom} m; +${R.breathing.altitude.highAdd} above ${R.breathing.altitude.highFrom} m`,
  },
  { id: 'resp-muy-rapida', what: 'Very fast breathing (refer)', value: `threshold + ${R.breathing.veryFastMargin} per minute` },
  { id: 'sat-baja', what: `Low oxygen saturation, below ${R.spo2.mid.from} m`, value: `below ${R.spo2.low.watch}% monitor; below ${R.spo2.low.refer}% refer` },
  {
    id: 'sat-media', what: `Low oxygen saturation, ${R.spo2.mid.from} to ${R.spo2.high.above} m`,
    value: `below ${R.spo2.mid.watch}% monitor; below ${R.spo2.mid.refer}% refer`,
  },
  { id: 'sat-alta', what: `Low oxygen saturation, above ${R.spo2.high.above} m`, value: `below ${R.spo2.high.watch}% monitor; below ${R.spo2.high.refer}% refer` },
  { id: 'temp-fiebre', what: 'Fever measured with a thermometer', value: `${coma(R.temp.fever)} °C or higher` },
  { id: 'temp-fiebre-bebe', what: 'Fever under 2 months (refer)', value: `${coma(R.temp.feverYoungInfant)} °C or higher` },
  { id: 'temp-fiebre-alta', what: 'High fever (refer)', value: `${coma(R.temp.highFever)} °C or higher` },
  { id: 'temp-frio', what: 'Low body temperature (monitor)', value: `below ${coma(R.temp.coldWatch)} °C` },
  { id: 'temp-muy-frio', what: 'Very low body temperature (refer)', value: `below ${coma(R.temp.coldRefer)} °C` },
  { id: 'posta-lejos', what: 'Health post is far away', value: `${R.post.farHours} hours or more` },
  { id: 'posta-lejos-senales', what: 'Earlier referral when the health post is far away', value: `from ${R.post.farWarnings} signs to monitor` },
  { id: 'varias-senales', what: 'Multiple signs together (refer)', value: `${R.manyWarnings} or more signs to monitor` },
  {
    id: 'confianza', what: 'Information used to determine confidence',
    value: `high: ${R.confidence.highMin} of ${R.confidence.total} questions; medium: ${R.confidence.mediumMin}; low: fewer than ${R.confidence.mediumMin}`,
  },
  { id: 'helada-caida', what: 'Temperature drop in simulated frost', value: `${R.frost.drop} °C below a typical early-morning temperature` },
]

function coma(n: number): string { return n.toFixed(1) }
