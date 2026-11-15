/* Tests de stopRecording en web/app.js sin navegador: se extraen las funciones
 * REALES del archivo fuente (waitForRecorderStop, stopRecording,
 * teardownVoiceAudio) y se ejecutan en una sandbox con fakes de
 * MediaRecorder/track. Cubre: captura corta (el chunk final no se pierde),
 * captura normal y tope de tiempo/cancelación conservando lo capturado.
 *
 * Ejecutar: node tests_app/test_voice_recorder_stop.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(__dirname, "..", "web", "app.js"),
  "utf8"
);

function extract(name) {
  const start =
    src.indexOf(`async function ${name}(`) !== -1
      ? src.indexOf(`async function ${name}(`)
      : src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`No se encontró ${name} en web/app.js`);
  // localizar el cierre de la lista de parámetros (puede tener llaves) y
  // luego la llave que abre el cuerpo
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

function makeRecorder({ stopActs = "normal" } = {}) {
  const listeners = {};
  const rec = {
    state: "recording",
    mimeType: "audio/webm;codecs=opus",
    _listeners: listeners,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    emit(type, ev) {
      for (const fn of [...(listeners[type] || [])]) fn(ev);
    },
    stop() {
      rec.state = "inactive";
      if (stopActs === "normal") {
        // MediaRecorder real: chunk final tras stop(), evento stop después
        setTimeout(() => {
          rec.emit("dataavailable", { data: { size: 777 } });
          rec.emit("stop", {});
        }, 20);
      } else if (stopActs === "throws") {
        throw new Error("stop failed");
      }
      // "never": no emite nada (caso tope de tiempo)
    },
  };
  return rec;
}

function makeTrack() {
  return { stopped: 0, stop() { this.stopped++; } };
}

function makeElement(id) {
  return {
    id,
    textContent: "",
    innerHTML: "",
    value: "",
    className: "",
    hidden: false,
    disabled: false,
    attributes: {},
    focused: false,
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return this.attributes[k] ?? null;
    },
    focus() {
      this.focused = true;
    },
  };
}

function makeDom() {
  const elements = new Map();
  for (const id of [
    "ptt-btn",
    "ptt-stop-audio-btn",
    "ptt-status",
    "ptt-error-zone",
    "ptt-reply-zone",
    "ptt-transcript-zone",
    "ptt-transcript",
    "ptt-cancel-btn",
    "ptt-confirm-btn",
  ]) {
    elements.set(id, makeElement(id));
  }
  elements.get("ptt-transcript-zone").hidden = true;
  elements.get("ptt-stop-audio-btn").hidden = true;
  return {
    elements,
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
  };
}

function buildSandbox({ stopActs = "normal", fetchImpl = null, blobToWavImpl = null } = {}) {
  const recorder = makeRecorder({ stopActs });
  const track = makeTrack();
  const sent = []; // blobs que recibiría transcribeAndRoute
  const statuses = [];
  const errors = [];
  const dom = makeDom();
  const sandboxVoice = {
    sessionId: "ptt-test",
    recording: true,
    recorder,
    stream: { getTracks: () => [track] },
    chunks: [],
    timer: null,
    playing: null,
    audioCtx: null,
    transcriptState: null,
    sttGeneration: 0,
    sttAbortController: null,
  };
  const sandbox = {
    voice: sandboxVoice,
    window: { AstroTwinLocale: { get: () => "es" } },
    document: dom.document,
    esc: (s) => String(s),
    voiceStatus: (m) => {
      statuses.push(m);
      dom.elements.get("ptt-status").textContent = m;
    },
    voiceError: (m) => {
      errors.push(m);
      dom.elements.get("ptt-error-zone").innerHTML = m;
    },
    voiceReply: (html) => {
      dom.elements.get("ptt-reply-zone").innerHTML = html;
    },
    speakReply: () => {},
    transcribeAndRoute: async (blob) => {
      sent.push(blob);
    },
    blobToWav: blobToWavImpl || (async () => new ArrayBuffer(16)),
    fetch:
      fetchImpl ||
      (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ text: "pulso 88" }),
      })),
    AbortController,
    Blob,
    WeakSet,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(extract("waitForRecorderStop"), sandbox);
  vm.runInContext(extract("teardownVoiceAudio"), sandbox);
  vm.runInContext(extract("stopRecording"), sandbox);
  return { sandbox, recorder, track, sent, statuses, errors, dom, voice: sandboxVoice };
}

const results = [];
const check = (name, cond, detail) => {
  results.push({ name, ok: !!cond, detail: detail || "" });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` — ${detail}`}`);
};
async function waitUntil(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return Boolean(predicate());
}

// 1) Captura corta: chunks vacíos, el chunk final de stop() debe llegar.
{
  const { sandbox, sent, statuses, voice } = buildSandbox({ stopActs: "normal" });
  await vm.runInContext("stopRecording()", sandbox);
  check(
    "short_capture_keeps_final_chunk",
    sent.length === 1 && voice.chunks.length === 0,
    "el chunk final debe llegar a transcribeAndRoute y el estado quedar liberado"
  );
  const blob = sent[0];
  check("short_capture_blob_is_webm", blob.type === "audio/webm;codecs=opus");
  check(
    "short_capture_awaits_stop_confirmation",
    !statuses.some((m) => m.includes("sin confirmación")),
    "con events normales no debe avisar de cierre incompleto"
  );
}

// 2) Captura normal: 2 chunks previos + chunk final.
{
  const { sandbox, sent, voice, recorder } = buildSandbox({ stopActs: "normal" });
  voice.chunks.push({ size: 100 }, { size: 200 });
  await vm.runInContext("stopRecording()", sandbox);
  check(
    "normal_capture_sends_blob",
    sent.length === 1,
    "el blob se envía una vez"
  );
  check("normal_recorder_inactive_after", recorder.state === "inactive");
}

// 3) Tope de tiempo: stop() nunca emite; se conserva lo capturado y se avisa.
{
  const { sandbox, sent, statuses, track, voice } = buildSandbox({ stopActs: "never" });
  voice.chunks.push({ size: 50 });
  const t0 = Date.now();
  await vm.runInContext("stopRecording()", sandbox);
  const elapsed = Date.now() - t0;
  check("timeout_bounds_wait", elapsed < 2000, `esperó ${elapsed} ms`);
  check(
    "timeout_preserves_chunks",
    sent.length === 1,
    "con chunks capturados se envía el blob aunque no llegue stop"
  );
  check(
    "timeout_honest_status",
    statuses.some((m) => m.includes("sin confirmación")),
    JSON.stringify(statuses)
  );
  check(
    "timeout_stops_tracks",
    track.stopped >= 1,
    "los tracks del micrófono se detienen igualmente"
  );
}

// 4) Sin audio capturado: mensaje honesto y nada enviado.
{
  const { sandbox, sent, statuses } = buildSandbox({ stopActs: "throws" });
  await vm.runInContext("stopRecording()", sandbox);
  check("no_audio_no_send", sent.length === 0);
  check(
    "no_audio_honest_message",
    statuses.some((m) => m.includes("No se capturó audio")),
    JSON.stringify(statuses)
  );
}

// 5) El micrófono se libera de inmediato también en el caso normal.
{
  const { sandbox, track, voice } = buildSandbox({ stopActs: "normal" });
  voice.chunks.push({ size: 10 });
  await vm.runInContext("stopRecording()", sandbox);
  check("normal_stops_track", track.stopped >= 1);
}

// 6) Con ondataavailable ya adjunto, el chunk final de stop() no se duplica.
{
  const { sandbox, recorder, voice, sent } = buildSandbox({ stopActs: "normal" });
  const chunk = new Blob(["final"], { type: "audio/webm" });
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) voice.chunks.push(ev.data);
  };
  recorder.stop = () => {
    recorder.state = "inactive";
    setTimeout(() => {
      const ev = { data: chunk };
      recorder.ondataavailable(ev);
      recorder.emit("dataavailable", ev);
      recorder.emit("stop", {});
    }, 10);
  };
  await vm.runInContext("stopRecording()", sandbox);
  check(
    "stop_does_not_duplicate_final_chunk",
    sent.length === 1 && sent[0].size === chunk.size,
    `size=${sent[0]?.size} expected=${chunk.size}`
  );
}

// 7) Cancelar STT en vuelo aborta AbortController y no reabre el transcript ni muestra error.
{
  let sttSignal = null;
  let resolveStt = null;
  const fetchImpl = (url, opts = {}) => {
    if (url.startsWith("/api/voice/stt")) {
      sttSignal = opts.signal;
      return new Promise((resolve) => {
        resolveStt = resolve;
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        state: "awaiting_confirmation",
        transcript: { text: "respuesta tardía" },
      }),
    });
  };
  const { sandbox, dom, errors, voice } = buildSandbox({ fetchImpl });
  vm.runInContext(extract("voiceApi"), sandbox);
  vm.runInContext(extract("voiceAction"), sandbox);
  vm.runInContext(extract("renderPipelineState"), sandbox);
  vm.runInContext(extract("cancelTurn"), sandbox);
  vm.runInContext(extract("transcribeAndRoute"), sandbox);

  const inFlight = vm.runInContext('transcribeAndRoute(new Blob(["abc"]))', sandbox);
  const sttStarted = await waitUntil(() => typeof resolveStt === "function");
  check("cancel_test_waits_until_fetch_is_in_flight", sttStarted);
  if (!sttStarted) {
    await vm.runInContext("cancelTurn()", sandbox);
    await inFlight;
  } else {
  await vm.runInContext("cancelTurn()", sandbox);
  check("cancel_aborts_inflight_stt_signal", sttSignal?.aborted === true);

  // Aunque el fetch resuelva tarde con una transcripción, no debe reabrir la zona.
  resolveStt({
    ok: true,
    status: 200,
    json: async () => ({ text: "texto obsoleto" }),
  });
  await inFlight;
  }
  check(
    "cancel_keeps_transcript_zone_hidden",
    dom.elements.get("ptt-transcript-zone").hidden === true && voice.transcriptState === null
  );
  check("cancel_produces_no_stt_error", errors.length === 0, JSON.stringify(errors));
}

// 8) Una respuesta STT obsoleta (generación anterior) no sobrescribe una petición más nueva.
{
  let resolveFirst = null;
  let callIdx = 0;
  const fetchImpl = (url, opts = {}) => {
    if (url.startsWith("/api/voice/stt")) {
      callIdx += 1;
      if (callIdx === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ text: "segundo turno" }),
      });
    }
    const body = JSON.parse(opts.body || "{}");
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        state: "awaiting_confirmation",
        transcript: { text: body.transcript_text },
      }),
    });
  };
  const { sandbox, dom } = buildSandbox({ fetchImpl });
  vm.runInContext(extract("voiceApi"), sandbox);
  vm.runInContext(extract("voiceAction"), sandbox);
  vm.runInContext(extract("renderPipelineState"), sandbox);
  vm.runInContext(extract("transcribeAndRoute"), sandbox);

  const p1 = vm.runInContext('transcribeAndRoute(new Blob(["1"]))', sandbox);
  const firstStarted = await waitUntil(() => typeof resolveFirst === "function");
  check("stale_test_waits_until_first_fetch_is_in_flight", firstStarted);
  if (firstStarted) {
    const p2 = vm.runInContext('transcribeAndRoute(new Blob(["2"]))', sandbox);
    await p2;
    resolveFirst({
      ok: true,
      status: 200,
      json: async () => ({ text: "primer turno obsoleto" }),
    });
    await p1;
    check(
      "stale_stt_generation_does_not_overwrite_newer_transcript",
      dom.elements.get("ptt-transcript").value === "segundo turno",
      `value=${dom.elements.get("ptt-transcript").value}`
    );
  } else {
    await p1;
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks`);
process.exitCode = failed.length ? 1 : 0;
