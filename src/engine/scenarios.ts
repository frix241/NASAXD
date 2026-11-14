import type { ScenarioId, SimulationAlert, Vitals } from "./types";

export const SCENARIO_IDS: readonly ScenarioId[] = [
  "nominal",
  "cardiac",
  "respiratory",
  "thermal",
  "radiation",
];

/** Upper bound for simulated elapsed time, keeps sine phases stable. */
export const MAX_ELAPSED_SECONDS = 10_000_000;

export interface VitalRange {
  min: number;
  max: number;
  fallback: number;
}

/**
 * Demo-only physical plausibility ranges used to keep engine outputs finite.
 * They are presentation clamps, not clinical reference intervals.
 */
export const VITAL_RANGES: Readonly<Record<keyof Vitals, VitalRange>> = {
  bpm: { min: 20, max: 220, fallback: 72 },
  spo2: { min: 50, max: 100, fallback: 98 },
  systolic: { min: 60, max: 260, fallback: 118 },
  diastolic: { min: 30, max: 160, fallback: 76 },
  temperature: { min: 30, max: 43, fallback: 36.7 },
  radiation: { min: 0, max: 1000, fallback: 0.12 },
  respiratoryRate: { min: 4, max: 80, fallback: 14 },
};

/**
 * Explicit demo thresholds. Crossing one of these raises a simulated alert.
 * They are deliberately simple and are NOT clinically validated.
 * Priority when several are crossed: cardiac > respiratory > thermal > radiation.
 */
export const ALERT_THRESHOLDS = {
  heart: { bpm: 120, systolic: 145, diastolic: 95 },
  lungs: { spo2: 91, respiratoryRate: 24 },
  thermal: { temperature: 38.5 },
  suit: { radiation: 20 },
} as const;

interface ScenarioProfile {
  /** Seconds until the simulated change reaches full intensity. */
  onsetSeconds: number;
  baseline: Vitals;
  crisis: Vitals;
  /** Peak amplitude of the deterministic wobble around the ramped value. */
  jitter: Vitals;
}

const PROFILE: Readonly<Record<ScenarioId, ScenarioProfile>> = {
  nominal: {
    onsetSeconds: 0,
    baseline: {
      bpm: 72,
      spo2: 98,
      systolic: 118,
      diastolic: 76,
      temperature: 36.7,
      radiation: 0.12,
      respiratoryRate: 14,
    },
    crisis: {
      bpm: 72,
      spo2: 98,
      systolic: 118,
      diastolic: 76,
      temperature: 36.7,
      radiation: 0.12,
      respiratoryRate: 14,
    },
    jitter: {
      bpm: 1.2,
      spo2: 0.3,
      systolic: 1.5,
      diastolic: 1,
      temperature: 0.05,
      radiation: 0.012,
      respiratoryRate: 0.5,
    },
  },
  cardiac: {
    onsetSeconds: 5,
    baseline: {
      bpm: 72,
      spo2: 98,
      systolic: 118,
      diastolic: 76,
      temperature: 36.7,
      radiation: 0.12,
      respiratoryRate: 14,
    },
    crisis: {
      bpm: 132,
      spo2: 95.5,
      systolic: 150,
      diastolic: 98,
      temperature: 37,
      radiation: 0.12,
      respiratoryRate: 18,
    },
    jitter: {
      bpm: 2.2,
      spo2: 0.3,
      systolic: 2,
      diastolic: 1.6,
      temperature: 0.05,
      radiation: 0.012,
      respiratoryRate: 0.6,
    },
  },
  respiratory: {
    onsetSeconds: 4,
    baseline: {
      bpm: 72,
      spo2: 98,
      systolic: 118,
      diastolic: 76,
      temperature: 36.7,
      radiation: 0.12,
      respiratoryRate: 14,
    },
    crisis: {
      bpm: 98,
      spo2: 88.5,
      systolic: 126,
      diastolic: 82,
      temperature: 36.8,
      radiation: 0.12,
      respiratoryRate: 28,
    },
    jitter: {
      bpm: 1.8,
      spo2: 0.5,
      systolic: 1.6,
      diastolic: 1.2,
      temperature: 0.05,
      radiation: 0.012,
      respiratoryRate: 1,
    },
  },
  thermal: {
    onsetSeconds: 6,
    baseline: {
      bpm: 72,
      spo2: 98,
      systolic: 118,
      diastolic: 76,
      temperature: 36.7,
      radiation: 0.12,
      respiratoryRate: 14,
    },
    crisis: {
      bpm: 108,
      spo2: 96,
      systolic: 130,
      diastolic: 86,
      temperature: 39,
      radiation: 0.12,
      respiratoryRate: 20,
    },
    jitter: {
      bpm: 1.8,
      spo2: 0.3,
      systolic: 1.8,
      diastolic: 1.4,
      temperature: 0.08,
      radiation: 0.012,
      respiratoryRate: 0.7,
    },
  },
  radiation: {
    onsetSeconds: 3,
    baseline: {
      bpm: 72,
      spo2: 98,
      systolic: 118,
      diastolic: 76,
      temperature: 36.7,
      radiation: 0.12,
      respiratoryRate: 14,
    },
    crisis: {
      bpm: 80,
      spo2: 97,
      systolic: 120,
      diastolic: 78,
      temperature: 36.8,
      radiation: 48,
      respiratoryRate: 15,
    },
    jitter: {
      bpm: 1.5,
      spo2: 0.3,
      systolic: 1.4,
      diastolic: 1,
      temperature: 0.05,
      radiation: 0.6,
      respiratoryRate: 0.5,
    },
  },
};

