import type { ScenarioId, SimulationFrame } from "../contracts";
import { evaluateAlert, scenarioVitals } from "./scenarios";

/**
 * Pure, deterministic snapshot of the simulated telemetry.
 * Negative or non-finite time is treated as 0; invalid scenario ids fall back
 * to 'nominal'. The returned object is always fresh and never frozen input.
 */
export function getSimulationFrame(
  scenario: ScenarioId,
  elapsedSeconds: number,
): SimulationFrame {
  const safeScenario: ScenarioId =
    typeof scenario === "string" ? scenario : "nominal";
  const vitals = scenarioVitals(safeScenario, elapsedSeconds);
  return {
    vitals,
    alert: evaluateAlert(vitals),
    source: "simulated",
  };
}
