(() => {
  "use strict";
  const KEY = "astrotwin.language";
  const supported = new Set(["es", "en"]);
  let current = supported.has(localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : "es";
  const originalText = new Map();

  function t(es, en) {
    return current === "en" ? en : es;
  }

  function text(selector, value) {
    const element = document.querySelector(selector);
    if (element) {
      if (!originalText.has(element)) originalText.set(element, element.textContent);
      element.textContent = value;
    }
  }

  const enText = {
    "#main > .provenance-strip .lane:nth-child(1) .lane-tag": "LANE 1 · simulation_synthetic",
    "#main > .provenance-strip .lane:nth-child(2) .lane-tag": "LANE 2 · real_lab_nasa_osdr",
    "#main > .provenance-strip .lane:nth-child(3) .lane-tag": "LANE 3 · llm_context (az³tro)",
    "#h-az3tro": "3. az³tro Copilot and 3D Integration",
    "#h-entrevista": "4. Daily Check-in and Mission Suggestions",
    "#h-vitales": "4B. Mission Health Readings and Daily Guidance",
    "#h-voz": "5. Local Voice and Speech Service Status",
    "#h-multi-vitals": "Quick check-in: vital signs",
    "#dc-voice-start-btn": "Start guided voice check-in (Q1–Q5)",
    "#dc-voice-ptt-btn": "Hold to answer",
    "#dc-voice-tts-btn": "Listen to question",
    "#dc-voice-skip-btn": "Skip question",
    "#dc-voice-cancel-btn": "Cancel voice check-in",
    "#dc-voice-confirm-btn": "Confirm answer and continue",
    "#dc-voice-retry-btn": "Discard draft",
    "#dc-submit-btn": "Confirm and connect to readings",
    "#dc-revoke-btn": "Revoke and clear context",
    "#mv-submit": "Check readings and show guidance",
    "#chat-form h3": "Ask the copilot",
    "#chat-form label[for='chat-profile']": "Simulated profile (isolated)",
    "#chat-form label[for='chat-system']": "Body system (informational view)",
    "#chat-form button[type='submit']": "Ask copilot",
    "#daily-context-form label[for='dc-profile']": "Simulated profile",
    "#daily-context-form label[for='dc-sleep']": "Q1. Sleep / rest",
    "#daily-context-form label[for='dc-activity']": "Q2. Recent activity (last hour)",
    "#daily-context-form label[for='dc-routine']": "Q4. Change from usual routine",
    "#daily-context-form label[for='dc-symptoms-text']": "Q3. Current symptoms or discomfort (optional)",
    "#multi-vitals-form label[for='mv-heart-rate']": "Heart rate (bpm)",
    "#multi-vitals-form label[for='mv-profile']": "Simulated profile (must match the daily check-in)",
    "#multi-vitals-form label[for='mv-respiratory-rate']": "Breaths per minute",
    "#multi-vitals-form label[for='mv-systolic']": "Systolic blood pressure (mmHg)",
    "#multi-vitals-form label[for='mv-diastolic']": "Diastolic blood pressure (mmHg)",
    "#multi-vitals-form label[for='mv-spo2']": "Oxygen saturation (SpO₂, %)",
    "#multi-vitals-form label[for='mv-temperature']": "Temperature (°C)",
    "#multi-vitals-form label[for='mv-symptoms']": "Current symptoms (optional)",
    "#multi-vitals-form label[for='mv-hydration']": "Water intake recorded today (mL)",
    "#multi-vitals-form label[for='mv-muscle-strength']": "Muscle strength (% of personal baseline)",
    "#multi-vitals-form label[for='mv-bone-density']": "Bone density (% of personal baseline)",
    "#multi-vitals-form label[for='mv-bone-site']": "Bone measurement site",
    "#multi-vitals-form label[for='mv-radiation-dose']": "Accumulated radiation dose (mSv)",
    "#multi-vitals-form label[for='mv-radiation-limit']": "Mission-specific review limit (mSv)",
    "#multi-vitals-form legend": "Mission tracking (optional; not daily vital signs)",
    "#mv-mission-metrics-note": "Enter verified measurements only. Water intake does not measure body hydration; strength and DXA require comparable tests; radiation dose needs a personal dosimeter and the mission-assigned limit.",
    "#multi-vitals-form label[for='mv-bone-site'] + select option:first-child": "Select only when entering bone density",
    "#multi-vitals-form label[for='mv-bone-site'] + select option[value='hip_spine']": "Hip / spine",
    "#multi-vitals-form label[for='mv-bone-site'] + select option[value='femoral_neck']": "Femoral neck",
  };

  function applyStaticText() {
    document.documentElement.lang = current;
    const picker = document.getElementById("app-language");
    if (picker && picker.value !== current) picker.value = current;
    if (current !== "en") {
      for (const [element, value] of originalText) element.textContent = value;
      return;
    }
    text("h1", "AstroTwin Mission Health Console");
    text(".brand-eyebrow", "AstroTwin · Self-hosted prototype");
    text(".subtitle", "Mission check-in, health readings, daily guidance, and 3D integration.");
    text("a[href='#sec-resultados']", "ML results");
    text("a[href='#sec-catalogo']", "NASA catalog and labs");
    text("a[href='#sec-az3tro']", "Copilot and 3D");
    text("a[href='#sec-entrevista']", "Daily check-in and missions");
    text("a[href='#sec-vitales']", "Health readings");
    text("a[href='#sec-voz']", "Local voice");
    for (const [selector, value] of Object.entries(enText)) text(selector, value);
    text("#h-multi-vitals + p", "Enter readings from your devices. The demo compares general adult resting references. Recent activity and voice notes are used only after you confirm them.");
    text("#mv-symptoms + .hint", "Confirmed symptoms from the guided check-in are also reviewed for urgent warning signs.");
    text("#multi-vitals-form legend", enText["#multi-vitals-form legend"]);
    text("#mv-mission-metrics-note", enText["#mv-mission-metrics-note"]);
    text("#mv-bone-site option:first-child", enText["#multi-vitals-form label[for='mv-bone-site'] + select option:first-child"]);
    text("#mv-bone-site option[value='hip_spine']", enText["#multi-vitals-form label[for='mv-bone-site'] + select option[value='hip_spine']"]);
    text("#mv-bone-site option[value='femoral_neck']", enText["#multi-vitals-form label[for='mv-bone-site'] + select option[value='femoral_neck']"]);
    text("#multi-vitals-output .state-box", "Enter one or more values to begin.");
    text("#dc-voice-panel .btn-row:first-child .hint", "You can answer by voice or skip any question.");
  }

  function set(language) {
    current = supported.has(language) ? language : "es";
    localStorage.setItem(KEY, current);
    applyStaticText();
    window.dispatchEvent(new CustomEvent("astrotwin:language-changed", { detail: { language: current } }));
  }

  window.AstroTwinLocale = {
    get: () => current,
    t,
    set,
    applyStaticText,
  };

  document.addEventListener("DOMContentLoaded", () => {
    applyStaticText();
    document.getElementById("app-language")?.addEventListener("change", (event) => set(event.target.value));
  });
})();