const OSC_FREQUENCY: Readonly<Record<keyof Vitals, number>> = {
  bpm: 0.11,
  spo2: 0.07,
  systolic: 0.09,
  diastolic: 0.13,
  temperature: 0.03,
  radiation: 0.17,
  respiratoryRate: 0.05,
};

const OSC_PHASE: Readonly<Record<keyof Vitals, number>> = {
  bpm: 0,
  spo2: 1.3,
  systolic: 2.1,
  diastolic: 0.7,
  temperature: 2.9,
  radiation: 1.9,
  respiratoryRate: 0.4,
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function sanitizeNumber(value: unknown, range: VitalRange): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, range.min, range.max)
    : range.fallback;
}

/** Negative or non-finite time is treated as t = 0, so reset is deterministic. */
export function sanitizeElapsedSeconds(elapsedSeconds: unknown): number {
  return typeof elapsedSeconds === "number" && Number.isFinite(elapsedSeconds)
    ? clamp(elapsedSeconds, 0, MAX_ELAPSED_SECONDS)
    : 0;
}

/** Replaces non-finite values and clamps to demo ranges. Always returns a new object. */
export function sanitizeVitals(vitals: unknown): Vitals {
  const source =
    vitals && typeof vitals === "object" ? (vitals as Partial<Vitals>) : {};
  return {
    bpm: sanitizeNumber(source.bpm, VITAL_RANGES.bpm),
    spo2: sanitizeNumber(source.spo2, VITAL_RANGES.spo2),
    systolic: sanitizeNumber(source.systolic, VITAL_RANGES.systolic),
    diastolic: sanitizeNumber(source.diastolic, VITAL_RANGES.diastolic),
    temperature: sanitizeNumber(source.temperature, VITAL_RANGES.temperature),
    radiation: sanitizeNumber(source.radiation, VITAL_RANGES.radiation),
    respiratoryRate: sanitizeNumber(
      source.respiratoryRate,
      VITAL_RANGES.respiratoryRate,
    ),
  };
}

function smoothstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function wobble(
  key: keyof Vitals,
  seconds: number,
  severity: number,
  jitter: number,
): number {
  const amplitude = jitter * (0.2 + 0.8 * severity);
  return (
    amplitude *
    Math.sin(2 * Math.PI * OSC_FREQUENCY[key] * seconds + OSC_PHASE[key])
  );
}

function signal(
  key: keyof Vitals,
  profile: ScenarioProfile,
  seconds: number,
): number {
  const severity =
    profile.onsetSeconds > 0 ? smoothstep(seconds / profile.onsetSeconds) : 0;
  const base = profile.baseline[key];
  const target = base + (profile.crisis[key] - base) * severity;
  return target + wobble(key, seconds, severity, profile.jitter[key]);
}

