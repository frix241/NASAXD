"use strict";

const state = {
  catalogItems: [],
  pendingInterviewId: null,
  pendingMissionIds: [],
};

function esc(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail || `Error HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

function setBadge(el, text, variant) {
  el.textContent = text;
  el.className = "badge" + (variant ? ` badge--${variant}` : "");
}

async function loadStatus() {
  const apiBadge = document.getElementById("badge-api");
  const llmBadge = document.getElementById("badge-llm");
  const voiceBadge = document.getElementById("badge-voice");

  try {
    const data = await fetchJson("/api/status");
    setBadge(apiBadge, "API: operativa", "ok");
    if (data.llm && data.llm.available) {
      setBadge(llmBadge, `LLM (${data.llm.provider}): accesible`, "ok");
    } else {
      setBadge(llmBadge, "LLM: no disponible", "warn");
    }
    const anyVoice = Array.isArray(data.voice_services) && data.voice_services.some((v) => v.available_now);
    setBadge(voiceBadge, anyVoice ? "Voz: activa" : "Voz: contrato inactivo", anyVoice ? "ok" : "warn");
  } catch (err) {
    setBadge(apiBadge, "API: error", "err");
    setBadge(llmBadge, "LLM: desconocido", "err");
    setBadge(voiceBadge, "Voz: desconocido", "err");
  }
}

function renderConfusionMatrix(cm) {
  if (!cm) {
    return `<div class="state-box">Sin matriz de confusión publicada todavía.</div>`;
  }
  if (Array.isArray(cm) && cm.length > 0 && Array.isArray(cm[0])) {
    const headers = cm[0].map((_, idx) => `<th scope="col" class="num">Pred ${idx}</th>`).join("");
    const rows = cm
      .map(
        (row, rIdx) =>
          `<tr><th scope="row">Real ${rIdx}</th>${row
            .map((cell) => `<td class="num">${esc(cell)}</td>`)
            .join("")}</tr>`
      )
      .join("");
    return `<div class="table-wrap"><table><thead><tr><th scope="col">Clase</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return `<pre class="json-view">${esc(JSON.stringify(cm, null, 2))}</pre>`;
}

function renderResults(data) {
  const container = document.getElementById("results-container");
  const summaryWrap = data.summary || {};
  const historyWrap = data.history || {};
  const labsWrap = data.real_labs || {};

  let html = "";

  if (summaryWrap.state === "empty") {
    html += `<div class="state-box">${esc(summaryWrap.message)}</div>`;
  } else if (summaryWrap.state === "error") {
    html += `<div class="state-box state-box--error">${esc(summaryWrap.message)}</div>`;
  } else if (summaryWrap.summary) {
    const s = summaryWrap.summary;
    const m = s.metrics || {};
    const ci = s.ci95 ? JSON.stringify(s.ci95) : "No publicado";
    html += `
      <div class="kpi-row">
        <div class="kpi"><span class="kpi-label">Estado ML</span><span class="kpi-value">${esc(s.status)}</span></div>
        <div class="kpi"><span class="kpi-label">Score (${esc(s.score_scale)})</span><span class="kpi-value">${s.score !== null && s.score !== undefined ? esc(s.score) : "N/D"}</span></div>
        <div class="kpi"><span class="kpi-label">Macro F1</span><span class="kpi-value">${m.macro_f1 !== undefined ? esc(m.macro_f1) : "N/D"}</span></div>
        <div class="kpi"><span class="kpi-label">Accuracy</span><span class="kpi-value">${m.accuracy !== undefined ? esc(m.accuracy) : "N/D"}</span></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <h3>Matriz de confusión e IC95</h3>
          ${renderConfusionMatrix(s.confusion_matrix)}
          <p class="hint"><strong>IC95:</strong> <code>${esc(ci)}</code></p>
          <p class="hint"><strong>Benchmark:</strong> ${esc(s.benchmark || "No especificado")}</p>
        </div>
        <div class="panel">
          <h3>Historial CSV (${esc(historyWrap.total_rows || 0)} filas)</h3>
          ${renderHistoryTable(historyWrap)}
        </div>
      </div>
    `;
  }

  if (summaryWrap.state !== "ok" && historyWrap.state === "ok") {
    html += `<div class="panel"><h3>Historial CSV</h3>${renderHistoryTable(historyWrap)}</div>`;
  }

  const lims = Array.isArray(data.limitations) ? data.limitations : [];
  html += `
    <div class="limitations-box">
      <strong>Limitaciones visibles</strong>
      <ul>${lims.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    </div>
  `;

  container.innerHTML = html;
  renderLabs(labsWrap);
}

