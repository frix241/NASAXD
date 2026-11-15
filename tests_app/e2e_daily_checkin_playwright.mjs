/* E2E real en Playwright + Chromium para POST /api/daily-checkin:
 * 1. Guarda contexto de sueño pobre y síntomas leves con consentimiento explícito.
 * 2. Verifica que la UI llama POST /api/daily-checkin (use_stored_daily_context=true)
 *    sin llamar /api/vitals/analyze ni /api/chat, y propaga sueño/síntomas, explicación
 *    determinista y reporte auditable (#vitals-checkin-report).
 * 3. Verifica confirmación humana (#btn-vitals-confirm-missions).
 * 4. Verifica emergencia por síntomas ("opresión en el pecho y no puedo respirar")
 *    sin llamada al LLM (emergency_bypass=true, mode=rules_only, 0 /api/chat).
 *
 * Ejecutar: node tests_app/e2e_daily_checkin_playwright.mjs
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.ASTROTWIN_PLAYWRIGHT_PATH || "/home/bunuelo/astrotwin-3d/node_modules/playwright"
);

function resolveUvicornBin() {
  if (process.env.ASTROTWIN_UVICORN_BIN) return process.env.ASTROTWIN_UVICORN_BIN;
  const localAppVenv = path.join(PROJECT_ROOT, ".venv_app", "bin", "uvicorn");
  if (fs.existsSync(localAppVenv)) return localAppVenv;
  return "/tmp/astrotwin_app_venv/bin/uvicorn";
}

const PORT = Number(process.env.ASTROTWIN_E2E_PORT || 8023);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Servidor no respondió en ${url}`);
}

async function main() {
  const server = spawn(
    resolveUvicornBin(),
    ["app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ASTROTWIN_LLM_BASE_URL: "http://127.0.0.1:59999",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let browser = null;
  try {
    await waitForServer(BASE_URL);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    let vitalsAnalyzeCalls = 0;
    let chatCalls = 0;
    let multiVitalCalls = 0;
    const checkinRequests = [];
    const checkinResponses = [];
    const multiVitalResponses = [];
    const multiVitalRequests = [];

    page.on("request", (req) => {
      if (req.url().endsWith("/api/vitals/analyze")) vitalsAnalyzeCalls += 1;
      if (req.url().endsWith("/api/chat")) chatCalls += 1;
      if (req.url().endsWith("/api/vitals/multi-check")) {
        multiVitalCalls += 1;
        if (req.method() === "POST") multiVitalRequests.push(JSON.parse(req.postData() || "{}"));
      }
      if (req.url().endsWith("/api/daily-checkin") && req.method() === "POST") {
        checkinRequests.push(JSON.parse(req.postData() || "{}"));
      }
    });
    page.on("response", async (res) => {
      if (res.url().endsWith("/api/daily-checkin") && res.request().method() === "POST") {
        checkinResponses.push(await res.json());
      }
      if (res.url().endsWith("/api/vitals/multi-check") && res.request().method() === "POST") {
        multiVitalResponses.push(await res.json());
      }
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#vitals-checkin-report");

    const originalTitle = await page.locator("h1").textContent();
    await page.selectOption("#app-language", "en");
    assert.match(await page.locator("h1").textContent(), /Mission Health Console/);
    await page.selectOption("#app-language", "es");
    assert.equal(await page.locator("h1").textContent(), originalTitle, "Spanish UI should restore after switching back from English");
    await page.selectOption("#dc-profile", "C002-sim");
    assert.equal(await page.locator("#mv-profile").inputValue(), "C002-sim", "Daily and multi-vital profile selectors stay aligned");
    await page.selectOption("#dc-profile", "C001-sim");

    const countBeforeContext = checkinRequests.length;

    // 1. Guardar contexto diario con sueño pobre y síntomas leves (consentimiento explícito)
    await page.selectOption("#dc-sleep", "poor");
    await page.selectOption("#dc-activity", "rest");
    await page.fill("#dc-symptoms-text", "tengo fatiga y mareo leve");
    await page.check("#dc-consent-session");
    await page.click('#daily-context-form button[type="submit"]');

    await page.waitForFunction(
      (prev) => document.querySelectorAll("#vitals-checkin-report").length >= 1 && prev >= 0,
      countBeforeContext
    );
    await page.waitForSelector("#vitals-daily-context-banner");
    await page.waitForFunction(
      (expectedLen) => window.__chkDone || true,
      0
    );
    // Esperar a que llegue la nueva respuesta de /api/daily-checkin con contexto de sueño
    await page.waitForFunction(() => {
      const b = document.getElementById("vitals-daily-context-banner");
      return b && b.textContent.includes("poor");
    });

    assert.ok(checkinRequests.length > countBeforeContext, "Debe llamar POST /api/daily-checkin tras guardar contexto");
    const lastReq = checkinRequests.at(-1);
    const lastRes = checkinResponses.at(-1);
    assert.equal(lastReq.use_stored_daily_context, true);
    assert.equal(lastReq.use_llm, false);
    assert.equal(lastRes.daily_context_applied.sleep_rest_value, "poor");
    assert.equal(
      lastRes.daily_context_applied.has_active_symptoms,
      true,
      "Debe propagar síntomas activos al resultado"
    );
    assert.ok(await page.isVisible("#vitals-deterministic-explanation"));
    assert.ok(await page.isVisible("#vitals-checkin-report"));

    // 2. El panel multivital usa el perfil y el contexto confirmado, genera guía
    // de reposo/remedición con reglas y no invoca el modelo.
    await page.fill("#mv-heart-rate", "112");
    await page.click("#mv-submit");
    await page.waitForFunction(() => {
      const out = document.getElementById("multi-vitals-output");
      return out && out.textContent.toLowerCase().includes("descansa 5 minutos");
    });
    const multiRes = multiVitalResponses.at(-1);
    assert.equal(multiVitalCalls, 1);
    assert.equal(multiVitalRequests.at(-1).profile_id, "C001-sim");
    assert.equal(multiRes.context_used.daily_context_found, true);
    assert.equal(multiRes.context_used.recent_activity, "rest");
    assert.equal(multiRes.zone_highlight, "thorax");
    assert.equal(multiRes.llm_used, false);

    // 2b. Las métricas de misión atraviesan UI → API → zona 3D sin
    // convertirse en signos diarios ni escalar automáticamente a atención médica.
    await page.fill("#mv-heart-rate", "");
    await page.fill("#mv-hydration", "900");
    await page.fill("#mv-muscle-strength", "75");
    await page.fill("#mv-bone-density", "92");
    await page.selectOption("#mv-bone-site", "hip_spine");
    await page.fill("#mv-radiation-dose", "4");
    await page.evaluate(() => {
      window.__last3DEvent = null;
      window.addEventListener("astrotwin:integration-3d", (event) => {
        window.__last3DEvent = event.detail;
      }, { once: true });
    });
    await page.click("#mv-submit");
    await page.waitForFunction(() => {
      const out = document.getElementById("multi-vitals-output");
      return out && out.textContent.includes("Fuerza muscular vs. línea base");
    });
    const missionRes = multiVitalResponses.at(-1);
    assert.equal(missionRes.mission_review_required, true);
    assert.equal(missionRes.contact_medical_team, false);
    assert.equal(missionRes.zone_highlight, "musculoskeletal");
    assert.equal(missionRes.integration_3d.zone, "musculoskeletal");
    assert.ok(missionRes.sources.some((source) => source.title.includes("NASA")));
    assert.ok(await page.locator("[data-metric-status='unassessed']").count() >= 1);
    assert.equal(await page.evaluate(() => window.__last3DEvent.zone), "musculoskeletal");

    // 2. Confirmación humana explícita
    await page.click("#btn-vitals-confirm-missions");
    await page.waitForFunction(() => {
      const s = document.getElementById("vitals-confirm-status");
      return s && s.textContent.includes("Misiones simuladas confirmadas");
    });

    // 3. Emergencia determinista sin llamada al LLM
    await page.fill("#vitals-symptoms", "opresión en el pecho y no puedo respirar");
    const beforeEmergency = checkinResponses.length;
    await page.click('#vitals-analyze-form button[type="submit"]');
    await page.waitForSelector(".vitals-urgent-medical-box");
    await page.waitForSelector("#vitals-emergency-bypass-note");

    assert.ok(checkinResponses.length > beforeEmergency);
    const emergRes = checkinResponses.at(-1);
    assert.equal(emergRes.contact_medical_team, true);
    assert.equal(emergRes.policy_action, "stop_and_contact_medical");
    assert.equal(emergRes.provenance.mode, "rules_only");
    assert.equal(emergRes.provenance.llm_available, false);
    assert.equal(emergRes.provenance.safety_audit.emergency_bypass, true);

    assert.equal(vitalsAnalyzeCalls, 0, "No debe llamar /api/vitals/analyze");
    assert.equal(chatCalls, 0, "No debe llamar /api/chat (ni LLM)");
    assert.equal(pageErrors.length, 0, `Errores JS: ${pageErrors.join("; ")}`);

    console.log("PASS e2e_daily_checkin_playwright (voice context -> multi-vital rest guidance -> confirm -> emergency without LLM)");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("FAIL e2e_daily_checkin_playwright:", err);
  process.exit(1);
});