/** Pure, deterministic simulated vitals for a scenario at a given elapsed time. */
export function scenarioVitals(
  scenario: ScenarioId,
  elapsedSeconds: unknown,
): Vitals {
  const profile = PROFILE[scenario] ?? PROFILE.nominal;
  const seconds = sanitizeElapsedSeconds(elapsedSeconds);
  return {
    bpm: round(
      clamp(
        signal("bpm", profile, seconds),
        VITAL_RANGES.bpm.min,
        VITAL_RANGES.bpm.max,
      ),
      1,
    ),
    spo2: round(
      clamp(
        signal("spo2", profile, seconds),
        VITAL_RANGES.spo2.min,
        VITAL_RANGES.spo2.max,
      ),
      1,
    ),
    systolic: round(
      clamp(
        signal("systolic", profile, seconds),
        VITAL_RANGES.systolic.min,
        VITAL_RANGES.systolic.max,
      ),
      1,
    ),
    diastolic: round(
      clamp(
        signal("diastolic", profile, seconds),
        VITAL_RANGES.diastolic.min,
        VITAL_RANGES.diastolic.max,
      ),
      1,
    ),
    temperature: round(
      clamp(
        signal("temperature", profile, seconds),
        VITAL_RANGES.temperature.min,
        VITAL_RANGES.temperature.max,
      ),
      2,
    ),
    radiation: round(
      clamp(
        signal("radiation", profile, seconds),
        VITAL_RANGES.radiation.min,
        VITAL_RANGES.radiation.max,
      ),
      2,
    ),
    respiratoryRate: round(
      clamp(
        signal("respiratoryRate", profile, seconds),
        VITAL_RANGES.respiratoryRate.min,
        VITAL_RANGES.respiratoryRate.max,
      ),
      1,
    ),
  };
}

/**
 * Maps demo thresholds to an organ. Alerts are simulation notices only:
 * they contain no diagnosis and no personalised medical advice.
 */
export function evaluateAlert(vitals: Vitals): SimulationAlert | null {
  const v = sanitizeVitals(vitals);
  if (
    v.bpm >= ALERT_THRESHOLDS.heart.bpm ||
    v.systolic >= ALERT_THRESHOLDS.heart.systolic ||
    v.diastolic >= ALERT_THRESHOLDS.heart.diastolic
  ) {
    return {
      organ: "heart",
      title: "Ritmo cardiaco elevado (simulado)",
      message: `La simulación muestra ${v.bpm.toFixed(0)} BPM y ${v.systolic.toFixed(0)}/${v.diastolic.toFixed(0)} mmHg, por encima del umbral de demostración.`,
      recommendation:
        "Reduce la intensidad del escenario o vuelve a Monitoreo estable para comparar. Es una alerta de demo, no un diagnóstico.",
    };
  }
  if (
    v.spo2 <= ALERT_THRESHOLDS.lungs.spo2 ||
    v.respiratoryRate >= ALERT_THRESHOLDS.lungs.respiratoryRate
  ) {
    return {
      organ: "lungs",
      title: "Oxigenación baja (simulada)",
      message: `La simulación muestra SpO₂ ${v.spo2.toFixed(0)} % y ${v.respiratoryRate.toFixed(0)} respiraciones/min fuera del rango de demo.`,
      recommendation:
        "Revisa la vía aérea simulada y restaura el escenario. Es una alerta de demostración, no un diagnóstico.",
    };
  }
  if (v.temperature >= ALERT_THRESHOLDS.thermal.temperature) {
    return {
      organ: "suit",
      title: "Temperatura corporal elevada (simulada)",
      message: `La simulación muestra una temperatura corporal simulada de ${v.temperature.toFixed(1)} °C, por encima del umbral térmico de demostración; no implica lesión cerebral.`,
      recommendation:
        "Activa el enfriamiento simulado del traje o vuelve a Monitoreo estable. Es una alerta de demo, no un diagnóstico.",
    };
  }
  if (v.radiation >= ALERT_THRESHOLDS.suit.radiation) {
    return {
      organ: "suit",
      title: "Radiación ambiental elevada (simulada)",
      message: `Exposición ambiental ficticia de ${v.radiation.toFixed(1)} µSv/h en la simulación; no es dosis personal.`,
      recommendation:
        "Incrementa el blindaje del traje simulado o abandona el escenario de radiación. Es una alerta de demo, no un diagnóstico.",
    };
  }
  return null;
}