function renderHistoryTable(historyWrap) {
  if (historyWrap.state === "empty") {
    return `<div class="state-box">${esc(historyWrap.message)}</div>`;
  }
  if (historyWrap.state === "error") {
    return `<div class="state-box state-box--error">${esc(historyWrap.message)}</div>`;
  }
  const cols = historyWrap.columns || [];
  const rows = (historyWrap.rows || []).slice(0, 20);
  if (!cols.length || !rows.length) {
    return `<div class="state-box">Sin filas en metrics_history.csv.</div>`;
  }
  const head = cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderLabs(labs) {
  const el = document.getElementById("labs-container");
  if (!labs || labs.state === "empty") {
    el.innerHTML = `<div class="state-box">${esc(labs?.message || "Sin datos de laboratorios.")}</div>`;
    return;
  }
  if (labs.state === "error") {
    el.innerHTML = `<div class="state-box state-box--error">${esc(labs.message)}</div>`;
    return;
  }
  const sample = (labs.records || []).slice(0, 12);
  const rows = sample
    .map(
      (r) => `<tr>
        <td>${esc(r.sujeto)}</td>
        <td>${esc(r.momento)}</td>
        <td>${esc(r.analito)}</td>
        <td class="num">${esc(r.valor)} ${esc(r.unidad)}</td>
        <td>${esc(r.bandera)}</td>
      </tr>`
    )
    .join("");

  el.innerHTML = `
    <p class="hint">Namespace: <code>${esc(labs.namespace)}</code> · Válidas: <strong>${esc(labs.ok_count)}</strong> · Excluidas (calidad != ok): <strong>${esc(labs.excluded_count)}</strong></p>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Sujeto</th><th scope="col">Momento</th><th scope="col">Analito</th><th scope="col" class="num">Valor</th><th scope="col">Bandera</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function loadResults() {
  const container = document.getElementById("results-container");
  container.innerHTML = `<div class="state-box">Cargando resumen ML e historial CSV…</div>`;
  try {
    const data = await fetchJson("/api/results");
    renderResults(data);
  } catch (err) {
    container.innerHTML = `<div class="state-box state-box--error">No se pudieron cargar los resultados: ${esc(err.message)}</div>`;
  }
}

async function loadCatalog() {
  const container = document.getElementById("catalog-container");
  const sheetSel = document.getElementById("catalog-sheet");
  const search = document.getElementById("catalog-search").value.trim();
  const sheet = sheetSel.value;

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (sheet) params.set("sheet", sheet);

  try {
    const data = await fetchJson(`/api/catalog?${params.toString()}`);
    if (Array.isArray(data.sheets) && sheetSel.options.length <= 1) {
      for (const s of data.sheets) {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        sheetSel.appendChild(opt);
      }
    }
    if (data.state === "empty") {
      container.innerHTML = `<div class="state-box">${esc(data.message)}</div>`;
      return;
    }
    if (data.state === "error") {
      container.innerHTML = `<div class="state-box state-box--error">${esc(data.message)}</div>`;
      return;
    }
    const items = (data.items || []).slice(0, 25);
    if (!items.length) {
      container.innerHTML = `<div class="state-box">No hay coincidencias para el filtro actual.</div>`;
      return;
    }
    const preferred = ["sheet", "category", "risk", "symptom", "measurement_method", "units", "source", "parameter", "unit"];
    const allKeys = Object.keys(items[0]);
    const keys = preferred.filter((k) => allKeys.includes(k)).slice(0, 5);
    const displayKeys = keys.length ? keys : allKeys.slice(0, 5);
    const head = displayKeys.map((k) => `<th scope="col">${esc(k)}</th>`).join("");
    const formatCell = (val) => {
      if (val === null || val === undefined || val === "") return "—";
      if (typeof val === "object") return esc(val.status || JSON.stringify(val));
      return esc(val);
    };
    const body = items
      .map((it) => `<tr>${displayKeys.map((k) => `<td>${formatCell(it[k])}</td>`).join("")}</tr>`)
      .join("");
    container.innerHTML = `
      <p class="hint">${esc(data.message)}</p>
      <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="state-box state-box--error">Error cargando catálogo: ${esc(err.message)}</div>`;
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const out = document.getElementById("chat-output");
  const btn = document.getElementById("btn-chat-submit");
  const message = document.getElementById("chat-message").value.trim();
  if (!message) {
    out.innerHTML = `<div class="state-box state-box--error">${window.AstroTwinLocale?.t("Escribe una pregunta operativa antes de enviar.", "Enter a question before sending.")}</div>`;
    return;
  }

  btn.disabled = true;
  out.innerHTML = `<div class="state-box">${window.AstroTwinLocale?.t("Evaluando reglas deterministas y consultando LLM local…", "Checking deterministic rules and the local copilot…")}</div>`;

  try {
    const payload = {
      profile_id: document.getElementById("chat-profile").value,
      selected_system: document.getElementById("chat-system").value,
      message,
      language: window.AstroTwinLocale?.get() || "es",
      use_llm: document.getElementById("chat-use-llm").checked,
      include_real_lab_reference: document.getElementById("chat-include-labs").checked,
    };
    const res = await fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const prov = res.provenance || {};
    const llmBanner = prov.llm_available
      ? `<div class="badge badge--ok">${window.AstroTwinLocale?.t("LLM activo", "Local model active")}: ${esc(prov.provider)} / ${esc(prov.model)} (prompt ${esc(prov.prompt_version)})</div>`
      : `<div class="state-box state-box--warn"><strong>${window.AstroTwinLocale?.t("LLM no disponible:", "Local model unavailable:")}</strong> ${esc(prov.unavailable_reason || window.AstroTwinLocale?.t("Modo solo reglas deterministas.", "Deterministic rules only."))}</div>`;

    const llmBlock = res.llm_output
      ? `<p><strong>${window.AstroTwinLocale?.t("Respuesta az³tro:", "Copilot response:")}</strong> ${esc(res.llm_output.answer)}</p>`
      : "";

    const obs = (res.rules_assessment?.observations || [])
      .map((o) => `<li>${esc(o)}</li>`)
      .join("");

    out.innerHTML = `
      ${llmBanner}
      ${llmBlock}
      <p class="hint"><strong>${window.AstroTwinLocale?.t("Aviso:", "Note:")}</strong> ${esc(res.disclaimer)}</p>
      <h4>${window.AstroTwinLocale?.t("Evaluación determinista (independiente del LLM)", "Deterministic assessment (independent of the model)")}</h4>
      <ul>${obs}</ul>
      <h4>${window.AstroTwinLocale?.t("Contrato 3D", "3D event")}</h4>
      <pre class="json-view">${esc(JSON.stringify(res.integration_3d, null, 2))}</pre>
    `;
  } catch (err) {
    out.innerHTML = `<div class="state-box state-box--error">Error en /api/chat: ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderInterviewOutputHtml(res) {
  if (!res || typeof res !== "object" || !res.interview_id) {
    return `<div class="state-box state-box--error">Respuesta vacía o incompleta de /api/interview.</div>`;
  }
  const escalate = Boolean(
    res.policy_action === "stop_and_contact_medical" ||
      res.contact_medical_team ||
      res.medical_contact_notice
  );
  const policyLabel = res.policy_action
    ? `Acción de política: <code>${esc(res.policy_action)}</code>`
    : "Aviso de contacto médico";
  const noticeText =
    res.medical_contact_notice ||
    "Detener carga física y contactar al equipo médico de inmediato (orientación operativa, no es un diagnóstico).";
  const escalationBanner = escalate
    ? `<div class="state-box state-box--error" id="interview-medical-notice" role="alert">
        <strong>${policyLabel}</strong><br />
        <span>${esc(noticeText)}</span>
      </div>`
    : "";

  const missions = Array.isArray(res.proposed_missions) ? res.proposed_missions : [];
  const list = missions.length
    ? missions
        .map(
          (m) => `<li>
          <strong>${esc(m.title)}</strong> (${esc(m.duration_min)} min · intensidad: ${esc(m.intensity)})
          <br /><span class="hint">${esc(m.reason)}</span>
        </li>`
        )
        .join("")
    : `<li>Sin misiones propuestas.</li>`;

  const confirmRow = missions.length
    ? `<div class="btn-row">
        <button type="button" class="btn-primary" id="btn-open-confirm">Revisar y confirmar misiones</button>
      </div>`
    : "";

  return `
    ${escalationBanner}
    <p class="hint">Entrevista <code>${esc(res.interview_id)}</code> · Estado: pendiente de confirmación humana.</p>
    <ul>${list}</ul>
    ${confirmRow}
    <pre class="json-view">${esc(JSON.stringify(res.integration_3d ?? [], null, 2))}</pre>
  `;
}

async function handleInterviewSubmit(event) {
  event.preventDefault();
  const out = document.getElementById("interview-output");
  out.innerHTML = `<div class="state-box">Procesando entrevista matutina…</div>`;

  const painPresent = document.getElementById("int-pain-present").checked;
  const painZone = document.getElementById("int-pain-zone").value || null;

  const payload = {
    profile_id: document.getElementById("int-profile").value,
    sleep_quality: Number(document.getElementById("int-sleep").value),
    energy: Number(document.getElementById("int-energy").value),
    mood: Number(document.getElementById("int-mood").value),
    hydration_completed: document.getElementById("int-hydration").checked,
    pain: {
      present: painPresent,
      zone: painPresent ? painZone : null,
      intensity: painPresent ? 4 : 0,
    },
    notes: document.getElementById("int-notes").value.trim(),
  };

  try {
    const res = await fetchJson("/api/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res || !res.interview_id) {
      out.innerHTML = renderInterviewOutputHtml(res);
      return;
    }
    state.pendingInterviewId = res.interview_id;
    state.pendingMissionIds = (res.proposed_missions || []).map((m) => m.mission_id);
    out.innerHTML = renderInterviewOutputHtml(res);

    document.getElementById("btn-open-confirm")?.addEventListener("click", () => {
      const dlg = document.getElementById("confirm-dialog");
      dlg.showModal();
    });
  } catch (err) {
    out.innerHTML = `<div class="state-box state-box--error">Error en /api/interview: ${esc(err.message)}</div>`;
  }
}

async function confirmMissions() {
  const dlg = document.getElementById("confirm-dialog");
  const out = document.getElementById("interview-output");
  if (!state.pendingInterviewId) {
    dlg.close();
    return;
  }
  try {
    const res = await fetchJson("/api/interview/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interview_id: state.pendingInterviewId,
        mission_ids: state.pendingMissionIds,
        confirmed: true,
      }),
    });
    dlg.close();
    const okBox = document.createElement("div");
    okBox.className = "badge badge--ok";
    okBox.textContent = `Misiones confirmadas (${res.confirmed_missions.length}) a las ${res.recorded_at}`;
    out.prepend(okBox);
  } catch (err) {
    dlg.close();
    out.innerHTML = `<div class="state-box state-box--error">No se pudo confirmar: ${esc(err.message)}</div>`;
  }
}

