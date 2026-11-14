import { afterEach, describe, expect, it, vi } from "vitest";
import { BIOMECHANICS, getBiomechanics } from "./index";
import type { Vitals } from "./index";

const VITALS: Vitals = {
  bpm: 72,
  spo2: 98,
  systolic: 118,
  diastolic: 76,
  temperature: 36.7,
  radiation: 0.12,
  respiratoryRate: 14,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getBiomechanics — escala biomecánica", () => {
  it("keeps breath, heartbeat and sway within documented bounds", () => {
    for (const bpm of [42, 72, 132, 180]) {
      for (const rr of [6, 14, 28, 45]) {
        for (let t = 0; t <= 120; t += 0.13) {
          const { breath, heartbeat, sway } = getBiomechanics(
            { ...VITALS, bpm, respiratoryRate: rr },
            t,
          );
          expect(Number.isFinite(breath)).toBe(true);
          expect(Number.isFinite(heartbeat)).toBe(true);
          expect(Number.isFinite(sway)).toBe(true);
          expect(Math.abs(breath - 1)).toBeLessThanOrEqual(
            BIOMECHANICS.breathAmplitude + 1e-12,
          );
          expect(heartbeat).toBeGreaterThanOrEqual(1);
          expect(heartbeat).toBeLessThanOrEqual(
            1 + BIOMECHANICS.heartbeatAmplitude + 1e-12,
          );
          expect(Math.abs(sway)).toBeLessThanOrEqual(0.0065 + 1e-12);
        }
      }
    }
  });

  it("synchronizes breathing with respiratoryRate/60 Hz", () => {
    for (const rr of [6, 14, 28, 45]) {
      const period = 60 / rr;
      for (const t of [0.3, 2.7, 11.4, 73.2]) {
        const a = getBiomechanics({ ...VITALS, respiratoryRate: rr }, t);
        const b = getBiomechanics(
          { ...VITALS, respiratoryRate: rr },
          t + period,
        );
        expect(a.breath).toBeCloseTo(b.breath, 10);
      }
    }
  });

  it("synchronizes the heartbeat with bpm/60 Hz and never over-deforms", () => {
    for (const bpm of [42, 72, 132, 180]) {
      const period = 60 / bpm;
      for (const t of [0.2, 1.9, 9.1, 61.7]) {
        const a = getBiomechanics({ ...VITALS, bpm }, t);
        const b = getBiomechanics({ ...VITALS, bpm }, t + period);
        expect(a.heartbeat).toBeCloseTo(b.heartbeat, 10);
      }
      let peak = 0;
      for (let t = 0; t < 2 * period; t += period / 400) {
        peak = Math.max(peak, getBiomechanics({ ...VITALS, bpm }, t).heartbeat);
      }
      expect(peak).toBeLessThanOrEqual(1.0200001);
      expect(peak).toBeGreaterThan(1.019);
    }
  });

  it("keeps postural sway slow and tiny", () => {
    const dt = 0.1;
    for (let t = 0; t < 300; t += 1.7) {
      const a = getBiomechanics(VITALS, t).sway;
      const b = getBiomechanics(VITALS, t + dt).sway;
      expect(Math.abs(b - a)).toBeLessThan(0.001);
      expect(Math.abs(a)).toBeLessThanOrEqual(0.0065);
    }
  });
});

describe("getBiomechanics — robustez", () => {
  it("replaces non-finite vitals with demo defaults", () => {
    const defaults = getBiomechanics(VITALS, 3.3);
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const out = getBiomechanics(
        { ...VITALS, bpm: bad, respiratoryRate: bad },
        3.3,
      );
      expect(out).toEqual(defaults);
    }
  });

  it("treats negative and non-finite time as t=0", () => {
    const baseline = getBiomechanics(VITALS, 0);
    for (const bad of [
      -3,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(getBiomechanics(VITALS, bad)).toEqual(baseline);
    }
  });

  it("does not mutate frozen input and is deterministic", () => {
    const frozen = Object.freeze({ ...VITALS });
    const a = getBiomechanics(frozen, 5.5);
    const b = getBiomechanics(frozen, 5.5);
    expect(a).toEqual(b);
    expect(frozen.bpm).toBe(72);
  });

  it("does not call Math.random or Date.now", () => {
    const random = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    getBiomechanics(VITALS, 8.8);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("returns only the three documented factors", () => {
    const out = getBiomechanics(VITALS, 1);
    expect(Object.keys(out).sort()).toEqual(["breath", "heartbeat", "sway"]);
    for (const value of Object.values(out))
      expect(Number.isFinite(value)).toBe(true);
  });
});
