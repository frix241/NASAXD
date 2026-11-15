(() => {
  "use strict";

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function optionalNumber(id) {
    const input = document.getElementById(id);
    if (!input || input.value.trim() === "") return null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : null;
  }

  function renderResult(output, data) {
    const en = window.AstroTwinLocale?.get() === "en";
    const zoneLabel = {
      thorax: en ? "chest" : "tórax",
      systemic: en ? "whole body" : "sistémica",
      musculoskeletal: en ? "musculoskeletal system" : "sistema musculoesquelético",
      none: en ? "no area highlighted" : "sin zona señalada",
    }[data.zone_highlight] || data.zone_highlight;
    const statusLabel = {
      within_reference: en ? "within general reference" : "dentro de referencia general",
      outside_reference: en ? "outside general reference" : "fuera de referencia general",
      urgent: en ? "prompt review needed" : "requiere revisión pronta",
    }[data.overall_state] || data.overall_state;
    output.replaceChildren();
    const stateClass = data.overall_state === "urgent"
      ? "state-box state-box--error"
      : data.overall_state === "outside_reference"
        ? "state-box state-box--warn"
        : "state-box";
    const summary = make("div", stateClass);
    const heading = make("strong", "", data.copilot_message);
    summary.appendChild(heading);
    summary.appendChild(
      make(
        "p",
        "hint",
        en
          ? `Twin zone: ${zoneLabel}. Status: ${statusLabel}.`
          : `Zona del gemelo: ${zoneLabel}. Estado: ${statusLabel}.`,
      ),
    );
    output.appendChild(summary);

    const readings = make("div", "multi-vitals-readings");
    for (const item of data.observations || []) {
      const card = make("article", "multi-vitals-reading");
      card.appendChild(make("h4", "", `${item.label}: ${item.value}`));
      card.appendChild(make("p", "hint", `${en ? "General reference:" : "Referencia general:"} ${item.reference}`));
      card.appendChild(make("p", "", item.message));
      readings.appendChild(card);
    }
    if (readings.childElementCount) output.appendChild(readings);

    if (Array.isArray(data.mission_metrics) && data.mission_metrics.length) {
      const section = make("section", "multi-vitals-mission-metrics");
      section.setAttribute("aria-labelledby", "multi-vitals-mission-heading");
      const heading = make("h4", "", en ? "Mission tracking measures" : "Métricas de seguimiento de misión");
      heading.id = "multi-vitals-mission-heading";
      section.appendChild(heading);
      const list = make("div", "multi-vitals-readings");
      const statuses = {
        logged_only: en ? "Logged only" : "Solo registro",
        meeting_mission_reference: en ? "Meets mission reference" : "Cumple referencia de misión",
        below_mission_reference: en ? "Review with mission team" : "Revisar con equipo de misión",
        within_limit: en ? "Below entered mission limit" : "Bajo el límite de misión ingresado",
        limit_reached: en ? "Mission review limit reached" : "Límite de revisión alcanzado",
        unassessed: en ? "Not assessed: no mission limit" : "Sin evaluar: falta límite de misión",
      };
      for (const metric of data.mission_metrics) {
        const card = make("article", "multi-vitals-reading");
        card.dataset.metricStatus = metric.status;
        card.appendChild(make("h5", "", `${metric.label}: ${metric.value}`));
        card.appendChild(make("strong", "", statuses[metric.status] || metric.status));
        card.appendChild(make("p", "", metric.message));
        list.appendChild(card);
      }
      section.appendChild(list);
      output.appendChild(section);
    }

    if (Array.isArray(data.recommendations) && data.recommendations.length) {
      const list = make("ul", "multi-vitals-recommendations");
      for (const recommendation of data.recommendations) {
        list.appendChild(make("li", "", recommendation));
      }
      output.appendChild(list);
    }

    if (Array.isArray(data.sources) && data.sources.length) {
      const details = make("details", "multi-vitals-sources");
      details.appendChild(make("summary", "", en ? "Sources for references" : "Fuentes de las referencias"));
      const list = make("ul");
      for (const source of data.sources) {
        const item = make("li");
        const link = make("a", "", source.title || source.url);
        try {
          const url = new URL(source.url);
          if (url.protocol === "https:") {
            link.href = url.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          } else {
            link.removeAttribute("href");
          }
        } catch (_) {
          link.removeAttribute("href");
        }
        item.appendChild(link);
        list.appendChild(item);
      }
      details.appendChild(list);
      output.appendChild(details);
    }

    output.appendChild(
      make(
        "p",
        "hint",
        en
          ? "Demo comparison using general adult references; not a diagnosis or substitute for medical care. Readings are manual; no sensors are connected."
          : "Comparación de demostración con referencias generales para adultos; no es un diagnóstico ni sustituye una valoración médica. Lecturas manuales, sin conexión a sensores.",
      ),
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("multi-vitals-form");
    const output = document.getElementById("multi-vitals-output");
    if (!form || !output) return;
    const missionProfile = document.getElementById("mv-profile");
    const contextProfile = document.getElementById("dc-profile");
    if (missionProfile && contextProfile) {
      missionProfile.value = contextProfile.value;
      missionProfile.addEventListener("change", () => { contextProfile.value = missionProfile.value; });
      contextProfile.addEventListener("change", () => { missionProfile.value = contextProfile.value; });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = document.getElementById("mv-submit");
      if (submit) submit.disabled = true;
      output.replaceChildren(make("div", "state-box", "Evaluando las lecturas…"));

      const profile = document.getElementById("mv-profile");
      const symptoms = document.getElementById("mv-symptoms");
      const payload = {
        language: window.AstroTwinLocale?.get() || "es",
        profile_id: profile?.value || "C001-sim",
        heart_rate_bpm: optionalNumber("mv-heart-rate"),
        respiratory_rate_per_min: optionalNumber("mv-respiratory-rate"),
        systolic_mmhg: optionalNumber("mv-systolic"),
        diastolic_mmhg: optionalNumber("mv-diastolic"),
        spo2_percent: optionalNumber("mv-spo2"),
        temperature_celsius: optionalNumber("mv-temperature"),
        hydration_intake_ml: optionalNumber("mv-hydration"),
        muscle_strength_percent_baseline: optionalNumber("mv-muscle-strength"),
        bone_density_percent_baseline: optionalNumber("mv-bone-density"),
        bone_site: document.getElementById("mv-bone-site")?.value || null,
        radiation_dose_msv: optionalNumber("mv-radiation-dose"),
        radiation_limit_msv: optionalNumber("mv-radiation-limit"),
        symptom_text: symptoms?.value.trim() || null,
        use_stored_daily_context: true,
      };
      for (const key of Object.keys(payload)) {
        if (payload[key] === null) delete payload[key];
      }

      try {
        const response = await fetch("/api/vitals/multi-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
          const detail = Array.isArray(data.detail)
            ? data.detail.map((item) => item.msg).join(" ")
            : typeof data.detail === "string" ? data.detail : "Revisa las lecturas ingresadas.";
          output.replaceChildren(make("div", "state-box state-box--error", detail));
          return;
        }
        renderResult(output, data);
        window.dispatchEvent(new CustomEvent("astrotwin:integration-3d", {
          detail: structuredClone(data.integration_3d),
        }));
      } catch (_) {
        output.replaceChildren(
          make("div", "state-box state-box--error", window.AstroTwinLocale?.t("No se pudo evaluar. Revisa la conexión local e inténtalo otra vez.", "Could not evaluate readings. Check the local connection and try again.")),
        );
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  });
})();