async function loadVoiceContracts() {
  const el = document.getElementById("voice-container");
  try {
    const data = await fetchJson("/api/voice/contracts");
    const cards = (data.services || [])
      .map(
        (s) => `<article class="panel">
          <h3>${esc(s.service.toUpperCase())} · ${esc(s.engine)}</h3>
          <p class="hint"><strong>Imagen Docker:</strong> <code>${esc(s.docker_image)}</code></p>
          <p class="hint"><strong>Probado en runtime:</strong> ${s.tested_in_runtime ? "Sí" : "No (contrato preparado)"} · <strong>Activo ahora:</strong> ${s.available_now ? "Sí" : "No"}</p>
          <p>${esc(s.status_detail)}</p>
        </article>`
      )
      .join("");
    el.innerHTML = `<p class="hint">${esc(data.note)}</p><div class="grid-2">${cards}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="state-box state-box--error">Error cargando contratos de voz: ${esc(err.message)}</div>`;
  }
}

// ============================================================================
// COPILOTO POR VOZ (push-to-talk explícito)
// Garantías: getUserMedia solo en gesto de usuario; audio solo a la API local;
// liberación dura de tracks/AudioContext en stop/cancel/error/unmount/
// visibilitychange; transcript visible con Confirmar/Editar/Cancelar; ninguna
// misión o estado médico cambia sin confirmación; emergencia = regla
// determinista inmediata tras transcript (el backend, no un LLM).
// ============================================================================

const voice = {
  sessionId: "ptt-" + Math.random().toString(36).slice(2, 10),
  stream: null,
  recorder: null,
  chunks: [],
  audioCtx: null,
  playing: null,
  timer: null,
  recording: false,
  transcriptState: null,
  sttGeneration: 0,
  sttAbortController: null,
};

function voiceStatus(msg, cls) {
  const el = document.getElementById("ptt-status");
  el.textContent = msg;
  el.className = "hint" + (cls ? ` ${cls}` : "");
}

function voiceError(msg) {
  const el = document.getElementById("ptt-error-zone");
  el.innerHTML = msg ? `<div class="state-box state-box--error">${esc(msg)}</div>` : "";
}

function voiceReply(html) {
  document.getElementById("ptt-reply-zone").innerHTML = html;
}

function pttBusy() {
  return document.getElementById("ptt-btn").disabled;
}

function teardownVoiceAudio() {
  // Liberación dura: se invoca en stop, cancel, error, unmount y visibilitychange.
  if (voice.timer) {
    clearTimeout(voice.timer);
    voice.timer = null;
  }
  if (voice.recorder && voice.recorder.state !== "inactive") {
    try {
      voice.recorder.stop();
    } catch (_) {
      /* ya detenido */
    }
  }
  voice.recorder = null;
  voice.chunks = [];
  if (voice.stream) {
    for (const track of voice.stream.getTracks()) {
      track.stop();
    }
    voice.stream = null;
  }
  if (voice.playing) {
    try {
      voice.playing.source.stop();
    } catch (_) {
      /* ya parado */
    }
    voice.playing = null;
  }
  if (voice.audioCtx && voice.audioCtx.state !== "closed") {
    voice.audioCtx.close().catch(() => {});
  }
  voice.audioCtx = null;
  voice.recording = false;
  if (typeof document !== "undefined") {
    const btn = document.getElementById("ptt-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = "Mantener pulsado para hablar";
    }
    const stopAudioBtn = document.getElementById("ptt-stop-audio-btn");
    if (stopAudioBtn) stopAudioBtn.hidden = true;
  }
}

async function voiceApi(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.reason || `Error HTTP ${res.status}`);
  }
  return data;
}

async function voiceAction(action, extra = {}, options = {}) {
  return voiceApi("/api/voice/pipeline/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: voice.sessionId, action, language: window.AstroTwinLocale?.get() || "es", ...extra }),
    ...options,
  });
}

async function getVoiceMediaStream() {
  // Evita echoCancellation/noiseSuppression de WebRTC en Android: suelen
  // suprimir voz baja, canto y consonantes suaves antes de llegar a Whisper.
  // Si el navegador rechaza las constraints detalladas, degrada a { audio: true }.
  const preferred = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: preferred });
  } catch (err) {
    const name = err && err.name;
    if (name === "OverconstrainedError" || name === "NotSupportedError" || name === "TypeError") {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw err;
  }
}

async function startRecording() {
  if (voice.recording || pttBusy()) return;
  voice.sttGeneration += 1;
  if (voice.sttAbortController) {
    voice.sttAbortController.abort();
    voice.sttAbortController = null;
  }
  voiceError("");
  // getUserMedia ocurre aquí, dentro del handler del gesto del usuario.
  try {
    voice.stream = await getVoiceMediaStream();
  } catch (err) {
    teardownVoiceAudio();
    voiceError(
      "No se pudo acceder al micrófono (" +
        (err.name === "NotAllowedError" ? "permiso denegado" : err.name) +
        "). Usa la consulta de texto del panel 3; no se grabó nada."
    );
    return;
  }
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "";
  voice.chunks = [];
  try {
    voice.recorder = new MediaRecorder(voice.stream, mimeType ? { mimeType } : undefined);
  } catch (err) {
    teardownVoiceAudio();
    voiceError(`MediaRecorder no disponible: ${esc(String(err))}. No se grabó nada.`);
    return;
  }
  voice.recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) voice.chunks.push(ev.data);
  };
  voice.recorder.onerror = () => {
    teardownVoiceAudio();
    voiceError("Error de grabación: el turno se canceló y los recursos de audio se liberaron.");
  };
  voice.recorder.start(250);
  voice.recording = true;

  try {
    await voiceAction("start_push_to_talk", { mic_permission_granted: true });
  } catch (err) {
    teardownVoiceAudio();
    voiceError(`La API local rechazó el inicio del turno: ${esc(err.message)}`);
    return;
  }

  const btn = document.getElementById("ptt-btn");
  btn.setAttribute("aria-pressed", "true");
  btn.textContent = "Grabando… suelta para transcribir";
  document.getElementById("ptt-cancel-btn").disabled = false;
  voiceStatus(
    "Grabando solo mientras mantienes pulsado. El audio no sale de este host.",
  );

  voice.timer = setTimeout(() => {
    // Tope del contrato: 15 s; se detiene y transcribe lo capturado.
    voiceStatus("Tope de 15 s alcanzado: se detiene la grabación.");
    stopRecording();
  }, 15000);
}

// Espera el chunk final (dataavailable) y el evento stop del MediaRecorder,
// con tope de tiempo: si no llegan, se cancela la espera y se conservan los
// chunks ya recibidos (capturas muy cortas no se pierden). Los tracks del
// micrófono se detienen aparte, de inmediato, para liberar el micrófono ya.
function waitForRecorderStop(recorder, { timeoutMs = 1500 } = {}) {
  if (!recorder || recorder.state === "inactive") {
    return Promise.resolve({ complete: true });
  }
  return new Promise((resolve) => {
    let done = false;
    const seenData = new WeakSet();
    const timer = setTimeout(() => finish({ complete: false }), timeoutMs);
    const onData = (ev) => {
      if (ev && ev.data && ev.data.size > 0) {
        if (typeof ev.data === "object" && seenData.has(ev.data)) return;
        if (typeof ev.data === "object") seenData.add(ev.data);
        if (!voice.chunks.includes(ev.data)) {
          voice.chunks.push(ev.data);
        }
      }
    };
    const onStop = () => finish({ complete: true });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      recorder.removeEventListener?.("dataavailable", onData);
      recorder.removeEventListener?.("stop", onStop);
      resolve(result);
    };
    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("stop", onStop);
    try {
      recorder.stop(); // dispara el chunk final y stop
    } catch (_) {
      finish({ complete: false });
    }
  });
}

