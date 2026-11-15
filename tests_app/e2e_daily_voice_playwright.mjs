/* E2E en navegador real (Playwright + Chromium) para el modo guiado por voz Q1-Q5
 * conectado al motor de vitales y política de alertas.
 *
 * Usa audio sintético pregrabado (synthetic_tts_normal.wav) mediante
 * --use-file-for-fake-audio-capture, backend FastAPI real (uvicorn) y
 * mock de /api/voice/stt en page.route. Verifica:
 * - Flujo completo Q1-Q5 con PTT, edición/confirmación y skip.
 * - Guardado único en POST /api/interview/daily-context con capture_mode=voice_ptt_confirmed.
 * - Cero llamadas a /api/chat (jamás envía respuestas de salud al LLM).
 * - Conexión automática al motor de vitales (desajuste activity vs rest -> remeasure).
 *
 * Ejecutar: node tests_app/e2e_daily_voice_playwright.mjs
 */

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const FIXTURE_WAV = path.join(__dirname, "artifacts", "voice_fixtures", "synthetic_tts_normal.wav");

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

const PORT = Number(process.env.ASTROTWIN_E2E_PORT || 8019);
const BASE_URL = `http://127.0.0.1:${PORT}`;
let activePage = null;
const serverOutput = [];

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
  throw new Error(`Servidor no respondió en ${url} dentro de ${timeoutMs}ms`);
}

async function holdGuidedPTT(page, ms = 450) {
  const btn = page.locator("#dc-voice-ptt-btn");
  await btn.scrollIntoViewIfNeeded();
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => {
    const button = document.getElementById("dc-voice-ptt-btn");
    const status = document.getElementById("dc-voice-status")?.textContent || "";
    const transcript = document.getElementById("dc-voice-transcript-zone");
    return button?.getAttribute("aria-pressed") === "true"
      || Boolean(transcript && !transcript.hidden)
      || /micr[oó]fono no disponible|modo texto|permiso de micr[oó]fono/i.test(status);
  }, { timeout: 10000 });
  if (await btn.getAttribute("aria-pressed") === "true") {
    await page.waitForTimeout(ms);
  }
  await page.mouse.up();
}

