import type { Biomechanics, Vitals } from "./types";
import { sanitizeElapsedSeconds, sanitizeVitals } from "./scenarios";

/**
 * Documented R3F factors.
 * - breath: dimensionless chest scale around 1, peak amplitude ±1.2 %.
 * - heartbeat: dimensionless cardiac scale around 1, peak amplitude +2 %
 *   (single systolic peak plus a smaller dicrotic bump, never negative).
 * - sway: lateral postural offset in metres, |sway| <= 7 mm, slow drift.
 * All values are pure functions of (sanitized bpm, respiratoryRate, time).
 */
export const BIOMECHANICS = {
  breathAmplitude: 0.012,
  heartbeatAmplitude: 0.02,
  swayPrimary: { amplitude: 0.004, frequencyHz: 0.05 },
  swaySecondary: { amplitude: 0.0025, frequencyHz: 0.031, phase: 1.1 },
} as const;

function pulseShape(phase: number): number {
  const p = (((phase / (2 * Math.PI)) % 1) + 1) % 1;
  const systolic = Math.exp(-(((p - 0.12) / 0.055) ** 2));
  const dicrotic = 0.35 * Math.exp(-(((p - 0.38) / 0.075) ** 2));
  return Math.min(1, systolic + dicrotic);
}

/**
 * Breathing expands at respiratoryRate / 60 Hz, the heartbeat follows
 * bpm / 60 Hz, and postural sway is a slow low-amplitude drift.
 * Non-finite vitals fall back to demo defaults; non-finite time is 0.
 */
export function getBiomechanics(
  vitals: Vitals,
  elapsedSeconds: number,
): Biomechanics {
  const safe = sanitizeVitals(vitals);
  const seconds = sanitizeElapsedSeconds(elapsedSeconds);

  const breathPhase = 2 * Math.PI * (safe.respiratoryRate / 60) * seconds;
  const heartPhase = 2 * Math.PI * (safe.bpm / 60) * seconds;

  const breath = 1 + BIOMECHANICS.breathAmplitude * Math.sin(breathPhase);
  const heartbeat =
    1 + BIOMECHANICS.heartbeatAmplitude * pulseShape(heartPhase);
  const sway =
    BIOMECHANICS.swayPrimary.amplitude *
      Math.sin(2 * Math.PI * BIOMECHANICS.swayPrimary.frequencyHz * seconds) +
    BIOMECHANICS.swaySecondary.amplitude *
      Math.sin(
        2 * Math.PI * BIOMECHANICS.swaySecondary.frequencyHz * seconds +
          BIOMECHANICS.swaySecondary.phase,
      );

  return { breath, heartbeat, sway };
}
