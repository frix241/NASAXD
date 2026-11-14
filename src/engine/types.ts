import type { OrganId, ScenarioId, Vitals } from "../contracts";

export type { OrganId, ScenarioId, Vitals };

export interface SimulationAlert {
  organ: OrganId;
  title: string;
  message: string;
  recommendation: string;
}

export interface Biomechanics {
  breath: number;
  heartbeat: number;
  sway: number;
}

export type DiagnosticSource = "simulated" | "external";

export interface DiagnosticObservation {
  label: string;
  value: number;
  unit: string;
}

export interface SimulatedDiagnosticInput {
  readonly source: "simulated";
  readonly scenario: ScenarioId;
  readonly elapsedSeconds: number;
  readonly vitals: Vitals;
}

export interface ExternalDiagnosticObservation extends DiagnosticObservation {
  readonly timestampIso?: string;
}

export interface ExternalDiagnosticInput {
  readonly source: "external";
  readonly subjectRef: string;
  readonly observations: ReadonlyArray<ExternalDiagnosticObservation>;
  readonly clinicalNote?: string;
}

export type DiagnosticInput =
  SimulatedDiagnosticInput | ExternalDiagnosticInput;

export type DiagnosticStatus = "unavailable";

export interface DiagnosticResult {
  status: DiagnosticStatus;
  source: DiagnosticSource;
  clinicalModel: "none";
  summary: string;
  observations: ReadonlyArray<DiagnosticObservation>;
  limitations: ReadonlyArray<string>;
  disclaimer: string;
}

export type DiagnosticErrorCode =
  "INVALID_INPUT" | "UNSUPPORTED_SOURCE" | "NON_FINITE_VALUE";

export class DiagnosticEngineError extends Error {
  readonly code: DiagnosticErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: DiagnosticErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "DiagnosticEngineError";
    this.code = code;
    this.details = details;
  }
}
