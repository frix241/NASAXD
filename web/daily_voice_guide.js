/* Guía determinista para la entrevista diaria breve por voz (Q1-Q5).
 * Sin llamadas al LLM ni diagnósticos; mapea texto confirmado por el usuario.
 */

export const DAILY_VOICE_QUESTIONS = [
  {
    key: "sleep_rest",
    step: 1,
    title: "Q1 · Sueño / descanso",
    prompt: "¿Cómo descansaste anoche: bien, regular, mal, o prefieres saltar?",
  },
  {
    key: "recent_activity",
    step: 2,
    title: "Q2 · Actividad reciente",
    prompt: "En la última hora, ¿estuviste en reposo, haciendo actividad física, recién despertando, o saltas?",
  },
  {
    key: "symptoms",
    step: 3,
    title: "Q3 · Síntomas o molestias",
    prompt: "¿Tienes algún síntoma o molestia ahora mismo, o prefieres saltar?",
  },
  {
    key: "routine_change",
    step: 4,
    title: "Q4 · Cambio respecto a rutina",
    prompt: "¿Hubo algún cambio fuerte respecto a tu rutina habitual hoy, o saltas?",
  },
  {
    key: "declared_condition",
    step: 5,
    title: "Q5 · Condición o medicación (opcional)",
    prompt: "¿Deseas declarar alguna condición o medicación solo para esta sesión, o prefieres saltar?",
  },
];

export const DAILY_VOICE_QUESTIONS_EN = [
  { key: "sleep_rest", step: 1, title: "Q1 · Sleep / rest", prompt: "How did you sleep last night: well, okay, poorly, or would you like to skip?" },
  { key: "recent_activity", step: 2, title: "Q2 · Recent activity", prompt: "In the last hour, were you resting, exercising, just waking up, or would you like to skip?" },
  { key: "symptoms", step: 3, title: "Q3 · Symptoms or discomfort", prompt: "Do you have any symptoms or discomfort right now, or would you like to skip?" },
  { key: "routine_change", step: 4, title: "Q4 · Routine changes", prompt: "Was anything significantly different from your usual routine today, or would you like to skip?" },
  { key: "declared_condition", step: 5, title: "Q5 · Condition or medication (optional)", prompt: "Would you like to report a condition or medication for this session only, or skip?" },
];

export function getDailyVoiceQuestions(language = "es") {
  return language === "en" ? DAILY_VOICE_QUESTIONS_EN : DAILY_VOICE_QUESTIONS;
}

function foldEs(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isSkipPhrase(folded) {
  if (!folded) return true;
  return /\b(saltar|salta|omitir|prefiero no responder|no responder|pasar|skip|pass|prefer not to answer)\b/.test(folded);
}

export function mapVoiceTranscriptToAnswer(questionKey, rawText, declaredConditionConsent = false) {
  const trimmed = String(rawText || "").trim();
  const folded = foldEs(trimmed);

  if (questionKey === "declared_condition") {
    if (!declaredConditionConsent || isSkipPhrase(folded) || /^(no|ninguno|ninguna|nada|none)$/.test(folded)) {
      return { status: "skipped", note: null };
    }
    return { status: "answered", note: trimmed };
  }

  if (isSkipPhrase(folded)) {
    if (questionKey === "symptoms") {
      return { status: "skipped", reported_none: false, confirmed_text: null };
    }
    return { status: "skipped", value: null };
  }

  if (questionKey === "sleep_rest") {
    if (/\b(bien|bueno|buena|excelente|good|well)\b/.test(folded)) {
      return { status: "answered", value: "good" };
    }
    if (/\b(mal|malo|mala|pesimo|fatal|poor)\b/.test(folded)) {
      return { status: "answered", value: "poor" };
    }
    if (/\b(regular|mas o menos|fair|okay|ok|so so|ambiguo)\b/.test(folded)) {
      return { status: "ambiguous", value: "fair" };
    }
    return { status: "ambiguous", value: "fair" };
  }

  if (questionKey === "recent_activity") {
    if (/\b(despertando|recien despierto|levantando|just woke up|waking up|sleep_recovery)\b/.test(folded)) {
      return { status: "answered", value: "sleep_recovery" };
    }
    if (/\b(actividad|ejercicio|corriendo|caminando|entrenando|bicicleta|ergometro|activity|exercise|running|walking|working out)\b/.test(folded)) {
      return { status: "answered", value: "activity" };
    }
    if (/\b(reposo|descansando|quieto|sentado|calma|rest|resting|sitting still)\b/.test(folded)) {
      return { status: "answered", value: "rest" };
    }
    return { status: "ambiguous", value: null };
  }

  if (questionKey === "symptoms") {
    const isNone = /^(ninguno|ninguna|nada|todo bien|sin sintomas|sin molestias|none|nothing|no symptoms|i feel fine)(?:[.,!?\s].*)?$/.test(folded);
    return {
      status: "answered",
      reported_none: isNone,
      confirmed_text: trimmed,
    };
  }

  if (questionKey === "routine_change") {
    if (/\b(sin cambio|sin cambios|ningun cambio|ninguno|normal|igual|none|no change|no changes|same as usual)\b/.test(folded)) {
      return { status: "answered", value: "none" };
    }
    if (/\b(fuerte|importante|mucho|trasnocho|deshidratacion|intenso|significant|major|major_change)\b/.test(folded)) {
      return { status: "answered", value: "major_change" };
    }
    if (/\b(menor|poco|leve|ligero|minor|small|minor_change)\b/.test(folded)) {
      return { status: "answered", value: "minor_change" };
    }
    return { status: "ambiguous", value: null };
  }

  return { status: "skipped", value: null };
}

if (typeof window !== "undefined") {
  window.AstroTwinDailyVoiceGuide = {
    DAILY_VOICE_QUESTIONS,
    DAILY_VOICE_QUESTIONS_EN,
    getDailyVoiceQuestions,
    mapVoiceTranscriptToAnswer,
  };
}
