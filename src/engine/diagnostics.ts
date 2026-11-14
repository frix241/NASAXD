import type { ScenarioId, Vitals } from "../contracts";
import {
  DiagnosticEngineError,
  type DiagnosticInput,
  type DiagnosticObservation,
  type DiagnosticResult,
  type ExternalDiagnosticInput,
  type SimulatedDiagnosticInput,
} from "./types";
import { SCENARIO_IDS, sanitizeVitals } from "./scenarios";

const SCENARIO_LABELS: Readonly<Record<ScenarioId, string>> = {
  nominal: "Monitoreo estable",
  cardiac: "Cambio cardiovascular",
  respiratory: "Cambio respiratorio",
  thermal: "Cambio de temperatura",
  radiation: "Evento de radiación ambiental",
};

const NO_MODEL_SUMMARY =
  "No hay un LLM clínico ni un modelo diagnóstico conectado. " +
  "Esta evaluación solo confirma que la entrada es válida y devuelve las observaciones simuladas sin interpretarlas.";

const LIMITATIONS: readonly string[] = [
  "Sin conexión de red y sin modelo clínico: no se ejecuta inferencia médica.",
  "No se generan diagnósticos, patologías ni recomendaciones personalizadas.",
  "La telemetría de origen es simulada y no proviene de sensores reales.",
  "Los umbrales del simulador son de demostración y no están validados clínicamente.",
];

const DISCLAIMER =
  "Prototipo educativo. Datos simulados. No es un dispositivo médico ni sustituye la valoración de un profesional.";

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new DiagnosticEngineError("INVALID_INPUT", message, details);
}

function nonFinite(field: string, value: unknown): never {
  throw new DiagnosticEngineError(
    "NON_FINITE_VALUE",
    `El campo "${field}" debe ser un número finito.`,
    {
      field,
      value: typeof value === "number" ? value : String(value),
    },
  );
}

function finiteObservation(
  label: string,
  value: unknown,
  unit: string,
): DiagnosticObservation {
  if (typeof value !== "number" || !Number.isFinite(value))
    nonFinite(label, value);
  return { label, value, unit };
}

function simulatedObservations(vitals: Vitals): DiagnosticObservation[] {
  const safe = sanitizeVitals(vitals);
  return [
    finiteObservation("Pulso", safe.bpm, "BPM"),
    finiteObservation("Oxigenación", safe.spo2, "%"),
    finiteObservation("Presión sistólica", safe.systolic, "mmHg"),
    finiteObservation("Presión diastólica", safe.diastolic, "mmHg"),
    finiteObservation("Temperatura", safe.temperature, "°C"),
    finiteObservation(
      "Frecuencia respiratoria",
      safe.respiratoryRate,
      "resp/min",
    ),
    finiteObservation("Radiación ambiental", safe.radiation, "µSv/h"),
  ];
}

function validateVitals(vitals: unknown): Vitals {
  if (!vitals || typeof vitals !== "object")
    invalid("La entrada simulada necesita un objeto vitals.");
  const source = vitals as Partial<Vitals>;
  const keys: ReadonlyArray<keyof Vitals> = [
    "bpm",
    "spo2",
    "systolic",
    "diastolic",
    "temperature",
    "radiation",
    "respiratoryRate",
  ];
  for (const key of keys) {
    if (typeof source[key] !== "number" || !Number.isFinite(source[key]))
      nonFinite(key, source[key]);
  }
  return sanitizeVitals(source);
}

function resultFor(
  source: "simulated" | "external",
  observations: ReadonlyArray<DiagnosticObservation>,
  summary = NO_MODEL_SUMMARY,
): DiagnosticResult {
  return {
    status: "unavailable",
    source,
    clinicalModel: "none",
    summary,
    observations: observations.map((entry) => ({ ...entry })),
    limitations: [...LIMITATIONS],
    disclaimer: DISCLAIMER,
  };
}

function evaluateSimulated(input: SimulatedDiagnosticInput): DiagnosticResult {
  if (!SCENARIO_IDS.includes(input.scenario)) {
    invalid("Escenario desconocido en la entrada simulada.", {
      scenario: String(input.scenario),
    });
  }
  if (
    typeof input.elapsedSeconds !== "number" ||
    !Number.isFinite(input.elapsedSeconds)
  ) {
    nonFinite("elapsedSeconds", input.elapsedSeconds);
  }
  const observations = simulatedObservations(validateVitals(input.vitals));
  return resultFor(
    "simulated",
    observations,
    `${NO_MODEL_SUMMARY} Escenario: ${SCENARIO_LABELS[input.scenario]}.`,
  );
}

function evaluateExternal(input: ExternalDiagnosticInput): DiagnosticResult {
  if (typeof input.subjectRef !== "string" || input.subjectRef.trim() === "") {
    invalid("La entrada externa necesita un subjectRef no vacío.");
  }
  if (!Array.isArray(input.observations) || input.observations.length === 0) {
    invalid("La entrada externa necesita al menos una observación.");
  }
  const observations = input.observations.map((entry, index) => {
    if (!entry || typeof entry !== "object")
      invalid(`Observación ${index} inválida.`);
    if (typeof entry.label !== "string" || entry.label.trim() === "") {
      invalid(`La observación ${index} necesita un label no vacío.`);
    }
    if (typeof entry.unit !== "string" || entry.unit.trim() === "") {
      invalid(`La observación ${index} necesita una unidad no vacía.`);
    }
    return finiteObservation(entry.label, entry.value, entry.unit);
  });
  return resultFor(
    "external",
    observations,
    `${NO_MODEL_SUMMARY} Origen externo declarado: ${input.subjectRef}.`,
  );
}

/**
 * Stub for a future clinical diagnostic engine.
 * It validates a simulated or external input contract and always answers
 * explicitly that no clinical model is connected. It never touches the network.
 *
 * The external shape is the reserved contract for a future real integration;
 * it is intentionally separate from the simulated scenario state.
 */
export class DiagnosticEngineStub {
  async evaluate(input: DiagnosticInput): Promise<DiagnosticResult> {
    if (!input || typeof input !== "object") {
      invalid('La entrada debe ser un objeto con "source".');
    }
    const source = (input as { source?: unknown }).source;
    if (source === "simulated")
      return evaluateSimulated(input as SimulatedDiagnosticInput);
    if (source === "external")
      return evaluateExternal(input as ExternalDiagnosticInput);
    throw new DiagnosticEngineError(
      "UNSUPPORTED_SOURCE",
      'La entrada debe declarar source "simulated" o "external".',
      { source: String(source) },
    );
  }
}