async function stopRecording() {
  if (!voice.recording) return;
  const recorder = voice.recorder;
  const stream = voice.stream;
  let stopInfo = { complete: false };
  if (recorder && recorder.state !== "inactive") {
    stopInfo = await waitForRecorderStop(recorder);
  } else if (recorder) {
    stopInfo = { complete: true };
  }
  // El micrófono se libera en cuanto la grabación termina, sin esperar al
  // procesamiento posterior.
  if (stream) {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch (_) {
        /* ya parado */
      }
    }
  }
  const chunks = voice.chunks.slice(); // copia CON el chunk final incluido
  teardownVoiceAudio(); // vacía el estado global tras la copia
  // El criterio honesto es si se capturaron datos; stopInfo.complete solo
  // indica si el MediaRecorder confirmó el cierre (chunk final + stop).
  if (!chunks.length) {
    voiceStatus(
      "No se capturó audio; escribe tu consulta en modo texto. Nada se envió.",
    );
    return;
  }
  if (!stopInfo.complete) {
    voiceStatus(
      "La grabación terminó sin confirmación del navegador; se usa el audio capturado hasta el momento.",
    );
  }
  voiceStatus("Transcribiendo en el STT local (sidecar 127.0.0.1)…");
  const blob = new Blob(chunks, {
    type: recorder?.mimeType || "audio/webm",
  });
  await transcribeAndRoute(blob);
}

async function cancelTurn() {
  voice.sttGeneration += 1;
  if (voice.sttAbortController) {
    voice.sttAbortController.abort();
    voice.sttAbortController = null;
  }
  voice.transcriptState = null;
  teardownVoiceAudio();
  try {
    await voiceAction("cancel");
  } catch (_) {
    /* la cancelación local ya liberó los recursos */
  }
  const zone = document.getElementById("ptt-transcript-zone");
  if (zone) zone.hidden = true;
  const transcriptEl = document.getElementById("ptt-transcript");
  if (transcriptEl) transcriptEl.value = "";
  const cancelBtn = document.getElementById("ptt-cancel-btn");
  if (cancelBtn) cancelBtn.disabled = true;
  voiceStatus("Turno cancelado: transcripción descartada y audio liberado.");
  voiceReply("");
}

// whisper-server (miniaudio, sin backend opus/vorbis) no decodifica
// audio/webm;codecs=opus de MediaRecorder: se convierte a WAV PCM 16-bit
// en el navegador antes de enviar. Todo en memoria; nada a disco.
async function blobToWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineCtx && (buf.sampleRate !== 16000 || buf.numberOfChannels > 1) && buf.duration > 0) {
      try {
        const targetLength = Math.max(1, Math.ceil(buf.duration * 16000));
        const offline = new OfflineCtx(1, targetLength, 16000);
        const src = offline.createBufferSource();
        src.buffer = buf;
        src.connect(offline.destination);
        src.start(0);
        const resampled = await offline.startRendering();
        return audioBufferToWav(resampled);
      } catch (_) {
        /* fallback al buffer decodificado original */
      }
    }
    return audioBufferToWav(buf);
  } finally {
    ctx.close().catch(() => {});
  }
}

function audioBufferToWav(buffer) {
  const samples = buffer.getChannelData(0); // voz: mono
  const sampleRate = buffer.sampleRate;
  const dataSize = samples.length * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const wstr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wstr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return ab;
}

