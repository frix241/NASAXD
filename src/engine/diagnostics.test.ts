import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticEngineError, DiagnosticEngineStub } from "./index";
import type {
  DiagnosticInput,
  SimulatedDiagnosticInput,
  Vitals,
} from "./index";

const VITALS: Vitals = {
  bpm: 72,
  spo2: 98,
  systolic: 118,
  diastolic: 76,
  temperature: 36.7,
  radiation: 0.12,
  respiratoryRate: 14,
};

const SIMULATED: SimulatedDiagnosticInput = Object.freeze({
  source: "simulated",
  scenario: "cardiac",
  elapsedSeconds: 12,
  vitals: Object.freeze({ ...VITALS }),
});

const stub = new DiagnosticEngineStub();

afterEach(() => {
  vi.restoreAllMocks();
});

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("expected a DiagnosticEngineError");
  } catch (error) {
    expect(error).toBeInstanceOf(DiagnosticEngineError);
    expect((error as DiagnosticEngineError).code).toBe(code);
  }
}

describe("DiagnosticEngineStub — contrato explícito", () => {
  it("is async and always reports that no clinical model is connected", async () => {
    const pending = stub.evaluate(SIMULATED);
    expect(pending).toBeInstanceOf(Promise);
    const result = await pending;
    expect(result.status).toBe("unavailable");
    expect(result.clinicalModel).toBe("none");
    expect(result.source).toBe("simulated");
    expect(result.summary).toContain("No hay un LLM clínico");
    expect(result.summary).toContain("sin interpretarlas");
    expect(result.observations).toHaveLength(7);
    for (const observation of result.observations) {
      expect(Number.isFinite(observation.value)).toBe(true);
      expect(observation.unit.length).toBeGreaterThan(0);
    }
    expect(Array.isArray(result.limitations)).toBe(true);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.disclaimer).toContain("No es un dispositivo médico");
    expect("diagnosis" in result).toBe(false);
    expect("findings" in result).toBe(false);
  });

  it("is deterministic and does not mutate a frozen simulated input", async () => {
    const a = await stub.evaluate(SIMULATED);
    const b = await stub.evaluate(SIMULATED);
    expect(a).toEqual(b);
    expect(SIMULATED.vitals.bpm).toBe(72);
  });

  it("does not use the network", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network access is forbidden");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await stub.evaluate(SIMULATED);
    expect(result.status).toBe("unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps the future external contract separate from simulated state", async () => {
    const external: DiagnosticInput = {
      source: "external",
      subjectRef: "AST-EXT-001",
      observations: [
        {
          label: "Pulso",
          value: 88,
          unit: "BPM",
          timestampIso: "2026-01-01T00:00:00Z",
        },
        { label: "Temperatura", value: 37.2, unit: "°C" },
      ],
      clinicalNote: "Entrada reservada para una integración real futura.",
    };
    const result = await stub.evaluate(external);
    expect(result.source).toBe("external");
    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([
      { label: "Pulso", value: 88, unit: "BPM" },
      { label: "Temperatura", value: 37.2, unit: "°C" },
    ]);
    expect(result.summary).toContain("AST-EXT-001");
  });
});

describe("DiagnosticEngineStub — errores tipados", () => {
  it("rejects unknown sources", async () => {
    await expectCode(
      stub.evaluate({ source: "wearable" } as never),
      "UNSUPPORTED_SOURCE",
    );
  });

  it("rejects null and non-object input", async () => {
    await expectCode(stub.evaluate(null as never), "INVALID_INPUT");
    await expectCode(stub.evaluate("vitals" as never), "INVALID_INPUT");
  });

  it("rejects unknown simulated scenarios", async () => {
    await expectCode(
      stub.evaluate({ ...SIMULATED, scenario: "space-flu" as never }),
      "INVALID_INPUT",
    );
  });

  it("rejects non-finite simulated vitals and time", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expectCode(
        stub.evaluate({ ...SIMULATED, vitals: { ...VITALS, bpm: bad } }),
        "NON_FINITE_VALUE",
      );
      await expectCode(
        stub.evaluate({ ...SIMULATED, elapsedSeconds: bad }),
        "NON_FINITE_VALUE",
      );
    }
  });

  it("rejects malformed external observations", async () => {
    await expectCode(
      stub.evaluate({ source: "external", subjectRef: "X", observations: [] }),
      "INVALID_INPUT",
    );
    await expectCode(
      stub.evaluate({
        source: "external",
        subjectRef: "",
        observations: [{ label: "Pulso", value: 80, unit: "BPM" }],
      }),
      "INVALID_INPUT",
    );
    await expectCode(
      stub.evaluate({
        source: "external",
        subjectRef: "X",
        observations: [{ label: "Pulso", value: Number.NaN, unit: "BPM" }],
      }),
      "NON_FINITE_VALUE",
    );
  });

  it("never invents pathologies in its output", async () => {
    const result = await stub.evaluate(SIMULATED);
    const output = JSON.stringify(result).toLowerCase();
    expect(output).not.toContain("cáncer");
    expect(output).not.toContain("infarto");
    expect(output).not.toContain("enfermedad");
    expect(output).not.toContain("diagnóstico confirmado");
  });
});
