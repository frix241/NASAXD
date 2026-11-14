import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_THRESHOLDS,
  MAX_ELAPSED_SECONDS,
  SCENARIO_IDS,
  VITAL_RANGES,
  getSimulationFrame,
} from "./index";
import type { SimulationFrame, Vitals } from "./index";

const SAMPLE_TIMES = [0, 0.25, 1, 3, 5, 10, 60, 3600];

function expectFiniteVitals(vitals: Vitals) {
  for (const key of Object.keys(VITAL_RANGES) as Array<keyof Vitals>) {
    expect(Number.isFinite(vitals[key]), `${key} should be finite`).toBe(true);
    expect(vitals[key]).toBeGreaterThanOrEqual(VITAL_RANGES[key].min);
    expect(vitals[key]).toBeLessThanOrEqual(VITAL_RANGES[key].max);
  }
}

function crossedThresholds(vitals: Vitals) {
  const crossed: string[] = [];
  if (vitals.bpm >= ALERT_THRESHOLDS.heart.bpm) crossed.push("heart.bpm");
  if (vitals.systolic >= ALERT_THRESHOLDS.heart.systolic)
    crossed.push("heart.systolic");
  if (vitals.diastolic >= ALERT_THRESHOLDS.heart.diastolic)
    crossed.push("heart.diastolic");
  if (vitals.spo2 <= ALERT_THRESHOLDS.lungs.spo2) crossed.push("lungs.spo2");
  if (vitals.respiratoryRate >= ALERT_THRESHOLDS.lungs.respiratoryRate)
    crossed.push("lungs.rr");
  if (vitals.temperature >= ALERT_THRESHOLDS.thermal.temperature)
    crossed.push("thermal.temperature");
  if (vitals.radiation >= ALERT_THRESHOLDS.suit.radiation)
    crossed.push("suit.radiation");
  return crossed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSimulationFrame — escenarios", () => {
  it("returns finite, in-range simulated vitals for every scenario and time", () => {
    for (const scenario of SCENARIO_IDS) {
      for (const seconds of SAMPLE_TIMES) {
        const frame = getSimulationFrame(scenario, seconds);
        expect(frame.source).toBe("simulated");
        expectFiniteVitals(frame.vitals);
      }
    }
  });

  it("uses µSv/h ambient radiation as a small fictional baseline in nominal", () => {
    const { vitals } = getSimulationFrame("nominal", 30);
    expect(vitals.radiation).toBeGreaterThan(0);
    expect(vitals.radiation).toBeLessThan(1);
  });

  it("is deterministic for identical inputs", () => {
    for (const scenario of SCENARIO_IDS) {
      const a = getSimulationFrame(scenario, 12.5);
      const b = getSimulationFrame(scenario, 12.5);
      expect(a).toEqual(b);
      expect(a.vitals).not.toBe(b.vitals);
    }
  });

  it("does not call Math.random or Date.now", () => {
    const random = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    for (const scenario of SCENARIO_IDS) {
      getSimulationFrame(scenario, 7.25);
    }
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("treats negative and non-finite time as the t=0 reset baseline", () => {
    for (const scenario of SCENARIO_IDS) {
      const baseline = getSimulationFrame(scenario, 0);
      expect(getSimulationFrame(scenario, -12)).toEqual(baseline);
      expect(getSimulationFrame(scenario, Number.NaN)).toEqual(baseline);
      expect(getSimulationFrame(scenario, Number.POSITIVE_INFINITY)).toEqual(
        baseline,
      );
      expect(getSimulationFrame(scenario, Number.NEGATIVE_INFINITY)).toEqual(
        baseline,
      );
    }
  });

  it("clamps very large finite time to a stable finite horizon", () => {
    expect(getSimulationFrame("thermal", MAX_ELAPSED_SECONDS + 5.5)).toEqual(
      getSimulationFrame("thermal", MAX_ELAPSED_SECONDS),
    );
    expectFiniteVitals(getSimulationFrame("cardiac", 1e12).vitals);
  });

  it("falls back to nominal for an unknown scenario id", () => {
    const fallback = getSimulationFrame("unknown" as never, 10);
    expect(fallback).toEqual(getSimulationFrame("nominal", 10));
  });

  it("returns a fresh frame each call so callers cannot corrupt later frames", () => {
    const first = getSimulationFrame("cardiac", 20);
    first.vitals.bpm = -1;
    const second = getSimulationFrame("cardiac", 20);
    expect(second.vitals.bpm).toBeGreaterThan(0);
  });
});

describe("getSimulationFrame — alertas de demo", () => {
  it("never alerts in nominal, even after a long simulated time", () => {
    expect(getSimulationFrame("nominal", 0).alert).toBeNull();
    expect(getSimulationFrame("nominal", 120).alert).toBeNull();
  });

  it("does not alert before the scenario change crosses its demo threshold", () => {
    for (const scenario of [
      "cardiac",
      "respiratory",
      "thermal",
      "radiation",
    ] as const) {
      const frame = getSimulationFrame(scenario, 0);
      expect(frame.alert).toBeNull();
      expect(crossedThresholds(frame.vitals)).toEqual([]);
    }
  });

  it("maps each scenario to the documented organ after onset", () => {
    const expected = {
      cardiac: "heart",
      respiratory: "lungs",
      thermal: "suit",
      radiation: "suit",
    } as const;
    for (const [scenario, organ] of Object.entries(expected)) {
      const frame = getSimulationFrame(scenario as keyof typeof expected, 20);
      expect(frame.alert, `${scenario} should alert`).not.toBeNull();
      expect(frame.alert?.organ).toBe(organ);
      expect(crossedThresholds(frame.vitals).length).toBeGreaterThan(0);
    }
  });

  it("raises every scenario alert within ten simulated seconds", () => {
    for (const scenario of [
      "cardiac",
      "respiratory",
      "thermal",
      "radiation",
    ] as const) {
      expect(
        getSimulationFrame(scenario, 10).alert,
        `${scenario} at 10s`,
      ).not.toBeNull();
    }
  });

  it("keeps each scenario alert mapped to its documented organ", () => {
    expect(getSimulationFrame("cardiac", 20).alert?.organ).toBe("heart");
    expect(getSimulationFrame("respiratory", 20).alert?.organ).toBe("lungs");
    expect(getSimulationFrame("thermal", 20).alert?.organ).toBe("suit");
    expect(getSimulationFrame("radiation", 20).alert?.organ).toBe("suit");
  });

  it("maps body temperature to the suit without inferring brain injury", () => {
    const alert = getSimulationFrame("thermal", 20).alert;
    expect(alert?.organ).toBe("suit");
    expect(alert?.title).toContain("Temperatura corporal");
    expect(alert?.message).toContain("temperatura corporal simulada");
    expect(alert?.message).toContain("no implica lesión cerebral");
    expect(alert?.message).not.toContain("daño cerebral");
  });

  it("clears the alert when returning to nominal", () => {
    expect(getSimulationFrame("cardiac", 30).alert).not.toBeNull();
    expect(getSimulationFrame("nominal", 30).alert).toBeNull();
  });

  it("writes non-diagnostic Simulated copy with a demo warning", () => {
    const alert = getSimulationFrame("thermal", 20).alert;
    expect(alert).not.toBeNull();
    const text =
      `${alert?.title} ${alert?.message} ${alert?.recommendation}`.toLowerCase();
    expect(text).toContain("simulad");
    expect(text).toContain("no un diagnóstico");
    expect(alert?.title.length).toBeGreaterThan(0);
  });

  it("produces a frame matching SimulationFrame and a simulated source", () => {
    const frame: SimulationFrame = getSimulationFrame("radiation", 10);
    expect(frame.source).toBe("simulated");
    expect(Object.keys(frame).sort()).toEqual(["alert", "source", "vitals"]);
  });
});