async function transcribeAndRoute(blob) {
  const gen = ++voice.sttGeneration;
  const controller = new AbortController();
  voice.sttAbortController = controller;
  const isStale = () => controller.signal.aborted || gen !== voice.sttGeneration;
  try {
    voiceStatus("Convirtiendo la grabación a WAV local (en memoria)…");
    let wav;
    try {
      wav = await blobToWav(blob);
    } catch (err) {
      if (isStale()) return;
      voiceError(
        "No se pudo convertir la grabación a WAV en el navegador: la consulta puede hacerse por texto; nada se envió ni se simuló.",
      );
      return;
    }
    if (isStale()) return;
    const voiceLanguage = window.AstroTwinLocale?.get() || "es";
    const sttRes = await fetch(`/api/voice/stt?language=${encodeURIComponent(voiceLanguage)}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
      signal: controller.signal,
    });
    if (isStale()) return;
    const sttData = await sttRes.json().catch(() => ({}));
    if (isStale()) return;
    if (!sttRes.ok) {
      throw new Error(sttData.detail || sttData.reason || `Error HTTP ${sttRes.status}`);
    }
    const stopRes = await voiceAction(
      "stop_push_to_talk",
      { transcript_text: sttData.text, language: voiceLanguage },
      { signal: controller.signal },
    );
    if (isStale()) return;
    renderPipelineState(stopRes);
  } catch (err) {
    if (err?.name === "AbortError" || isStale()) return;
    teardownVoiceAudio();
    voiceError(
      `Transcripción local no disponible: ${esc(err.message)}. La consulta puede hacerse por texto; nada se simuló.`,
    );
  } finally {
    if (voice.sttAbortController === controller) {
      voice.sttAbortController = null;
    }
  }
}

function renderEmergencyBannerHtml(text, safetyNote) {
  return `
      <div id="ptt-emergency-banner" role="alert">Emergencia: ${esc(text || "")}</div>
      ${safetyNote ? `<p class="hint">${esc(safetyNote)}</p>` : ""}
    `;
}

function renderPipelineState(result) {
  const zone = document.getElementById("ptt-transcript-zone");
  const cancelBtn = document.getElementById("ptt-cancel-btn");

  if (result.state === "emergency_escalation") {
    zone.hidden = true;
    cancelBtn.disabled = true;
    const reply = result.reply || {};
    voiceError("");
    voiceStatus(
      "Emergencia detectada en la transcripción: escalamiento determinista inmediato (sin LLM).",
    );
    voiceReply(renderEmergencyBannerHtml(reply.text || "", reply.safety_note || ""));
    speakReply(reply.text || "");
    return;
  }

  if (result.state === "awaiting_confirmation" && result.transcript) {
    voice.transcriptState = result.transcript;
    document.getElementById("ptt-transcript").value = result.transcript.text;
    zone.hidden = false;
    cancelBtn.disabled = false;
    voiceStatus("Revisa la transcripción: nada se ejecuta sin confirmación.");
    document.getElementById("ptt-transcript").focus();
    return;
  }

  if (result.state === "text_fallback") {
    zone.hidden = true;
    cancelBtn.disabled = true;
    voiceStatus(
      (result.reason || "") + " (Puedes escribir la consulta en el panel 3.)",
    );
    return;
  }

  voiceStatus(result.reason || "Turno finalizado.");
}

async function confirmTranscript() {
  const textarea = document.getElementById("ptt-transcript");
  const edited = textarea.value.trim();
  if (!edited) {
    voiceError("La transcripción está vacía; edita el texto o cancela el turno.");
    return;
  }
  document.getElementById("ptt-confirm-btn").disabled = true;
  try {
    // Si el texto fue editado vuelve al pipeline: la emergencia se reevalúa
    // de forma determinista sobre el texto final, nunca por un LLM.
    const same = voice.transcriptState && voice.transcriptState.text === edited;
    if (!same) {
      const reStop = await voiceAction("stop_push_to_talk", { transcript_text: edited });
      if (reStop.state === "emergency_escalation") {
        document.getElementById("ptt-transcript-zone").hidden = true;
        renderPipelineState(reStop);
        return;
      }
      if (reStop.state !== "awaiting_confirmation") {
        renderPipelineState(reStop);
        return;
      }
    }
    const confirmed = await voiceAction("confirm_transcript", { confirmed: true });
    if (!confirmed.accepted) {
      voiceError(confirmed.reason || "No se confirmó ninguna acción.");
      return;
    }
    await consultCopilot(edited);
  } catch (err) {
    voiceError(`No se pudo confirmar: ${esc(err.message)}`);
  } finally {
    document.getElementById("ptt-confirm-btn").disabled = false;
  }
}

function buildVoiceCopilotView(res) {
  const en = window.AstroTwinLocale?.get() === "en";
  if (!res || typeof res !== "object") {
    return {
      isError: true,
      statusText: en ? "Empty response from /api/chat." : "Respuesta vacía de /api/chat.",
      replyHtml: `<div class="state-box state-box--error">${en ? "Empty response from /api/chat." : "Respuesta vacía de /api/chat."}</div>`,
      speakText: "",
    };
  }
  const observations = Array.isArray(res.rules_assessment?.observations)
    ? res.rules_assessment.observations
    : [];
  const obsHtml = observations.map((o) => `<li>${esc(o)}</li>`).join("");
  const safetyAudit = res.provenance?.safety_audit || {};
  const isEmergency = Boolean(safetyAudit.emergency_bypass);
  const llmAnswer = res.llm_output?.answer || "";
  const safetyNote = res.llm_output?.safety_note || "";
  const disclaimer = res.disclaimer || "";

  if (isEmergency) {
    const emergencyText =
      llmAnswer ||
      observations[0] ||
      (en ? "Urgent warning detected. Stop activity and contact medical care." : "Alerta urgente detectada: detén la actividad y contacta atención médica.");
    return {
      isError: false,
      statusText:
        en ? "Emergency warning detected (deterministic rules, no model). No mission was confirmed automatically." : "Emergencia detectada (modo solo reglas, sin LLM). Ninguna misión se confirmó automáticamente.",
      replyHtml: `
        ${renderEmergencyBannerHtml(emergencyText, safetyNote)}
        ${disclaimer ? `<p class="hint"><strong>${en ? "Note:" : "Aviso:"}</strong> ${esc(disclaimer)}</p>` : ""}
        <h4>${en ? "Deterministic assessment" : "Evaluación determinista"}</h4>
        <ul>${obsHtml || `<li>${en ? "No observations." : "Sin observaciones."}</li>`}</ul>
        <h4>${en ? "3D event" : "Contrato 3D"}</h4>
        <pre class="json-view">${esc(JSON.stringify(res.integration_3d ?? [], null, 2))}</pre>
      `,
      speakText: emergencyText,
    };
  }

  const answerBlock = llmAnswer ? `<p>${esc(llmAnswer)}</p>` : "";
  return {
    isError: false,
    statusText: en
      ? "Deterministic copilot response. No mission was confirmed automatically. Review and confirm any proposed changes."
      : "Respuesta del motor determinista. Ninguna misión se confirmó automáticamente: usa la entrevista para confirmarlas.",
    replyHtml: `
      ${answerBlock}
      <p class="hint"><strong>${en ? "Note:" : "Aviso:"}</strong> ${esc(disclaimer)}</p>
      <h4>${en ? "Deterministic assessment" : "Evaluación determinista"}</h4>
      <ul>${obsHtml || `<li>${en ? "No observations." : "Sin observaciones."}</li>`}</ul>
      <h4>${en ? "3D event" : "Contrato 3D"}</h4>
      <pre class="json-view">${esc(JSON.stringify(res.integration_3d ?? [], null, 2))}</pre>
    `,
    speakText: observations.join(" ") || llmAnswer || disclaimer,
  };
}

async function consultCopilot(message) {
  const zone = document.getElementById("ptt-transcript-zone");
  zone.hidden = true;
  document.getElementById("ptt-cancel-btn").disabled = true;
  const language = window.AstroTwinLocale?.get() || "es";
  voiceStatus(language === "en" ? "Checking the copilot response using deterministic rules…" : "Consultando al copiloto con motor determinista (reglas, sin LLM)…");
  const payload = {
    profile_id: document.getElementById("chat-profile").value,
    selected_system: document.getElementById("chat-system").value,
    message,
    language,
    use_llm: false,
    include_real_lab_reference: false,
  };
  try {
    const res = await voiceApi("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const view = buildVoiceCopilotView(res);
    if (view.isError) {
      voiceError(view.statusText);
      return;
    }
    voiceStatus(view.statusText);
    voiceReply(view.replyHtml);
    speakReply(view.speakText);
  } catch (err) {
    voiceError(`Error en /api/chat: ${esc(err.message)}`);
  }
}

async function speakReply(text) {
  const stopBtn = document.getElementById("ptt-stop-audio-btn");
  const clipped = text.slice(0, 500);
  if (!clipped) return;
  if (window.AstroTwinLocale?.get() === "en") {
    const spoken = speakWithSystemVoice(clipped, "en-US");
    if (spoken) {
      stopBtn.hidden = false;
      setTimeout(() => { if (!speechSynthesis.speaking) stopBtn.hidden = true; }, 100);
    }
    return;
  }
  try {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clipped }),
    });
    if (!res.ok) return; // TTS no disponible: la respuesta queda en texto, honesto
    const wav = await res.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    voice.audioCtx = new Ctx();
    const buffer = await voice.audioCtx.decodeAudioData(wav);
    const source = voice.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(voice.audioCtx.destination);
    source.onended = () => {
      stopBtn.hidden = true;
      teardownVoiceAudio();
    };
    voice.playing = { source };
    source.start();
    stopBtn.hidden = false;
  } catch (_) {
    // Sin TTS no se simula audio; la respuesta permanece en texto.
  }
}

function stopAudioPlayback() {
  window.speechSynthesis?.cancel();
  teardownVoiceAudio();
  voiceStatus(window.AstroTwinLocale?.t("Reproducción interrumpida y recursos de audio liberados.", "Audio playback stopped."));
}

function speakWithSystemVoice(text, language) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(language.slice(0, 2)));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}

function initVoicePTT() {
  const btn = document.getElementById("ptt-btn");

  // Pulsar y mantener (ratón/táctil): pointerdown arranca, pointerup transcribe.
  btn.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    btn.setPointerCapture(ev.pointerId);
    startRecording();
  });
  btn.addEventListener("pointerup", () => {
    if (voice.recording) stopRecording();
  });
  btn.addEventListener("pointercancel", () => {
    if (voice.recording) stopRecording();
  });

  // Teclado: Espacio/Enter mantienen (keydown inicia, keyup transcribe);
  // Escape cancela en cualquier momento del turno.
  btn.addEventListener("keydown", (ev) => {
    if ((ev.key === " " || ev.key === "Enter") && !ev.repeat) {
      ev.preventDefault();
      startRecording();
    }
  });
  btn.addEventListener("keyup", (ev) => {
    if (ev.key === " " || ev.key === "Enter") {
      if (voice.recording) stopRecording();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (
      ev.key === "Escape" &&
      (voice.recording ||
        voice.sttAbortController !== null ||
        !document.getElementById("ptt-transcript-zone").hidden)
    ) {
      cancelTurn();
    }
  });

  document.getElementById("ptt-cancel-btn").addEventListener("click", cancelTurn);
  document.getElementById("ptt-confirm-btn").addEventListener("click", confirmTranscript);
  document.getElementById("ptt-edit-btn").addEventListener("click", () => {
    document.getElementById("ptt-transcript").focus();
    voiceStatus("Edita el texto y pulsa Confirmar: el texto final se reevalúa con las mismas guardas.");
  });
  document.getElementById("ptt-discard-btn").addEventListener("click", cancelTurn);
  document.getElementById("ptt-stop-audio-btn").addEventListener("click", stopAudioPlayback);

  // Liberación dura ante pestaña oculta, navegación o cierre.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (voice.recording || voice.sttAbortController !== null) {
        cancelTurn();
        voiceStatus("Pestaña oculta: grabación cancelada y micrófono liberado.");
      }
      if (voice.audioCtx || voice.playing) stopAudioPlayback();
    }
  });
  window.addEventListener("pagehide", () => teardownVoiceAudio());
  window.addEventListener("beforeunload", () => teardownVoiceAudio());
}

document.addEventListener("DOMContentLoaded", () => {
  window.AstroTwinLocale?.applyStaticText();
  window.addEventListener("astrotwin:language-changed", () => {
    const guide = document.getElementById("dc-voice-guided");
    if (guide && !guide.hidden) {
      const questions = window.AstroTwinDailyVoiceGuide?.getDailyVoiceQuestions(window.AstroTwinLocale.get()) || [];
      const index = Number(document.getElementById("dc-voice-step")?.dataset.stepIndex || 0);
      const q = questions[index];
      if (q) {
        const strong = document.createElement("strong");
        strong.textContent = q.prompt;
        document.getElementById("dc-voice-question")?.replaceChildren(strong);
      }
    }
  });
  loadStatus();
  loadResults();
  loadCatalog();
  loadVoiceContracts();

  document.getElementById("btn-refresh-results").addEventListener("click", loadResults);
  document.getElementById("catalog-search").addEventListener("input", loadCatalog);
  document.getElementById("catalog-sheet").addEventListener("change", loadCatalog);
  document.getElementById("chat-form").addEventListener("submit", handleChatSubmit);
  document.getElementById("interview-form").addEventListener("submit", handleInterviewSubmit);
  initDailyContextForm();
  document.getElementById("dialog-confirm-btn").addEventListener("click", confirmMissions);
  document.getElementById("dialog-cancel-btn").addEventListener("click", () => {
    document.getElementById("confirm-dialog").close();
  });

  initVoicePTT();
});

function initDailyContextForm() {
  const form = document.getElementById("daily-context-form");
  if (!form) return;

  const condCheck = document.getElementById("dc-consent-condition");
  const condWrap = document.getElementById("dc-condition-wrap");
  const out = document.getElementById("daily-context-output");
  const revokeBtn = document.getElementById("dc-revoke-btn");

  condCheck?.addEventListener("change", () => {
    if (condWrap) condWrap.hidden = !condCheck.checked;
  });

  async function submitDailyContext(payload) {
    try {
      const res = await fetchJson("/api/interview/daily-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const box = document.createElement("div");
      if (res.emergency_bypass) {
        box.className = "state-box state-box--error";
        box.setAttribute("role", "alert");
        const strong = document.createElement("strong");
        strong.textContent = res.emergency_notice || "Emergencia detectada.";
        box.appendChild(strong);
      } else {
        box.className = "state-box";
        const actLabel = res.record.recent_activity.value || res.record.recent_activity.status;
        box.textContent = `Contexto diario confirmado (${res.record.context_id}, modo: ${res.record.capture_mode}) · Actividad: ${actLabel} · Expira: ${res.record.expires_at_utc}. Conectado al motor de vitales.`;
      }
      out.replaceChildren(box);
      window.dispatchEvent(new CustomEvent("astrotwin:daily-context-updated", { detail: { profile_id: payload.profile_id } }));
    } catch (err) {
      const errBox = document.createElement("div");
      errBox.className = "state-box state-box--error";
      errBox.textContent = `Error guardando contexto diario: ${err.message}`;
      out.replaceChildren(errBox);
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const profileId = document.getElementById("dc-profile").value;
    const sleepVal = document.getElementById("dc-sleep").value;
    const actVal = document.getElementById("dc-activity").value;
    const routineVal = document.getElementById("dc-routine").value;
    const symText = document.getElementById("dc-symptoms-text").value.trim();
    const sessionConsent = document.getElementById("dc-consent-session").checked;
    const condConsent = Boolean(condCheck?.checked);
    const condNote = document.getElementById("dc-condition-note")?.value.trim() || "";

    await submitDailyContext({
      profile_id: profileId,
      capture_mode: "manual_form",
      transcript_confirmed_by_user: true,
      consent: {
        session_context_consent: sessionConsent,
        declared_condition_consent: condConsent,
        persist_confirmed_transcripts: false,
      },
      sleep_rest: {
        status: sleepVal === "skipped" ? "skipped" : sleepVal === "fair" ? "ambiguous" : "answered",
        value: sleepVal === "skipped" ? null : sleepVal,
      },
      recent_activity: {
        status: actVal === "skipped" ? "skipped" : actVal === "ambiguous" ? "ambiguous" : "answered",
        value: actVal === "skipped" || actVal === "ambiguous" ? null : actVal,
      },
      symptoms: {
        status: symText ? "answered" : "skipped",
        reported_none: !symText,
        confirmed_text: symText || null,
      },
      routine_change: {
        status: routineVal === "skipped" ? "skipped" : "answered",
        value: routineVal === "skipped" ? null : routineVal,
      },
      declared_condition: {
        status: condConsent && condNote ? "answered" : "skipped",
        note: condConsent && condNote ? condNote : null,
      },
    });
  });

  revokeBtn?.addEventListener("click", async () => {
    const profileId = document.getElementById("dc-profile").value;
    try {
      const res = await fetchJson(`/api/interview/context/${encodeURIComponent(profileId)}`, {
        method: "DELETE",
      });
      if (document.getElementById("dc-condition-note")) {
        document.getElementById("dc-condition-note").value = "";
      }
      if (condCheck) condCheck.checked = false;
      if (condWrap) condWrap.hidden = true;
      const box = document.createElement("div");
      box.className = "state-box";
      box.textContent = res.revoked
        ? "Contexto diario revocado y eliminado de memoria."
        : "No había contexto activo para revocar.";
      out.replaceChildren(box);
      window.dispatchEvent(new CustomEvent("astrotwin:daily-context-updated", { detail: { profile_id: profileId } }));
    } catch (err) {
      const errBox = document.createElement("div");
      errBox.className = "state-box state-box--error";
      errBox.textContent = `Error revocando contexto: ${err.message}`;
      out.replaceChildren(errBox);
    }
  });

  initDailyVoiceGuided(submitDailyContext);
}

function initDailyVoiceGuided(submitDailyContext) {
  const startBtn = document.getElementById("dc-voice-start-btn");
  const guidedEl = document.getElementById("dc-voice-guided");
  const stepEl = document.getElementById("dc-voice-step");
  const questionEl = document.getElementById("dc-voice-question");
  const pttBtn = document.getElementById("dc-voice-ptt-btn");
  const ttsBtn = document.getElementById("dc-voice-tts-btn");
  const skipBtn = document.getElementById("dc-voice-skip-btn");
  const cancelBtn = document.getElementById("dc-voice-cancel-btn");
  const statusEl = document.getElementById("dc-voice-status");
  const transcriptZone = document.getElementById("dc-voice-transcript-zone");
  const transcriptInput = document.getElementById("dc-voice-transcript");
  const confirmBtn = document.getElementById("dc-voice-confirm-btn");
  const retryBtn = document.getElementById("dc-voice-retry-btn");
  if (!startBtn || !guidedEl || !pttBtn) return;

  const dcVoice = {
    active: false,
    stepIndex: 0,
    recording: false,
    pendingPermission: false,
    pttHeld: false,
    gestureToken: 0,
    processingGen: 0,
    recorder: null,
    stream: null,
    chunks: [],
    timer: null,
    sttAbort: null,
    usedVoiceStt: false,
    editedAny: false,
    rawSttDraft: null,
    answers: {},
  };

  function invalidateDcProcessing() {
    dcVoice.processingGen += 1;
    if (dcVoice.sttAbort) {
      dcVoice.sttAbort.abort();
      dcVoice.sttAbort = null;
    }
  }

  function stopStreamTracks(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {}
    }
  }

  function teardownDcAudio() {
    dcVoice.pttHeld = false;
    dcVoice.pendingPermission = false;
    dcVoice.gestureToken += 1;
    if (dcVoice.timer) {
      clearTimeout(dcVoice.timer);
      dcVoice.timer = null;
    }
    if (dcVoice.recorder && dcVoice.recorder.state !== "inactive") {
      try {
        dcVoice.recorder.stop();
      } catch {}
    }
    dcVoice.recorder = null;
    dcVoice.chunks = [];
    if (dcVoice.stream) {
      stopStreamTracks(dcVoice.stream);
      dcVoice.stream = null;
    }
    dcVoice.recording = false;
    pttBtn.setAttribute("aria-pressed", "false");
  }

  function setDcStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function currentQuestions() {
    const guide = window.AstroTwinDailyVoiceGuide;
    return guide ? guide.getDailyVoiceQuestions(window.AstroTwinLocale?.get() || "es") : [];
  }

  function renderStep() {
    const questions = currentQuestions();
    const q = questions[dcVoice.stepIndex];
    if (!q) return;
    if (stepEl) {
      stepEl.dataset.stepIndex = String(dcVoice.stepIndex);
      stepEl.textContent = window.AstroTwinLocale?.get() === "en"
        ? `Question ${q.step} of ${questions.length} · ${q.title}`
        : `Pregunta ${q.step} de ${questions.length} · ${q.title}`;
    }
    if (questionEl) {
      const strong = document.createElement("strong");
      strong.textContent = q.prompt;
      questionEl.replaceChildren(strong);
    }
    if (transcriptInput) transcriptInput.value = "";
    if (transcriptZone) transcriptZone.hidden = true;
    dcVoice.rawSttDraft = null;
    if (q.key === "declared_condition" && !document.getElementById("dc-consent-condition")?.checked) {
      setDcStatus(window.AstroTwinLocale?.t("Q5 requiere marcar el consentimiento explícito arriba; si no, pulsa Saltar pregunta.", "Q5 requires explicit consent above; otherwise, skip the question."));
    } else {
      setDcStatus(window.AstroTwinLocale?.t("Mantén pulsado para responder por voz (máx. 15 s) o salta esta pregunta.", "Hold to answer by voice (max 15 seconds), or skip this question."));
    }
  }

  function syncAnswerToForm(key, mapped) {
    if (key === "sleep_rest") {
      const sel = document.getElementById("dc-sleep");
      if (sel) sel.value = mapped.status === "skipped" ? "skipped" : mapped.value || "fair";
    } else if (key === "recent_activity") {
      const sel = document.getElementById("dc-activity");
      if (sel) sel.value = mapped.status === "skipped" ? "skipped" : mapped.status === "ambiguous" ? "ambiguous" : mapped.value || "ambiguous";
    } else if (key === "symptoms") {
      const inp = document.getElementById("dc-symptoms-text");
      if (inp) inp.value = mapped.confirmed_text || "";
    } else if (key === "routine_change") {
      const sel = document.getElementById("dc-routine");
      if (sel) sel.value = mapped.status === "skipped" ? "skipped" : mapped.value || "none";
    } else if (key === "declared_condition") {
      const inp = document.getElementById("dc-condition-note");
      if (inp) inp.value = mapped.note || "";
    }
  }

  async function advanceOrFinish() {
    const questions = currentQuestions();
    if (dcVoice.stepIndex + 1 < questions.length) {
      dcVoice.stepIndex += 1;
      renderStep();
      return;
    }
    dcVoice.active = false;
    guidedEl.hidden = true;
    teardownDcAudio();
    const profileId = document.getElementById("dc-profile").value;
    const sessionConsent = Boolean(document.getElementById("dc-consent-session")?.checked);
    const condConsent = Boolean(document.getElementById("dc-consent-condition")?.checked);
    const a = dcVoice.answers;
    await submitDailyContext({
      profile_id: profileId,
      capture_mode: dcVoice.usedVoiceStt ? "voice_ptt_confirmed" : "text_fallback",
      transcript_confirmed_by_user: true,
      transcript_edited_by_user: dcVoice.editedAny,
      consent: {
        session_context_consent: sessionConsent,
        declared_condition_consent: condConsent,
        persist_confirmed_transcripts: false,
      },
      sleep_rest: a.sleep_rest || { status: "skipped" },
      recent_activity: a.recent_activity || { status: "skipped" },
      symptoms: a.symptoms || { status: "skipped", reported_none: false },
      routine_change: a.routine_change || { status: "skipped" },
      declared_condition: a.declared_condition || { status: "skipped", note: null },
    });
  }

  async function startDcRecording(sessionToken) {
    if (!dcVoice.active || dcVoice.recording || dcVoice.pendingPermission) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function" || typeof MediaRecorder === "undefined") {
      dcVoice.pttHeld = false;
      setDcStatus("Micrófono no disponible en este navegador; escribe tu respuesta abajo (modo texto).");
      if (transcriptZone) transcriptZone.hidden = false;
      return;
    }
    dcVoice.pendingPermission = true;
    try {
      const stream = await getVoiceMediaStream();
      const stillActive =
        dcVoice.active &&
        dcVoice.pttHeld &&
        dcVoice.gestureToken === sessionToken;
      if (!stillActive) {
        stopStreamTracks(stream);
        return;
      }
      dcVoice.pendingPermission = false;
      dcVoice.stream = stream;
      dcVoice.chunks = [];
      const recorder = new MediaRecorder(stream);
      dcVoice.recorder = recorder;
      recorder.addEventListener("dataavailable", (ev) => {
        if (ev.data && ev.data.size > 0) dcVoice.chunks.push(ev.data);
      });
      recorder.addEventListener("stop", async () => {
        if (!dcVoice.active || dcVoice.gestureToken !== sessionToken) {
          return;
        }
        const myProcessingGen = ++dcVoice.processingGen;
        const isCurrentProcessing = () =>
          dcVoice.active && dcVoice.processingGen === myProcessingGen;
        const chunks = dcVoice.chunks.slice();
        teardownDcAudio();
        if (!isCurrentProcessing()) {
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setDcStatus("No se capturó audio; puedes reintentar o escribir tu respuesta.");
          if (transcriptZone) transcriptZone.hidden = false;
          return;
        }
        setDcStatus("Convirtiendo la grabación a WAV local (en memoria)…");
        let wav;
        try {
          wav = await blobToWav(blob);
        } catch {
          if (!isCurrentProcessing()) return;
          setDcStatus("No se pudo convertir la grabación en este navegador; escribe tu respuesta o vuelve a grabar.");
          if (transcriptZone) transcriptZone.hidden = false;
          return;
        }
        if (!isCurrentProcessing()) {
          return;
        }
        setDcStatus("Transcribiendo respuesta en el sidecar local…");
        const sttController = new AbortController();
        dcVoice.sttAbort = sttController;
        try {
          const voiceLanguage = window.AstroTwinLocale?.get() || "es";
          const sttRes = await fetch(`/api/voice/stt?language=${encodeURIComponent(voiceLanguage)}`, {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: wav,
            signal: sttController.signal,
          });
          if (!isCurrentProcessing()) {
            return;
          }
          const data = await sttRes.json().catch(() => ({}));
          if (!isCurrentProcessing()) {
            return;
          }
          if (!sttRes.ok || !data.available || !data.text) {
            setDcStatus(data.reason || "STT local no disponible; escribe tu respuesta para confirmar.");
            if (transcriptZone) transcriptZone.hidden = false;
            return;
          }
          dcVoice.usedVoiceStt = true;
          dcVoice.rawSttDraft = data.text;
          if (transcriptInput) transcriptInput.value = data.text;
          if (transcriptZone) transcriptZone.hidden = false;
          setDcStatus(window.AstroTwinLocale?.t("Revisa o edita la transcripción y pulsa Confirmar respuesta y avanzar.", "Review or edit the transcript, then confirm to continue."));
        } catch (err) {
          if (!isCurrentProcessing()) {
            return;
          }
          if (err.name !== "AbortError") {
            setDcStatus("Error en STT local; escribe tu respuesta abajo.");
            if (transcriptZone) transcriptZone.hidden = false;
          }
        } finally {
          if (dcVoice.sttAbort === sttController) {
            dcVoice.sttAbort = null;
          }
        }
      });
      recorder.start();
      dcVoice.recording = true;
      pttBtn.setAttribute("aria-pressed", "true");
      setDcStatus("Grabando respuesta… suelta al terminar (máx. 15 s).");
      dcVoice.timer = setTimeout(() => {
        if (dcVoice.recording) stopDcRecording();
      }, 15000);
    } catch {
      if (!dcVoice.active || dcVoice.gestureToken !== sessionToken) {
        return;
      }
      teardownDcAudio();
      setDcStatus("Permiso de micrófono denegado o no disponible; usa modo texto.");
      if (transcriptZone) transcriptZone.hidden = false;
    }
  }

  function stopDcRecording() {
    if (!dcVoice.recording) return;
    if (dcVoice.timer) {
      clearTimeout(dcVoice.timer);
      dcVoice.timer = null;
    }
    if (dcVoice.recorder && dcVoice.recorder.state !== "inactive") {
      try {
        dcVoice.recorder.stop();
      } catch {
        teardownDcAudio();
      }
    } else {
      teardownDcAudio();
    }
  }

  function beginDcPtt() {
    if (!dcVoice.active || dcVoice.recording || dcVoice.pendingPermission) return;
    invalidateDcProcessing();
    dcVoice.pttHeld = true;
    dcVoice.gestureToken += 1;
    startDcRecording(dcVoice.gestureToken);
  }

  function releaseDcPtt() {
    dcVoice.pttHeld = false;
    if (dcVoice.pendingPermission) {
      dcVoice.gestureToken += 1;
      dcVoice.pendingPermission = false;
      pttBtn.setAttribute("aria-pressed", "false");
      if (dcVoice.active) {
        setDcStatus("Pulsación soltada antes de iniciar la grabación; no se grabó audio.");
      }
      return;
    }
    if (dcVoice.recording) {
      stopDcRecording();
    }
  }

  startBtn.addEventListener("click", () => {
    invalidateDcProcessing();
    teardownDcAudio();
    dcVoice.active = true;
    dcVoice.stepIndex = 0;
    dcVoice.usedVoiceStt = false;
    dcVoice.editedAny = false;
    dcVoice.answers = {};
    guidedEl.hidden = false;
    renderStep();
  });

  pttBtn.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    try { pttBtn.setPointerCapture(ev.pointerId); } catch {}
    beginDcPtt();
  });
  pttBtn.addEventListener("pointerup", () => releaseDcPtt());
  pttBtn.addEventListener("pointercancel", () => releaseDcPtt());
  pttBtn.addEventListener("keydown", (ev) => {
    if ((ev.key === " " || ev.key === "Enter") && !ev.repeat) {
      ev.preventDefault();
      beginDcPtt();
    }
  });
  pttBtn.addEventListener("keyup", (ev) => {
    if (ev.key === " " || ev.key === "Enter") {
      releaseDcPtt();
    }
  });

  ttsBtn?.addEventListener("click", async () => {
    const q = currentQuestions()[dcVoice.stepIndex];
    if (!q) return;
    if (window.AstroTwinLocale?.get() === "en") {
      const spoken = speakWithSystemVoice(q.prompt, "en-US");
      if (!spoken) setDcStatus("English system speech is unavailable; the question remains visible.");
      return;
    }
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q.prompt }),
      });
      if (!res.ok) {
        setDcStatus("TTS local no disponible; la pregunta permanece visible en pantalla.");
        return;
      }
      const buf = await res.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(buf);
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(ctx.destination);
        src.onended = () => ctx.close().catch(() => {});
        src.start();
      }
    } catch {
      setDcStatus("TTS local no disponible; la pregunta permanece visible en pantalla.");
    }
  });

  confirmBtn?.addEventListener("click", async () => {
    const q = currentQuestions()[dcVoice.stepIndex];
    const guide = window.AstroTwinDailyVoiceGuide;
    if (!q || !guide) return;
    const text = (transcriptInput?.value || "").trim();
    if (!text) {
      setDcStatus("Escribe una respuesta o pulsa Saltar pregunta.");
      return;
    }
    invalidateDcProcessing();
    if (dcVoice.rawSttDraft !== null && dcVoice.rawSttDraft !== text) {
      dcVoice.editedAny = true;
    }
    const condConsent = Boolean(document.getElementById("dc-consent-condition")?.checked);
    const mapped = guide.mapVoiceTranscriptToAnswer(q.key, text, condConsent);
    dcVoice.answers[q.key] = mapped;
    syncAnswerToForm(q.key, mapped);
    await advanceOrFinish();
  });

  skipBtn?.addEventListener("click", async () => {
    const q = currentQuestions()[dcVoice.stepIndex];
    if (!q) return;
    invalidateDcProcessing();
    dcVoice.answers[q.key] = q.key === "symptoms"
      ? { status: "skipped", reported_none: false, confirmed_text: null }
      : q.key === "declared_condition"
        ? { status: "skipped", note: null }
        : { status: "skipped", value: null };
    syncAnswerToForm(q.key, dcVoice.answers[q.key]);
    await advanceOrFinish();
  });

  retryBtn?.addEventListener("click", () => {
    invalidateDcProcessing();
    if (transcriptInput) transcriptInput.value = "";
    if (transcriptZone) transcriptZone.hidden = true;
    dcVoice.rawSttDraft = null;
    setDcStatus("Borrador descartado. Mantén pulsado para responder o salta la pregunta.");
  });

  cancelBtn?.addEventListener("click", () => {
    invalidateDcProcessing();
    teardownDcAudio();
    dcVoice.active = false;
    dcVoice.answers = {};
    guidedEl.hidden = true;
    setDcStatus("Modo voz cancelado; no se guardó ningún contexto.");
  });

  window.addEventListener("pagehide", () => {
    invalidateDcProcessing();
    teardownDcAudio();
  });
  window.addEventListener("beforeunload", () => {
    invalidateDcProcessing();
    teardownDcAudio();
  });
}
