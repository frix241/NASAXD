"use strict";

(function () {
  const vitalsState = {
    presets: [],
    currentSamples: [],
    currentContext: "rest",
    lastResponse: null,
  };

  function escVitals(value) {
    const str = value === null || value === undefined ? "" : String(value);
    return str
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function vitalsFetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || `Error HTTP ${res.status}`);
    }
    return data;
  }

  function statusBadgeVariant(status) {
    if (status === "nominal") return "ok";
    if (status === "sustained_deviation") return "err";
    return "warn";
  }

  function statusLabelEs(status) {
    const map = {
      nominal: "Nominal (simulado)",
      transient_spike: "Pico aislado (reconfirmar)",
      sustained_deviation: "Desviación sostenida (simulada)",
      insufficient_baseline: "Línea base insuficiente",
      low_quality: "Calidad sospechosa · Remedición",
      missing_data: "Sin datos · Remedición",
    };
    return map[status] || status;
  }

  function contextLabelEs(ctx) {
    const map = {
      rest: "Reposo (rest)",
      activity: "Actividad (activity)",
      sleep: "Sueño (sleep)",
    };
    return map[ctx] || ctx;
  }

  function trendLabelEs(dir) {
    const map = {
      rising: "Tendencia al alza",
      falling: "Tendencia a la baja",
      stable: "Tendencia estable",
      insufficient_data: "Tendencia: datos insuficientes",
    };
    return map[dir] || dir;
  }

  function readAdaptationRulesFromUI() {
    return {
      allow_adaptive_adjustment: document.getElementById("rule-allow-adapt").checked,
      reduce_intensity_on_sustained_deviation: document.getElementById("rule-reduce-sustained").checked,
      sustained_target_intensity: document.getElementById("rule-target-intensity").value || "low",
      duration_reduction_factor: Number(document.getElementById("rule-duration-factor").value) || 0.5,
      pause_high_load_on_active_symptoms: document.getElementById("rule-pause-symptoms").checked,
      hold_unchanged_on_suspect_quality: document.getElementById("rule-hold-suspect").checked,
      hold_unchanged_on_transient_spike: true,
      require_human_confirmation: true,
    };
  }

  function readEngineConfigFromUI() {
    const minScore = Number(document.getElementById("rule-min-quality-score").value);
    const minDelta = Number(document.getElementById("rule-min-delta-bpm").value);
    return {
      min_signal_quality_score: Number.isFinite(minScore) ? minScore : 0.6,
      min_delta_bpm_illustrative: Number.isFinite(minDelta) ? minDelta : 12.0,
    };
  }

  function renderTrendSvg(trend, baseline) {
    const points = (trend && Array.isArray(trend.points) ? trend.points : []).filter(
      (p) => p.value_bpm !== null && p.value_bpm !== undefined
    );
    if (!points.length) {
      return `<div class="state-box">Sin lecturas numéricas para graficar tendencia.</div>`;
    }

    const width = 420;
    const height = 140;
    const padX = 28;
    const padY = 18;
    const values = points.map((p) => Number(p.value_bpm));
    const center = baseline && baseline.baseline_center_bpm ? Number(baseline.baseline_center_bpm) : null;
    const thr = baseline && baseline.effective_delta_threshold_bpm ? Number(baseline.effective_delta_threshold_bpm) : null;

    if (center !== null && thr !== null) {
      values.push(center + thr, center - thr);
    }
    const minV = Math.min(...values) - 5;
    const maxV = Math.max(...values) + 5;
    const span = Math.max(1, maxV - minV);

    const toX = (idx) => {
      if (points.length === 1) return width / 2;
      return padX + (idx / (points.length - 1)) * (width - 2 * padX);
    };
    const toY = (val) => height - padY - ((val - minV) / span) * (height - 2 * padY);

    let bandMarkup = "";
    if (center !== null && thr !== null) {
      const yTop = toY(center + thr);
      const yBot = toY(center - thr);
      const yMid = toY(center);
      bandMarkup = `
        <rect x="${padX}" y="${yTop.toFixed(1)}" width="${width - 2 * padX}" height="${Math.max(2, yBot - yTop).toFixed(1)}" fill="rgba(56, 189, 248, 0.12)" />
        <line x1="${padX}" y1="${yMid.toFixed(1)}" x2="${width - padX}" y2="${yMid.toFixed(1)}" stroke="#38bdf8" stroke-dasharray="4 3" stroke-width="1.2" />
      `;
    }

    const polyCoords = points
      .map((p, i) => `${toX(i).toFixed(1)},${toY(Number(p.value_bpm)).toFixed(1)}`)
      .join(" ");

    const circles = points
      .map((p, i) => {
        const cx = toX(i).toFixed(1);
        const cy = toY(Number(p.value_bpm)).toFixed(1);
        let fill = "#6ee7b7";
        if (!p.valid_for_engine) fill = "#fcd34d";
        else if (p.deviating_from_baseline) fill = "#fca5a5";
        return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${fill}" stroke="#0b1017" stroke-width="1.5"><title>Muestra ${i + 1}: ${escVitals(p.value_bpm)} bpm (${escVitals(p.quality)})</title></circle>`;
      })
      .join("");

    return `
      <svg class="vitals-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia de pulso simulado">
        ${bandMarkup}
        <polyline fill="none" stroke="#b4c0cf" stroke-width="2" points="${polyCoords}" />
        ${circles}
      </svg>
    `;
  }

  function renderVitalsResult(data) {
    const out = document.getElementById("vitals-output");
    if (!out) return;

    const ev = data.evaluation;
    const q = data.quality_summary;
    const trend = data.trend;
    const zone = data.zone_highlight;
    const adapt = data.mission_adaptation;
    const baseline = ev.baseline || {};
    const confirmToken = data.confirmation_token || adapt.confirmation_token;
    const isMedicalEscalation = Boolean(data.contact_medical_team || adapt.contact_medical_team);
    const medicalNotice = data.medical_contact_notice || adapt.medical_contact_notice || adapt.summary;
    const effectivePolicyAction = data.policy_action || adapt.policy_action;
    const missionsList = Array.isArray(data.proposed_missions)
      ? data.proposed_missions
      : adapt.adapted_missions || [];

    const urgentMedicalBanner = isMedicalEscalation
      ? `
        <div class="vitals-urgent-medical-box state-box state-box--error" role="alert" style="margin-bottom: 0.75rem;">
          <strong>DETENER ACTIVIDAD Y CONTACTAR EQUIPO MÉDICO DE LA MISIÓN:</strong>
          ${escVitals(medicalNotice)}
          ${
            data.provenance?.safety_audit?.emergency_bypass && data.llm_output?.answer
              ? `<div class="hint" id="vitals-emergency-bypass-note" style="margin-top:0.35rem;">${escVitals(data.llm_output.answer)} (modo: <code>${escVitals(data.provenance.mode)}</code>, sin llamada al LLM)</div>`
              : ""
          }
        </div>
      `
      : "";

    const abstentionBanner = data.abstained
      ? `
        <div class="state-box state-box--warn" id="vitals-abstention-box" role="status" style="margin-bottom: 0.75rem;">
          <strong>Abstención determinista:</strong> ${escVitals(data.abstention_reason || "Datos insuficientes o inciertos; se abstiene de inferir anomalía.")}
        </div>
      `
      : "";

    const explanationBox = data.deterministic_explanation
      ? `
        <div class="state-box" id="vitals-deterministic-explanation" style="margin-bottom: 0.75rem;">
          <strong>Explicación determinista:</strong> ${escVitals(data.deterministic_explanation)}
        </div>
      `
      : "";

    const remeasureBanner = q.remeasurement_requested && !isMedicalEscalation
      ? `
        <div class="vitals-remeasure-box" role="alert">
          <strong>Calidad sospechosa detectada:</strong> ${escVitals(q.remeasurement_reason)}
          <div class="btn-row" style="margin-top: 0.5rem;">
            <button type="button" class="btn-primary" id="btn-vitals-remeasure-clean">Solicitar remedición (lectura limpia demo)</button>
            <input type="number" id="vitals-remeasure-bpm" min="30" max="220" step="1" placeholder="BPM confirmado" aria-label="BPM para remedición manual" style="max-width: 150px;" />
            <button type="button" id="btn-vitals-remeasure-manual">Registrar remedición manual</button>
          </div>
        </div>
      `
      : "";

    const isRejectedState = adapt.confirmation_status === "rejected";
    const missionRows = missionsList
      .map((m) => {
        const badgeCls = m.status === "unchanged" ? "" : ["remeasurement_added", "context_review_added"].includes(m.status) ? "badge--warn" : "badge--err";
        const confText = m.confirmed
          ? "Confirmada"
          : isRejectedState
            ? "Rechazada (no confirmada)"
            : "Pendiente confirmación";
        return `
          <tr>
            <td>${escVitals(m.title)}</td>
            <td>${escVitals(m.intensity)}</td>
            <td class="num">${escVitals(m.duration_min)} min</td>
            <td><span class="badge ${badgeCls}">${escVitals(m.status)}</span></td>
            <td>${escVitals(confText)}</td>
          </tr>
        `;
      })
      .join("");

    const dctx = data.daily_context_applied;

    out.innerHTML = `
      <div class="vitals-sim-banner" role="note">
        <span class="badge badge--warn">DETECCIÓN SIMULADA · NO CLÍNICO</span>
        <span>Namespace: <code>${escVitals(data.namespace)}</code> · Signos vitales reales mutados: <code>${escVitals(data.real_vitals_mutated)}</code> · Diagnóstico clínico: <code>${escVitals(data.is_clinical_diagnosis)}</code></span>
      </div>
      <div id="vitals-daily-context-slot"></div>

      <div class="kpi-row">
        <div class="kpi">
          <span class="kpi-label">Estado del motor</span>
          <span class="kpi-value"><span class="badge badge--${statusBadgeVariant(ev.status)}">${escVitals(statusLabelEs(ev.status))}</span></span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Contexto</span>
          <span class="kpi-value">${escVitals(contextLabelEs(ev.context))}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Calidad última lectura</span>
          <span class="kpi-value">${escVitals(q.latest_quality || "N/D")} (${q.latest_signal_quality_score !== null && q.latest_signal_quality_score !== undefined ? escVitals(q.latest_signal_quality_score) : "N/D"})</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Tendencia</span>
          <span class="kpi-value">${escVitals(trendLabelEs(trend.direction))}</span>
        </div>
      </div>

      ${urgentMedicalBanner}
      ${abstentionBanner}
      ${explanationBox}
      ${remeasureBanner}

      <div class="grid-2">
        <div class="panel">
          <h4>Tendencia y Línea Base Personal</h4>
          ${renderTrendSvg(trend, baseline)}
          <p class="hint">
            Centro línea base: <strong>${baseline.baseline_center_bpm !== null && baseline.baseline_center_bpm !== undefined ? escVitals(baseline.baseline_center_bpm) + " bpm" : "Sin establecer"}</strong>
            · Umbral ilustrativo: <strong>${baseline.effective_delta_threshold_bpm ? "±" + escVitals(baseline.effective_delta_threshold_bpm) + " bpm" : "N/D"}</strong>
            · Delta reciente: <strong>${trend.delta_from_baseline_bpm !== null && trend.delta_from_baseline_bpm !== undefined ? escVitals(trend.delta_from_baseline_bpm) + " bpm" : "N/D"}</strong>
          </p>
          <p>${escVitals(ev.explanation)}</p>
        </div>

        <div class="panel">
          <h4>Zona / Sistema e Información No Clínica</h4>
          <p>
            <span class="badge badge--${zone.severity === "nominal" ? "ok" : zone.severity === "priority" ? "err" : "warn"}">Zona: ${escVitals(zone.zone)} · Sistema: ${escVitals(zone.system)}</span>
          </p>
          <p><strong>${escVitals(zone.non_clinical_title)}</strong></p>
          <p class="hint">${escVitals(zone.non_clinical_info)}</p>
          ${zone.reference_citation ? `<p class="hint"><strong>Referencia educativa:</strong> ${escVitals(zone.reference_citation)}</p>` : ""}
          <details>
            <summary>Ver contrato 3D y limitaciones</summary>
            <pre class="json-view">${escVitals(JSON.stringify(zone.event_3d, null, 2))}</pre>
          </details>
        </div>
      </div>

      <div class="panel" style="margin-top: 1rem;">
        <h4>Ajuste Adaptativo de Misiones Diarias (Política Explícita y Auditoría)</h4>
        <p class="hint">
          Acción de política: <code>${escVitals(effectivePolicyAction)}</code> ·
          Política: <code>${escVitals(adapt.matched_policy_id)}</code> ·
          Regla aplicada: <code>${escVitals(adapt.rule_applied)}</code> — ${escVitals(adapt.summary)}
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Misión</th>
                <th scope="col">Intensidad</th>
                <th scope="col" class="num">Duración</th>
                <th scope="col">Estado</th>
                <th scope="col">Confirmación</th>
              </tr>
            </thead>
            <tbody>${missionRows}</tbody>
          </table>
        </div>
        <div class="btn-row" style="margin-top: 0.75rem;">
          <button type="button" class="btn-primary" id="btn-vitals-confirm-missions" data-token="${escVitals(confirmToken)}">
            Confirmar ajuste de misiones
          </button>
          <button type="button" class="btn-secondary" id="btn-vitals-reject-missions" data-token="${escVitals(confirmToken)}">
            Rechazar ajuste de misiones
          </button>
          <span class="hint" id="vitals-confirm-status" role="status" aria-live="polite">${escVitals(adapt.safety_note)}</span>
        </div>
        ${
          data.report
            ? `<details style="margin-top: 0.75rem;" id="vitals-checkin-report">
                <summary>Reporte check-in diario (<code>${escVitals(data.report.report_id)}</code> · fuentes: ${escVitals((data.report.sources || []).join(", "))})</summary>
                <pre class="json-view" id="vitals-report-json">${escVitals(JSON.stringify(data.report, null, 2))}</pre>
              </details>`
            : ""
        }
        ${
          adapt.audit_entry
            ? `<details style="margin-top: 0.75rem;" id="vitals-audit-details">
                <summary>Ver pista de auditoría (<code>${escVitals(adapt.audit_entry.audit_id)}</code>)</summary>
                <pre class="json-view" id="vitals-audit-json">${escVitals(JSON.stringify(adapt.audit_entry, null, 2))}</pre>
              </details>`
            : ""
        }
      </div>
    `;

    const dailySlot = document.getElementById("vitals-daily-context-slot");
    if (dailySlot && dctx) {
      const banner = document.createElement("div");
      banner.className = "state-box";
      banner.id = "vitals-daily-context-banner";
      banner.style.marginBottom = "0.75rem";
      const act = dctx.recent_activity_value || dctx.recent_activity_status;
      const slp = dctx.sleep_rest_value || dctx.sleep_rest_status;
      const rtn = dctx.routine_change_value || dctx.routine_change_status;
      const mainLine = document.createElement("div");
      mainLine.textContent = `Contexto diario conectado (${dctx.context_id}): actividad reciente = ${act}, sueño = ${slp}, rutina = ${rtn}`;
      banner.appendChild(mainLine);
      if (dctx.context_note) {
        const noteEl = document.createElement("div");
        noteEl.className = "hint";
        noteEl.textContent = dctx.context_note;
        banner.appendChild(noteEl);
      }
      dailySlot.replaceChildren(banner);
    }

    const cleanBtn = document.getElementById("btn-vitals-remeasure-clean");
    if (cleanBtn) {
      cleanBtn.addEventListener("click", () => requestRemeasure(true));
    }
    const manualBtn = document.getElementById("btn-vitals-remeasure-manual");
    if (manualBtn) {
      manualBtn.addEventListener("click", () => requestRemeasure(false));
    }
    const confirmBtn = document.getElementById("btn-vitals-confirm-missions");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => submitMissionDecision(confirmToken, true));
    }
    const rejectBtn = document.getElementById("btn-vitals-reject-missions");
    if (rejectBtn) {
      rejectBtn.addEventListener("click", () => submitMissionDecision(confirmToken, false));
    }
  }

  async function runVitalsAnalysis(presetId = null) {
    const profileId = document.getElementById("vitals-profile").value || "C001-sim";
    const context = document.getElementById("vitals-context").value || "rest";
    const symptomText = document.getElementById("vitals-symptoms").value.trim() || null;

    const payload = {
      profile_id: profileId,
      target_context: context,
      samples: vitalsState.currentSamples,
      symptom_text: symptomText,
      use_stored_daily_context: true,
      config: readEngineConfigFromUI(),
      adaptation_rules: readAdaptationRulesFromUI(),
      use_llm: false,
    };

    try {
      const data = await vitalsFetchJson("/api/daily-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      vitalsState.lastResponse = data;
      vitalsState.currentContext = data.evaluation.context;
      document.getElementById("vitals-context").value = data.evaluation.context;
      renderVitalsResult(data);
    } catch (err) {
      const out = document.getElementById("vitals-output");
      out.innerHTML = `<div class="state-box state-box--error">${escVitals(err.message)}</div>`;
    }
  }

  async function requestRemeasure(useCleanDemo) {
    const profileId = document.getElementById("vitals-profile").value || "C001-sim";
    const context = vitalsState.currentContext || "rest";
    const symptomText = document.getElementById("vitals-symptoms").value.trim() || null;

    const body = {
      profile_id: profileId,
      target_context: context,
      prior_samples: vitalsState.currentSamples,
      use_clean_demo_reading: useCleanDemo,
      symptom_text: symptomText,
      confirmed_rest_for_remeasure: context === "rest",
      config: readEngineConfigFromUI(),
      adaptation_rules: readAdaptationRulesFromUI(),
    };

    if (!useCleanDemo) {
      const bpmInput = document.getElementById("vitals-remeasure-bpm");
      const bpmVal = Number(bpmInput ? bpmInput.value : "");
      if (!Number.isFinite(bpmVal) || bpmVal < 30 || bpmVal > 220) {
        const statusEl = document.getElementById("vitals-confirm-status");
        if (statusEl) statusEl.textContent = "Ingresa un BPM válido entre 30 y 220 para remedir.";
        return;
      }
      body.new_sample = {
        value_bpm: bpmVal,
        context,
        quality: "good",
        signal_quality_score: 0.96,
        measurement_confirmed: true,
        source: "simulated_manual_remeasure",
      };
    }

    try {
      const data = await vitalsFetchJson("/api/vitals/remeasure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (data.trend && Array.isArray(data.trend.points)) {
        vitalsState.currentSamples = data.trend.points.map((p) => ({
          value_bpm: p.value_bpm,
          context: p.context,
          quality: p.quality,
          signal_quality_score: p.signal_quality_score,
          measurement_confirmed: p.measurement_confirmed,
          source: "simulated_session",
        }));
      }
      // /api/vitals/remeasure aún no devuelve DailyCheckinResponse completo;
      // reevaluamos la serie actualizada en /api/daily-checkin conservando el contexto almacenado.
      await runVitalsAnalysis(null);
    } catch (err) {
      const out = document.getElementById("vitals-output");
      out.innerHTML = `<div class="state-box state-box--error">${escVitals(err.message)}</div>`;
    }
  }

  async function submitMissionDecision(token, confirmed) {
    const confirmBtn = document.getElementById("btn-vitals-confirm-missions");
    const rejectBtn = document.getElementById("btn-vitals-reject-missions");
    if (confirmBtn) confirmBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
    const decision = Boolean(confirmed);
    try {
      const res = await vitalsFetchJson("/api/vitals/missions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation_token: token, confirmed: decision }),
      });
      if (vitalsState.lastResponse) {
        const accepted = res.status === "confirmed" && decision;
        const returnedMissions = Array.isArray(res.confirmed_missions)
          ? res.confirmed_missions.map((m) => ({
              ...m,
              confirmed: accepted ? Boolean(m.confirmed) : false,
            }))
          : [];
        vitalsState.lastResponse.mission_adaptation.adapted_missions = returnedMissions;
        if (Array.isArray(vitalsState.lastResponse.proposed_missions)) {
          vitalsState.lastResponse.proposed_missions = returnedMissions;
        }
        vitalsState.lastResponse.mission_adaptation.confirmation_status =
          res.status || (accepted ? "confirmed" : "rejected");
        renderVitalsResult(vitalsState.lastResponse);
        const statusEl = document.getElementById("vitals-confirm-status");
        if (statusEl) {
          statusEl.textContent = accepted
            ? `Misiones simuladas confirmadas (${res.recorded_at}).`
            : `Ajuste de misiones rechazado (${res.recorded_at}): ninguna misión quedó confirmada.`;
        }
      }
    } catch (err) {
      if (confirmBtn) confirmBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;
      const statusEl = document.getElementById("vitals-confirm-status");
      if (statusEl) {
        statusEl.textContent = `Error al ${decision ? "confirmar" : "rechazar"}: ${err.message}`;
      }
    }
  }

  async function loadVitalsPresets() {
    const presetContainer = document.getElementById("vitals-preset-buttons");
    if (!presetContainer) return;

    try {
      const data = await vitalsFetchJson("/api/vitals/presets");
      vitalsState.presets = data.presets || [];
      presetContainer.innerHTML = vitalsState.presets
        .map(
          (p) =>
            `<button type="button" class="vitals-preset-btn" data-preset="${escVitals(p.preset_id)}" title="${escVitals(p.description)}">${escVitals(p.label)}</button>`
        )
        .join("");

      presetContainer.querySelectorAll(".vitals-preset-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pid = btn.getAttribute("data-preset");
          const found = vitalsState.presets.find((item) => item.preset_id === pid);
          if (found) {
            vitalsState.currentSamples = found.samples || [];
            vitalsState.currentContext = found.target_context;
            document.getElementById("vitals-context").value = found.target_context;
            document.getElementById("vitals-symptoms").value = found.symptom_text || "";
          }
          runVitalsAnalysis(null);
        });
      });

      if (vitalsState.presets.length > 0) {
        const first = vitalsState.presets[0];
        vitalsState.currentSamples = first.samples || [];
        vitalsState.currentContext = first.target_context;
        runVitalsAnalysis(null);
      }
    } catch (err) {
      presetContainer.innerHTML = `<div class="state-box state-box--error">No se pudieron cargar los presets: ${escVitals(err.message)}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("vitals-analyze-form");
    if (!form) return;

    loadVitalsPresets();
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      runVitalsAnalysis(null);
    });
    window.addEventListener("astrotwin:daily-context-updated", (ev) => {
      const pid = ev?.detail?.profile_id;
      const profileSelect = document.getElementById("vitals-profile");
      if (pid && profileSelect) profileSelect.value = pid;
      runVitalsAnalysis(null);
    });
  });
})();
