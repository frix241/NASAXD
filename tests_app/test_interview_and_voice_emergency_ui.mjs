/* Tests dedicados para el renderizado de medical_contact_notice/policy_action en
 * POST /api/interview y la respuesta determinista de emergencia en el camino
 * rules-only de voz (consultCopilot / buildVoiceCopilotView) en web/app.js.
 *
 * Ejecutar: node tests_app/test_interview_and_voice_emergency_ui.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "web", "app.js"), "utf8");

function extract(name) {
  const start =
    src.indexOf(`async function ${name}(`) !== -1
      ? src.indexOf(`async function ${name}(`)
      : src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`No se encontró ${name} en web/app.js`);
  let j = src.indexOf("(", start);
  let parens = 1;
  j++;
  while (parens > 0 && j < src.length) {
    if (src[j] === "(") parens++;
    else if (src[j] === ")") parens--;
    j++;
  }
  while (src[j] !== "{") j++;
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, k + 1);
    }
  }
  throw new Error(`Función ${name} sin cerrar`);
}

function makeSandbox({ voiceApiImpl } = {}) {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      elements.set(id, { id, value: "C001-sim", hidden: false, disabled: false, innerHTML: "", textContent: "" });
    }
    return elements.get(id);
  };
  const calls = { status: [], error: [], reply: [], speak: [] };
  const ctx = {
    window: { AstroTwinLocale: { get: () => "es" } },
    document: { getElementById: getEl },
    esc: (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;"),
    voiceStatus: (t) => calls.status.push(t),
    voiceError: (t) => calls.error.push(t),
    voiceReply: (h) => calls.reply.push(h),
    speakReply: (t) => calls.speak.push(t),
    voiceApi: voiceApiImpl || (async () => ({})),
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      extract("renderInterviewOutputHtml"),
      extract("renderEmergencyBannerHtml"),
      extract("buildVoiceCopilotView"),
      extract("consultCopilot"),
    ].join("\n\n"),
    ctx
  );
  return { ctx, calls, elements };
}

// 1. Interview: respuesta normal sin escalamiento
{
  const { ctx } = makeSandbox();
  const html = ctx.renderInterviewOutputHtml({
    interview_id: "int_123",
    proposed_missions: [
      { mission_id: "m1", title: "Movilidad suave", duration_min: 10, intensity: "low", reason: "Descanso normal" },
    ],
    integration_3d: [],
    policy_action: null,
    contact_medical_team: false,
    medical_contact_notice: null,
  });
  assert.ok(!html.includes("interview-medical-notice"));
  assert.ok(html.includes("pendiente de confirmación humana"));
  assert.ok(html.includes("btn-open-confirm"));
  assert.ok(html.includes("Movilidad suave"));
}

// 2. Interview: alerta urgente con policy_action y medical_contact_notice
{
  const { ctx } = makeSandbox();
  const html = ctx.renderInterviewOutputHtml({
    interview_id: "int_urg",
    proposed_missions: [
      { mission_id: "stop_and_contact_medical", title: "Detener actividad", duration_min: 1, intensity: "paused", reason: "Alerta roja" },
    ],
    integration_3d: [{ zone: "chest", severity: "priority" }],
    policy_action: "stop_and_contact_medical",
    contact_medical_team: true,
    medical_contact_notice: "Detén la actividad física y contacta al equipo médico.",
  });
  assert.ok(html.includes('id="interview-medical-notice"'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes("stop_and_contact_medical"));
  assert.ok(html.includes("Detén la actividad física y contacta al equipo médico."));
  assert.ok(html.includes("pendiente de confirmación humana"));
  assert.ok(html.includes("btn-open-confirm"));
}

// 3. Interview: respuesta vacía / incompleta
{
  const { ctx } = makeSandbox();
  const htmlEmpty = ctx.renderInterviewOutputHtml(null);
  assert.ok(htmlEmpty.includes("state-box--error"));
  assert.ok(htmlEmpty.includes("Respuesta vacía o incompleta"));
}

// 4. Voz rules-only: respuesta normal
{
  const { ctx, calls } = makeSandbox({
    voiceApiImpl: async () => ({
      disclaimer: "Orientación operativa; no es un diagnóstico.",
      provenance: { mode: "rules_only", safety_audit: {} },
      rules_assessment: { observations: ["Frecuencia cardíaca en rango habitual."] },
      llm_output: null,
      integration_3d: [],
    }),
  });
  await ctx.consultCopilot("¿Cómo estoy hoy?");
  assert.equal(calls.error.length, 0);
  assert.ok(calls.status.at(-1).includes("Ninguna misión se confirmó automáticamente"));
  assert.ok(calls.reply[0].includes("Frecuencia cardíaca en rango habitual."));
  assert.ok(!calls.reply[0].includes("ptt-emergency-banner"));
  assert.equal(calls.speak[0], "Frecuencia cardíaca en rango habitual.");
}

// 5. Voz rules-only: emergencia determinista (emergency_bypass=true, llm_output.answer)
{
  const { ctx, calls } = makeSandbox({
    voiceApiImpl: async () => ({
      disclaimer: "Orientación operativa; no es un diagnóstico.",
      provenance: {
        mode: "rules_only",
        safety_audit: { emergency_bypass: true, model_consulted: false },
      },
      rules_assessment: { observations: ["Bandera roja respiratoria."], proposed_actions: [] },
      llm_output: {
        answer: "Detén toda actividad física y contacta de inmediato al equipo médico.",
        safety_note: "Respuesta determinista sin LLM; no constituye diagnóstico.",
      },
      integration_3d: [{ zone: "chest", severity: "priority" }],
    }),
  });
  await ctx.consultCopilot("No puedo respirar");
  assert.equal(calls.error.length, 0);
  assert.ok(calls.status.at(-1).includes("Emergencia detectada"));
  assert.ok(calls.status.at(-1).includes("sin LLM"));
  assert.ok(calls.reply[0].includes('id="ptt-emergency-banner"'));
  assert.ok(calls.reply[0].includes('role="alert"'));
  assert.ok(calls.reply[0].includes("Detén toda actividad física y contacta de inmediato al equipo médico."));
  assert.equal(calls.speak[0], "Detén toda actividad física y contacta de inmediato al equipo médico.");
}

// 6. Voz rules-only: respuesta vacía y error de red
{
  const s1 = makeSandbox({ voiceApiImpl: async () => null });
  await s1.ctx.consultCopilot("Hola");
  assert.equal(s1.calls.error.length, 1);
  assert.ok(s1.calls.error[0].includes("Respuesta vacía"));

  const s2 = makeSandbox({
    voiceApiImpl: async () => {
      throw new Error("HTTP 503");
    },
  });
  await s2.ctx.consultCopilot("Hola");
  assert.equal(s2.calls.error.length, 1);
  assert.ok(s2.calls.error[0].includes("Error en /api/chat: HTTP 503"));
}

console.log("6/6 checks passed");