async function main() {
  assert.ok(fs.existsSync(FIXTURE_WAV), `Falta fixture de audio: ${FIXTURE_WAV}`);

  const server = spawn(
    resolveUvicornBin(),
    ["app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ASTROTWIN_LLM_BASE_URL: "http://127.0.0.1:59999",
        ASTROTWIN_VOICE_ENABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let browser = null;
  server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));
  try {
    await waitForServer(BASE_URL);

    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${FIXTURE_WAV}`,
      ],
    });
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    activePage = page;

    const pageErrors = [];
    const voiceDiagnostics = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("crash", () => voiceDiagnostics.push("page crashed"));
    page.on("console", (msg) => {
      if (msg.type() === "error") voiceDiagnostics.push(`console: ${msg.text()}`);
    });
    page.on("requestfailed", (req) => {
      if (req.url().includes("/api/voice/")) {
        voiceDiagnostics.push(`requestfailed ${req.url()}: ${req.failure()?.errorText || "unknown"}`);
      }
    });
    page.on("response", (res) => {
      if (res.url().includes("/api/voice/")) {
        voiceDiagnostics.push(`response ${res.status()} ${res.url()}`);
      }
    });

    const sttResponses = [
      "Dormí bien",
      "Haciendo actividad física",
      "No tengo dolor en el pecho",
      "Sin cambios",
    ];
    let sttIndex = 0;
    let chatCalls = 0;
    let dailyContextPayloads = [];

    // La URL lleva ?language=es; incluir la query en el patrón para que Playwright
    // intercepte el endpoint en lugar de dejarlo caer en el backend (409 sin sidecar).
    await page.route("**/api/voice/stt**", async (route) => {
      const text = sttResponses[sttIndex] || "Saltar";
      sttIndex += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          implemented_bridge: true,
          text,
          language: "es",
          requires_confirmation: true,
          confirmed_by_user: false,
        }),
      });
    });

    await page.route("**/api/chat", async (route) => {
      chatCalls += 1;
      await route.continue();
    });

    page.on("request", (req) => {
      if (req.url().endsWith("/api/interview/daily-context") && req.method() === "POST") {
        dailyContextPayloads.push(JSON.parse(req.postData() || "{}"));
      }
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    // Caso 1: Cancelar modo guiado a mitad de turno NO guarda ni llama a daily-context
    await page.click("#dc-voice-start-btn");
    await page.waitForSelector("#dc-voice-guided:not([hidden])");
    await holdGuidedPTT(page);
    try {
      await page.waitForSelector("#dc-voice-transcript-zone:not([hidden])");
    } catch (err) {
      const status = await page.locator("#dc-voice-status").textContent().catch(() => "unavailable");
      console.error(JSON.stringify({ status, pageErrors, voiceDiagnostics }));
      throw err;
    }
    await page.click("#dc-voice-cancel-btn");
    await page.waitForSelector("#dc-voice-guided[hidden]", { state: "attached" });
    assert.equal(dailyContextPayloads.length, 0, "Cancelar modo voz no debe guardar contexto");
    sttIndex = 0;

    // Caso 2: Flujo completo Q1-Q5 con PTT, edición, confirmación y skip
    await page.click("#dc-voice-start-btn");
    await page.waitForSelector("#dc-voice-guided:not([hidden])");

    // Q1: sleep_rest
    await holdGuidedPTT(page);
    await page.waitForSelector("#dc-voice-transcript-zone:not([hidden])");
    await page.click("#dc-voice-confirm-btn");

    // Q2: recent_activity
    await holdGuidedPTT(page);
    await page.waitForSelector("#dc-voice-transcript-zone:not([hidden])");
    await page.click("#dc-voice-confirm-btn");

    // Q3: symptoms (editar ligeramente antes de confirmar)
    await holdGuidedPTT(page);
    await page.waitForSelector("#dc-voice-transcript-zone:not([hidden])");
    await page.fill("#dc-voice-transcript", "No tengo dolor en el pecho, solo cansancio");
    await page.click("#dc-voice-confirm-btn");

    // Q4: routine_change
    await holdGuidedPTT(page);
    await page.waitForSelector("#dc-voice-transcript-zone:not([hidden])");
    await page.click("#dc-voice-confirm-btn");

    // Q5: declared_condition -> saltar
    await page.click("#dc-voice-skip-btn");

    // Esperar confirmación en #daily-context-output y banner en vitales
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById("daily-context-output");
        return el && el.textContent.includes("voice_ptt_confirmed");
      }, { timeout: 8000 });
    } catch (err) {
      const diagnostics = await page.evaluate(() => ({
        voiceStatus: document.getElementById("dc-voice-status")?.textContent,
        contextOutput: document.getElementById("daily-context-output")?.textContent,
        guidedHidden: document.getElementById("dc-voice-guided")?.hidden,
        voiceStep: document.getElementById("dc-voice-step")?.textContent,
      }));
      console.error("Final daily-context save diagnostics:", JSON.stringify({
        ...diagnostics, dailyContextPayloads, serverOutput: serverOutput.join("").slice(-5000),
      }, null, 2));
      throw err;
    }
    await page.waitForSelector("#vitals-daily-context-banner");

    const dcOutput = await page.textContent("#daily-context-output");
    const vitalsBanner = await page.textContent("#vitals-daily-context-banner");
    const vitalsOut = await page.textContent("#vitals-output");

    assert.equal(pageErrors.length, 0, `Errores JS en página: ${pageErrors.join("; ")}`);
    assert.equal(chatCalls, 0, "El flujo guiado de voz jamás debe llamar a /api/chat");
    assert.equal(dailyContextPayloads.length, 1, "Debe guardar exactamente una vez al finalizar Q1-Q5");

    const sent = dailyContextPayloads[0];
    assert.equal(sent.capture_mode, "voice_ptt_confirmed");
    assert.equal(sent.transcript_confirmed_by_user, true);
    assert.equal(sent.transcript_edited_by_user, true);
    assert.equal(sent.consent.session_context_consent, true);
    assert.equal(sent.sleep_rest.value, "good");
    assert.equal(sent.recent_activity.value, "activity");
    assert.equal(sent.routine_change.value, "none");
    assert.equal(sent.declared_condition.status, "skipped");

    assert.ok(dcOutput.includes("voice_ptt_confirmed"));
    assert.ok(vitalsBanner.includes("activity"));
    assert.ok(vitalsOut.includes("remeasure") || vitalsOut.includes("Desajuste de contexto"));

    // Limpiar contexto revocando desde la UI
    await page.click("#dc-revoke-btn");
    await page.waitForFunction(() => {
      const el = document.getElementById("daily-context-output");
      return el && el.textContent.includes("revocado");
    });

    console.log("PASS e2e_daily_voice_playwright (Q1-Q5 PTT -> daily-context -> vitals remeasure -> revoke, 0 /api/chat calls)");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("FAIL e2e_daily_voice_playwright:", err);
  if (activePage) {
    Promise.all([
      activePage.locator("#dc-voice-status").textContent().catch(() => "unavailable"),
      activePage.locator("#daily-context-output").innerText().catch(() => "unavailable"),
      activePage.locator("#dc-voice-guided").getAttribute("hidden").catch(() => "unavailable"),
      activePage.locator("#dc-voice-step").innerText().catch(() => "unavailable"),
    ]).then(([voiceStatus, contextOutput, guidedHidden, voiceStep]) => {
      console.error("E2E diagnostics:", JSON.stringify({
        voiceStatus, contextOutput, guidedHidden, voiceStep,
        serverOutput: serverOutput.join("").slice(-5000),
      }, null, 2));
    }).finally(() => process.exit(1));
  } else {
    console.error("Server output:", serverOutput.join("").slice(-5000));
    process.exit(1);
  }
});
