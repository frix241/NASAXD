/* Pruebas unitarias TDD para el mapeo determinista del modo guiado de voz (Q1-Q5).
 * Ejecutar: node tests_app/test_daily_voice_guided.mjs
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guide = await import(path.join(__dirname, "..", "web", "daily_voice_guide.js"));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("questions_count_is_5", () => {
  assert.equal(guide.DAILY_VOICE_QUESTIONS.length, 5);
  assert.deepEqual(
    guide.DAILY_VOICE_QUESTIONS.map((q) => q.key),
    ["sleep_rest", "recent_activity", "symptoms", "routine_change", "declared_condition"]
  );
});

check("english_questions_and_transcript_mapping", () => {
  const questions = guide.getDailyVoiceQuestions("en");
  assert.equal(questions.length, 5);
  assert.match(questions[0].prompt, /How did you sleep/i);
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("recent_activity", "I was running"), {
    status: "answered",
    value: "activity",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("symptoms", "none"), {
    status: "answered",
    reported_none: true,
    confirmed_text: "none",
  });
});

check("q1_sleep_maps_good_poor_ambiguous_and_skip", () => {
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("sleep_rest", "Dormí bien anoche"), {
    status: "answered",
    value: "good",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("sleep_rest", "Dormí mal"), {
    status: "answered",
    value: "poor",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("sleep_rest", "Más o menos"), {
    status: "ambiguous",
    value: "fair",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("sleep_rest", "Prefiero no responder"), {
    status: "skipped",
    value: null,
  });
});

check("q2_recent_activity_maps_rest_activity_sleep_recovery_ambiguous_skip", () => {
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("recent_activity", "Estuve en reposo"), {
    status: "answered",
    value: "rest",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("recent_activity", "Haciendo actividad física"), {
    status: "answered",
    value: "activity",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("recent_activity", "Recién despertando"), {
    status: "answered",
    value: "sleep_recovery",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("recent_activity", "No estoy seguro"), {
    status: "ambiguous",
    value: null,
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("recent_activity", "Saltar"), {
    status: "skipped",
    value: null,
  });
});

check("q3_symptoms_maps_none_active_and_skip", () => {
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("symptoms", "Ninguno, todo bien"), {
    status: "answered",
    reported_none: true,
    confirmed_text: "Ninguno, todo bien",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("symptoms", "No tengo dolor en el pecho"), {
    status: "answered",
    reported_none: false,
    confirmed_text: "No tengo dolor en el pecho",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("symptoms", "Saltar"), {
    status: "skipped",
    reported_none: false,
    confirmed_text: null,
  });
});

check("q4_routine_change_maps_none_minor_major_ambiguous_skip", () => {
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("routine_change", "Sin cambios"), {
    status: "answered",
    value: "none",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("routine_change", "Un cambio menor"), {
    status: "answered",
    value: "minor_change",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("routine_change", "Cambio fuerte por trasnocho"), {
    status: "answered",
    value: "major_change",
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("routine_change", "No sabría decir"), {
    status: "ambiguous",
    value: null,
  });
});

check("q5_declared_condition_respects_consent_and_skip", () => {
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("declared_condition", "Saltar", false), {
    status: "skipped",
    note: null,
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("declared_condition", "Asma leve", false), {
    status: "skipped",
    note: null,
  });
  assert.deepEqual(guide.mapVoiceTranscriptToAnswer("declared_condition", "Asma leve", true), {
    status: "answered",
    note: "Asma leve",
  });
});

console.log(`\n${passed} checks passed`);
