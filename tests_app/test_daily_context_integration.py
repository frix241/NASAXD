"""Pruebas enfocadas para contexto diario por voz/texto, TTL, aislamiento y política de vitales."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.config import AppSettings
from app.daily_context import (
    DAILY_CONTEXT_STORE,
    DailyContextConsent,
    DailyContextStore,
    DailyContextSubmission,
    DeclaredConditionInput,
    RecentActivityInput,
    RoutineChangeInput,
    SleepRestInput,
    SymptomsInput,
)
from app.llm_adapter import LocalLLMAdapter
from app.main import create_app
from app.safety import is_emergency


def _settings(tmp_path: Path) -> AppSettings:
    project_root = Path("/home/bunuelo/Descargas/AstroTwin_")
    results_dir = tmp_path / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    return AppSettings(
        project_root=project_root,
        data_root=Path("/home/bunuelo/Descargas/AstroTwin_datos"),
        results_dir=results_dir,
        prompts_dir=project_root / "prompts",
        web_dir=project_root / "web",
        llm_provider="ollama",
        llm_base_url="http://mock-ollama:11434",
        llm_model="gemma3:1b",
        llm_timeout_seconds=1.0,
        stt_provider="wyoming-whisper",
        stt_url="http://127.0.0.1:59998",
        tts_provider="wyoming-piper",
        tts_url="http://127.0.0.1:59997",
        voice_timeout_seconds=0.2,
    )


def _cleanup_profile(profile_id: str) -> None:
    DAILY_CONTEXT_STORE.revoke(profile_id)


def test_unconfirmed_or_unconsented_context_is_not_stored(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C099-sim"
    _cleanup_profile(pid)

    r1 = client.post(
        "/api/interview/daily-context",
        json={
            "profile_id": pid,
            "transcript_confirmed_by_user": False,
            "consent": {"session_context_consent": True},
        },
    )
    assert r1.status_code == 422

    r2 = client.post(
        "/api/interview/daily-context",
        json={
            "profile_id": pid,
            "transcript_confirmed_by_user": True,
            "consent": {"session_context_consent": False},
        },
    )
    assert r2.status_code == 422
    assert client.get(f"/api/interview/daily-context/{pid}").json()["status"] == "missing_or_expired"


def test_skips_are_safe_and_do_not_block_vitals(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C098-sim"
    _cleanup_profile(pid)
    try:
        resp = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "capture_mode": "voice_ptt_confirmed",
                "transcript_confirmed_by_user": True,
                "consent": {
                    "session_context_consent": True,
                    "declared_condition_consent": False,
                    "persist_confirmed_transcripts": False,
                },
                "sleep_rest": {"status": "skipped"},
                "recent_activity": {"status": "skipped"},
                "symptoms": {"status": "skipped"},
                "routine_change": {"status": "skipped"},
                "declared_condition": {"status": "skipped"},
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "stored"
        assert body["record"]["audio_persisted"] is False
        assert body["record"]["transcripts_persisted"] is False
        assert body["record"]["sleep_rest"]["status"] == "skipped"
        assert body["record"]["recent_activity"]["status"] == "skipped"

        v_resp = client.post(
            "/api/vitals/analyze",
            json={"profile_id": pid, "preset_id": "nominal_rest"},
        )
        assert v_resp.status_code == 200
        v_body = v_resp.json()
        assert v_body["evaluation"]["status"] == "nominal"
        assert v_body["mission_adaptation"]["policy_action"] == "unchanged"
        assert v_body["daily_context_applied"]["recent_activity_status"] == "skipped"
    finally:
        _cleanup_profile(pid)


def test_declared_condition_requires_consent_and_never_reaches_llm_or_vitals(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    captured_prompts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            captured_prompts.append(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "message": {
                        "content": json.dumps(
                            {
                                "answer": "Estado operativo simulado revisado sin emitir diagnóstico.",
                                "citations": ["sim-profile-C001"],
                                "proposed_actions": [],
                                "safety_note": "Prototipo educativo no clínico.",
                            }
                        )
                    }
                },
            )
        return httpx.Response(404)

    adapter = LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))
    pid = "C001-sim"
    _cleanup_profile(pid)
    try:
        with patch("app.main.LocalLLMAdapter", return_value=adapter):
            client = TestClient(create_app(cfg))
            # 1) Sin consentimiento para condición: se descarta
            r_no = client.post(
                "/api/interview/daily-context",
                json={
                    "profile_id": pid,
                    "transcript_confirmed_by_user": True,
                    "consent": {
                        "session_context_consent": True,
                        "declared_condition_consent": False,
                    },
                    "declared_condition": {
                        "status": "answered",
                        "note": "SECRETO_MEDICO_NO_CONSENTIDO",
                        "medication_note": "MED_NO_CONSENTIDA",
                    },
                },
            )
            assert r_no.status_code == 200
            assert r_no.json()["record"]["declared_condition"]["note"] is None
            assert r_no.json()["record"]["declared_condition"]["status"] == "skipped"

            # 2) Con consentimiento explícito: se guarda en memoria, pero NUNCA va al LLM ni a vitales
            r_yes = client.post(
                "/api/interview/daily-context",
                json={
                    "profile_id": pid,
                    "transcript_confirmed_by_user": True,
                    "consent": {
                        "session_context_consent": True,
                        "declared_condition_consent": True,
                    },
                    "sleep_rest": {"status": "answered", "value": "good"},
                    "recent_activity": {"status": "answered", "value": "rest"},
                    "declared_condition": {
                        "status": "answered",
                        "note": "CONDICION_PRIVADA_DEMO",
                        "medication_note": "MEDICACION_PRIVADA_DEMO",
                    },
                },
            )
            assert r_yes.status_code == 200
            stored_rec = DAILY_CONTEXT_STORE.get(pid)
            assert stored_rec is not None
            assert stored_rec.declared_condition.note == "CONDICION_PRIVADA_DEMO"
            assert r_yes.json()["record"]["declared_condition"]["redacted"] is True
            assert "CONDICION_PRIVADA_DEMO" not in r_yes.text
            assert "MEDICACION_PRIVADA_DEMO" not in r_yes.text
            assert "CONDICION_PRIVADA_DEMO" not in json.dumps(r_yes.json()["llm_safe_context"])

            chat_resp = client.post(
                "/api/chat",
                json={"profile_id": pid, "message": "Resume el estado operativo actual", "use_llm": True},
            )
            assert chat_resp.status_code == 200
            assert captured_prompts
            assert "CONDICION_PRIVADA_DEMO" not in captured_prompts[0]
            assert "MEDICACION_PRIVADA_DEMO" not in captured_prompts[0]

            vitals_resp = client.post(
                "/api/vitals/analyze",
                json={"profile_id": pid, "preset_id": "nominal_rest"},
            )
            assert vitals_resp.status_code == 200
            assert "CONDICION_PRIVADA_DEMO" not in json.dumps(vitals_resp.json())
            assert "MEDICACION_PRIVADA_DEMO" not in json.dumps(vitals_resp.json())
    finally:
        _cleanup_profile(pid)


def test_real_in_memory_ttl_and_revoke_behavior(tmp_path: Path) -> None:
    clock = [datetime(2026, 11, 15, 8, 0, 0, tzinfo=timezone.utc)]
    store = DailyContextStore(now_fn=lambda: clock[0])
    sub = DailyContextSubmission(
        profile_id="C097-sim",
        transcript_confirmed_by_user=True,
        consent=DailyContextConsent(
            session_context_consent=True,
            declared_condition_consent=True,
            persist_confirmed_transcripts=False,
        ),
        sleep_rest=SleepRestInput(status="answered", value="good", confirmed_text="Dormi bien"),
        recent_activity=RecentActivityInput(status="answered", value="rest"),
        symptoms=SymptomsInput(status="answered", reported_none=True, confirmed_text="Sin sintomas"),
        routine_change=RoutineChangeInput(status="answered", value="none"),
        declared_condition=DeclaredConditionInput(status="answered", note="Nota temporal"),
        ttl_seconds=3600,
        activity_ttl_seconds=600,
    )
    rec = store.store(sub)
    assert rec.sleep_rest.confirmed_text is None  # no persiste texto si persist_confirmed_transcripts=False
    assert store.get("C097-sim") is not None

    # Avanza 15 min (> activity_ttl 10 min, < ttl 60 min)
    clock[0] = clock[0] + timedelta(minutes=15)
    view = store.get_vitals_view("C097-sim")
    assert view is not None
    assert view.recent_activity_expired is True
    assert view.recent_activity_status == "expired"
    assert view.recent_activity_value is None

    # Avanza > 60 min: el registro entero se purga realmente de memoria
    clock[0] = clock[0] + timedelta(minutes=50)
    assert store.get("C097-sim") is None
    assert "C097-sim" not in store._records

    # Prueba endpoint DELETE y POST revoke
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C096-sim"
    _cleanup_profile(pid)
    client.post(
        "/api/interview/daily-context",
        json={
            "profile_id": pid,
            "transcript_confirmed_by_user": True,
            "consent": {"session_context_consent": True},
            "recent_activity": {"status": "answered", "value": "rest"},
        },
    )
    del_resp = client.delete(f"/api/interview/context/{pid}")
    assert del_resp.status_code == 200
    assert del_resp.json()["revoked"] is True
    assert client.get(f"/api/interview/daily-context/{pid}").json()["status"] == "missing_or_expired"


def test_activity_rest_mismatch_requests_remeasure_and_resolves_on_confirmed_rest(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C095-sim"
    _cleanup_profile(pid)
    try:
        # Usuario reporta actividad física reciente
        ctx_resp = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "transcript_confirmed_by_user": True,
                "consent": {"session_context_consent": True},
                "recent_activity": {"status": "answered", "value": "activity"},
            },
        )
        assert ctx_resp.status_code == 200

        # Llega lectura etiquetada como "rest" con desviación sostenida: NO debe comparar ni degradar misiones
        v_resp = client.post(
            "/api/vitals/analyze",
            json={"profile_id": pid, "preset_id": "sustained_rest_deviation"},
        )
        assert v_resp.status_code == 200
        v_body = v_resp.json()
        assert v_body["daily_context_applied"]["context_mismatch"] is True
        assert v_body["quality_summary"]["suspect_quality"] is True
        assert v_body["quality_summary"]["remeasurement_requested"] is True
        assert v_body["mission_adaptation"]["policy_action"] == "remeasure"
        assert v_body["mission_adaptation"]["matched_policy_id"] == "P2_UNCERTAIN_SIGNAL_REMEASURE"
        assert v_body["zone_highlight"]["severity"] == "insufficient_data"

        # Usuario confirma reposo y remide
        remeasure_resp = client.post(
            "/api/vitals/remeasure",
            json={
                "profile_id": pid,
                "target_context": "rest",
                "prior_samples": [
                    {"value_bpm": 70.0, "context": "rest", "quality": "good", "signal_quality_score": 0.95, "measurement_confirmed": True},
                    {"value_bpm": 71.0, "context": "rest", "quality": "good", "signal_quality_score": 0.95, "measurement_confirmed": True},
                    {"value_bpm": 69.0, "context": "rest", "quality": "good", "signal_quality_score": 0.95, "measurement_confirmed": True},
                    {"value_bpm": 70.0, "context": "rest", "quality": "good", "signal_quality_score": 0.95, "measurement_confirmed": True},
                    {"value_bpm": 70.0, "context": "rest", "quality": "good", "signal_quality_score": 0.95, "measurement_confirmed": True},
                ],
                "use_clean_demo_reading": True,
                "confirmed_rest_for_remeasure": True,
            },
        )
        assert remeasure_resp.status_code == 200
        r_body = remeasure_resp.json()
        assert r_body["daily_context_applied"]["context_mismatch"] is False
        assert r_body["daily_context_applied"]["recent_activity_value"] == "rest"
        assert r_body["evaluation"]["status"] == "nominal"
        assert r_body["mission_adaptation"]["policy_action"] == "unchanged"
    finally:
        _cleanup_profile(pid)


def test_urgent_symptom_bypass_and_negation_scrutiny(tmp_path: Path) -> None:
    # Negaciones explícitas no deben disparar emergencia
    assert not is_emergency("No tengo dolor en el pecho ni falta de aire, sin convulsiones.")
    assert not is_emergency("Niego opresión torácica, no estoy inconsciente ni tengo hemorragia.")
    # Cláusula mixta: leve en otro sitio + opresión en el pecho sí dispara emergencia
    assert is_emergency("Dolor leve en el brazo, opresión fuerte en el pecho.")

    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C094-sim"
    _cleanup_profile(pid)
    try:
        # Contradicción: marca reported_none=True pero el texto confirmado tiene bandera roja
        ctx_resp = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "transcript_confirmed_by_user": True,
                "consent": {"session_context_consent": True},
                "symptoms": {
                    "status": "answered",
                    "reported_none": True,
                    "confirmed_text": "Opresión en el pecho y me cuesta respirar",
                },
            },
        )
        assert ctx_resp.status_code == 200
        c_body = ctx_resp.json()
        assert c_body["status"] == "emergency_escalation"
        assert c_body["emergency_bypass"] is True
        assert c_body["model_consulted"] is False
        assert c_body["policy_action"] == "stop_and_contact_medical"

        # Incluso con señal de mala calidad, P1 (síntoma urgente) tiene prioridad absoluta
        v_resp = client.post(
            "/api/vitals/analyze",
            json={"profile_id": pid, "preset_id": "suspect_quality_sleep"},
        )
        assert v_resp.status_code == 200
        v_body = v_resp.json()
        assert v_body["mission_adaptation"]["policy_action"] == "stop_and_contact_medical"
        assert v_body["mission_adaptation"]["matched_policy_id"] == "P1_URGENT_SYMPTOM_STOP_AND_CONTACT_MEDICAL"
        assert v_body["zone_highlight"]["severity"] == "priority"
    finally:
        _cleanup_profile(pid)


def test_daily_context_active_non_red_flag_is_not_emergency_escalation(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C092-sim"
    _cleanup_profile(pid)
    try:
        saved = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "transcript_confirmed_by_user": True,
                "consent": {"session_context_consent": True},
                "symptoms": {
                    "status": "answered",
                    "confirmed_text": "Tengo mareos leves y palpitaciones.",
                },
            },
        )
        assert saved.status_code == 200
        assert saved.json()["record"]["symptoms"]["has_active_symptoms"] is True
        assert saved.json()["record"]["symptoms"]["urgent_red_flag"] is False

        vital = client.post(
            "/api/vitals/analyze",
            json={"profile_id": pid, "preset_id": "nominal_rest"},
        )
        assert vital.status_code == 200
        body = vital.json()
        assert body["daily_context_applied"]["has_active_symptoms"] is True
        assert body["daily_context_applied"]["urgent_red_flag"] is False
        assert body["mission_adaptation"]["policy_action"] == "unchanged"
        assert body["mission_adaptation"]["contact_medical_team"] is False
        assert body["zone_highlight"]["severity"] == "attention"
        assert body["zone_highlight"]["zone"] == "systemic"
    finally:
        _cleanup_profile(pid)


def test_reported_poor_sleep_proposes_confirmable_lighter_demo_missions(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C091-sim"
    _cleanup_profile(pid)
    try:
        saved = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "transcript_confirmed_by_user": True,
                "consent": {"session_context_consent": True},
                "sleep_rest": {"status": "answered", "value": "poor"},
                "recent_activity": {"status": "answered", "value": "rest"},
            },
        )
        assert saved.status_code == 200

        vital = client.post(
            "/api/vitals/analyze",
            json={"profile_id": pid, "preset_id": "nominal_rest"},
        )
        assert vital.status_code == 200
        adaptation = vital.json()["mission_adaptation"]
        assert adaptation["rule_applied"] == "poor_sleep_context_lighten_demo_mission"
        assert adaptation["requires_confirmation"] is True
        assert adaptation["prescribes_recovery"] is False
        assert adaptation["audit_entry"]["is_clinical_diagnosis"] is False
        assert all(
            mission["intensity"] == "low"
            for mission in adaptation["adapted_missions"]
            if mission["mission_id"] in {"ergometer_cycle", "core_mobility"}
        )
        assert all(
            not mission["confirmed"]
            for mission in adaptation["adapted_missions"]
            if mission["mission_id"] in {"ergometer_cycle", "core_mobility"}
        )
    finally:
        _cleanup_profile(pid)


def test_major_routine_change_adds_only_a_confirmable_schedule_review(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C090-sim"
    _cleanup_profile(pid)
    try:
        saved = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "transcript_confirmed_by_user": True,
                "consent": {"session_context_consent": True},
                "routine_change": {"status": "answered", "value": "major_change"},
            },
        )
        assert saved.status_code == 200

        vital = client.post(
            "/api/vitals/analyze",
            json={"profile_id": pid, "preset_id": "nominal_rest"},
        )
        assert vital.status_code == 200
        adaptation = vital.json()["mission_adaptation"]
        assert adaptation["rule_applied"] == "major_routine_change_review"
        review = next(
            mission for mission in adaptation["adapted_missions"]
            if mission["mission_id"] == "review_routine_change"
        )
        assert review["status"] == "context_review_added"
        assert review["requires_confirmation"] is True
        for mission in adaptation["adapted_missions"]:
            if mission["mission_id"] in {"ergometer_cycle", "core_mobility"}:
                original = next(
                    item for item in adaptation["original_missions"]
                    if item["mission_id"] == mission["mission_id"]
                )
                assert mission["intensity"] == original["intensity"]
                assert mission["duration_min"] == original["duration_min"]
    finally:
        _cleanup_profile(pid)


def test_ambiguous_recent_activity_in_rest_requests_remeasure(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C093-sim"
    _cleanup_profile(pid)
    try:
        ctx_resp = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "transcript_confirmed_by_user": True,
                "consent": {"session_context_consent": True},
                "recent_activity": {"status": "ambiguous", "value": None},
            },
        )
        assert ctx_resp.status_code == 200
        v_resp = client.post(
            "/api/vitals/analyze",
            json={"profile_id": pid, "preset_id": "nominal_rest"},
        )
        assert v_resp.status_code == 200
        v_body = v_resp.json()
        assert v_body["daily_context_applied"]["context_uncertain"] is True
        assert v_body["quality_summary"]["remeasurement_requested"] is True
        assert v_body["mission_adaptation"]["policy_action"] == "remeasure"
    finally:
        _cleanup_profile(pid)


def test_security_strict_schema_rejects_extra_fields_and_invalid_profile_id(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))

    # extra="forbid" debe rechazar campos no declarados en daily-context y revoke
    r_extra = client.post(
        "/api/interview/daily-context",
        json={
            "profile_id": "C001-sim",
            "transcript_confirmed_by_user": True,
            "consent": {"session_context_consent": True},
            "unexpected_admin_flag": True,
        },
    )
    assert r_extra.status_code == 422

    r_revoke_extra = client.post(
        "/api/interview/context/revoke",
        json={"profile_id": "C001-sim", "force_all": True},
    )
    assert r_revoke_extra.status_code == 422

    # profile_id con caracteres fuera de [A-Za-z0-9_-] debe rechazarse
    r_bad_pid = client.post(
        "/api/interview/daily-context",
        json={
            "profile_id": "../admin",
            "transcript_confirmed_by_user": True,
            "consent": {"session_context_consent": True},
        },
    )
    assert r_bad_pid.status_code == 422

    r_bad_del = client.delete("/api/interview/context/bad%20id!")
    assert r_bad_del.status_code == 422


def test_security_daily_context_store_caps_memory_records() -> None:
    store = DailyContextStore(max_records=3)
    for idx in range(5):
        store.store(
            DailyContextSubmission(
                profile_id=f"C10{idx}-sim",
                transcript_confirmed_by_user=True,
                consent=DailyContextConsent(session_context_consent=True),
            )
        )
    assert len(store._records) == 3
    assert store.get("C100-sim") is None
    assert store.get("C104-sim") is not None


def test_security_frontend_uses_safe_dom_and_no_storage_for_daily_context() -> None:
    root = Path("/home/bunuelo/Descargas/AstroTwin_")
    app_js = (root / "web" / "app.js").read_text(encoding="utf-8")
    vitals_js = (root / "web" / "vitals_panel.js").read_text(encoding="utf-8")

    assert "localStorage" not in app_js and "sessionStorage" not in app_js
    assert "localStorage" not in vitals_js and "sessionStorage" not in vitals_js

    # initDailyContextForm debe renderizar mediante textContent/createElement, no innerHTML
    dc_section = app_js.split("function initDailyContextForm()", 1)[1]
    assert "innerHTML" not in dc_section
    assert "textContent" in dc_section

    # vitals-daily-context-banner debe poblarse con textContent/DOM seguro
    assert "dailyCtxHtml" not in vitals_js
    assert "vitals-daily-context-banner" in vitals_js


def test_security_api_responses_redact_declared_condition_and_medication(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    pid = "C092-sim"
    _cleanup_profile(pid)
    try:
        post_resp = client.post(
            "/api/interview/daily-context",
            json={
                "profile_id": pid,
                "transcript_confirmed_by_user": True,
                "consent": {
                    "session_context_consent": True,
                    "declared_condition_consent": True,
                },
                "declared_condition": {
                    "status": "answered",
                    "note": "CONDICION_SENSIBLE_NO_EXPONER",
                    "medication_note": "MEDICACION_SENSIBLE_NO_EXPONER",
                },
            },
        )
        assert post_resp.status_code == 200
        assert "CONDICION_SENSIBLE_NO_EXPONER" not in post_resp.text
        assert "MEDICACION_SENSIBLE_NO_EXPONER" not in post_resp.text

        get_resp = client.get(f"/api/interview/daily-context/{pid}")
        assert get_resp.status_code == 200
        assert "CONDICION_SENSIBLE_NO_EXPONER" not in get_resp.text
        assert "MEDICACION_SENSIBLE_NO_EXPONER" not in get_resp.text
    finally:
        _cleanup_profile(pid)


def _extract_bounded_context_from_ollama_request(raw_body: str) -> dict:
    payload = json.loads(raw_body)
    user_msg = payload["messages"][1]["content"]
    prefix = "Contexto aislado:\n"
    marker = "\n\nPregunta del usuario:\n"
    start = user_msg.index(prefix) + len(prefix)
    end = user_msg.index(marker)
    return json.loads(user_msg[start:end])


def test_chat_passes_bounded_daily_context_when_consented_and_omits_transcripts(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    captured_requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            captured_requests.append(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "message": {
                        "content": json.dumps(
                            {
                                "answer": "Según el contexto diario simulado (sueño pobre, sin síntomas urgentes), se sugiere reducir intensidad sujeto a confirmación.",
                                "citations": ["sim-profile-C001"],
                                "proposed_actions": [
                                    {
                                        "action": "reduce_mission_intensity",
                                        "label": "Reducir intensidad operativa de la misión",
                                        "requires_confirmation": True,
                                    }
                                ],
                                "safety_note": "Prototipo educativo y operativo. No emite diagnósticos médicos.",
                            }
                        )
                    }
                },
            )
        return httpx.Response(404)

    pid = "C001-sim"
    _cleanup_profile(pid)
    try:
        adapter = LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))
        with patch("app.main.LocalLLMAdapter", return_value=adapter):
            client = TestClient(create_app(cfg))
            saved = client.post(
                "/api/interview/daily-context",
                json={
                    "profile_id": pid,
                    "capture_mode": "voice_ptt_confirmed",
                    "transcript_confirmed_by_user": True,
                    "consent": {
                        "session_context_consent": True,
                        "declared_condition_consent": True,
                        "persist_confirmed_transcripts": True,
                    },
                    "sleep_rest": {
                        "status": "answered",
                        "value": "poor",
                        "hours": 5.0,
                        "confirmed_text": "TRANSCRIPCION_CRUDA_SUENO_PRIVADA",
                    },
                    "recent_activity": {
                        "status": "answered",
                        "value": "activity",
                        "confirmed_text": "TRANSCRIPCION_CRUDA_ACTIVIDAD",
                    },
                    "symptoms": {
                        "status": "answered",
                        "reported_none": True,
                        "confirmed_text": "Sin síntomas relevantes",
                    },
                    "routine_change": {"status": "skipped"},
                    "declared_condition": {
                        "status": "answered",
                        "note": "CONDICION_PRIVADA_NO_LLM",
                        "medication_note": "MEDICACION_PRIVADA_NO_LLM",
                    },
                },
            )
            assert saved.status_code == 200
            ctx_id = saved.json()["record"]["context_id"]

            chat_resp = client.post(
                "/api/chat",
                json={
                    "profile_id": pid,
                    "message": "¿Cómo interpreto el contexto matutino y las señales simuladas?",
                    "use_llm": True,
                },
            )
            assert chat_resp.status_code == 200
            body = chat_resp.json()
            assert body["provenance"]["mode"] == "llm"
            assert body["provenance"]["llm_available"] is True
            assert len(captured_requests) == 1

            raw_sent = captured_requests[0]
            assert "TRANSCRIPCION_CRUDA_SUENO_PRIVADA" not in raw_sent
            assert "TRANSCRIPCION_CRUDA_ACTIVIDAD" not in raw_sent
            assert "CONDICION_PRIVADA_NO_LLM" not in raw_sent
            assert "MEDICACION_PRIVADA_NO_LLM" not in raw_sent
            assert "confirmed_text" not in raw_sent
            assert "declared_condition" not in raw_sent

            bounded = _extract_bounded_context_from_ollama_request(raw_sent)
            assert "daily_context" in bounded
            dc = bounded["daily_context"]
            assert dc["context_id"] == ctx_id
            assert dc["sleep_rest"] == {"status": "answered", "value": "poor", "hours": 5.0}
            assert dc["recent_activity"] == {"status": "answered", "value": "activity"}
            assert dc["symptoms"]["status"] == "answered"
            assert dc["symptoms"]["has_active_symptoms"] is False
            assert dc["symptoms"]["urgent_red_flag"] is False
            assert dc["routine_change"] == {"status": "skipped", "value": None}
            assert ctx_id in bounded["allowed_citations"]
    finally:
        _cleanup_profile(pid)


def test_chat_omits_daily_context_when_missing_revoked_or_expired(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    captured_requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            captured_requests.append(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "message": {
                        "content": json.dumps(
                            {
                                "answer": "Señales simuladas revisadas sin contexto diario activo.",
                                "citations": ["sim-profile-C001"],
                                "proposed_actions": [],
                                "safety_note": "Prototipo educativo y operativo. No emite diagnósticos médicos.",
                            }
                        )
                    }
                },
            )
        return httpx.Response(404)

    pid = "C001-sim"
    _cleanup_profile(pid)
    try:
        adapter = LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))
        with patch("app.main.LocalLLMAdapter", return_value=adapter):
            client = TestClient(create_app(cfg))

            # 1) Missing
            r_missing = client.post(
                "/api/chat",
                json={"profile_id": pid, "message": "Estado operativo", "use_llm": True},
            )
            assert r_missing.status_code == 200
            bounded_missing = _extract_bounded_context_from_ollama_request(captured_requests[-1])
            assert "daily_context" not in bounded_missing

            # 2) Store then revoke
            client.post(
                "/api/interview/daily-context",
                json={
                    "profile_id": pid,
                    "transcript_confirmed_by_user": True,
                    "consent": {"session_context_consent": True},
                    "sleep_rest": {"status": "answered", "value": "fair"},
                },
            )
            rev = client.post("/api/interview/context/revoke", json={"profile_id": pid})
            assert rev.status_code == 200 and rev.json()["revoked"] is True

            r_revoked = client.post(
                "/api/chat",
                json={"profile_id": pid, "message": "Estado operativo", "use_llm": True},
            )
            assert r_revoked.status_code == 200
            bounded_revoked = _extract_bounded_context_from_ollama_request(captured_requests[-1])
            assert "daily_context" not in bounded_revoked

        # 3) Expired (using controllable clock on DailyContextStore)
        clock = {"now": datetime(2026, 11, 15, 8, 0, tzinfo=timezone.utc)}
        expiring_store = DailyContextStore(now_fn=lambda: clock["now"])
        expiring_store.store(
            DailyContextSubmission(
                profile_id=pid,
                transcript_confirmed_by_user=True,
                consent=DailyContextConsent(session_context_consent=True),
                sleep_rest=SleepRestInput(status="answered", value="good"),
                recent_activity=RecentActivityInput(status="answered", value="activity"),
                ttl_seconds=120,
                activity_ttl_seconds=30,
            )
        )
        # Activity expires at +45s, record still active
        clock["now"] = clock["now"] + timedelta(seconds=45)
        with patch("app.main.DAILY_CONTEXT_STORE", expiring_store):
            adapter2 = LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))
            with patch("app.main.LocalLLMAdapter", return_value=adapter2):
                client2 = TestClient(create_app(cfg))
                r_act_exp = client2.post(
                    "/api/chat",
                    json={"profile_id": pid, "message": "Estado operativo", "use_llm": True},
                )
                assert r_act_exp.status_code == 200
                bounded_act_exp = _extract_bounded_context_from_ollama_request(captured_requests[-1])
                assert bounded_act_exp["daily_context"]["recent_activity"] == {
                    "status": "expired",
                    "value": None,
                }

                # Full record expires at +121s
                clock["now"] = clock["now"] + timedelta(seconds=80)
                r_full_exp = client2.post(
                    "/api/chat",
                    json={"profile_id": pid, "message": "Estado operativo", "use_llm": True},
                )
                assert r_full_exp.status_code == 200
                bounded_full_exp = _extract_bounded_context_from_ollama_request(captured_requests[-1])
                assert "daily_context" not in bounded_full_exp
    finally:
        _cleanup_profile(pid)


def test_chat_emergency_bypasses_model_and_never_sends_daily_context(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    calls = {"chat": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/chat":
            calls["chat"] += 1
        return httpx.Response(500)

    pid = "C001-sim"
    _cleanup_profile(pid)
    try:
        adapter = LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))
        with patch("app.main.LocalLLMAdapter", return_value=adapter):
            client = TestClient(create_app(cfg))
            # 1) Normal consented daily context, but emergency user message
            client.post(
                "/api/interview/daily-context",
                json={
                    "profile_id": pid,
                    "transcript_confirmed_by_user": True,
                    "consent": {"session_context_consent": True},
                    "sleep_rest": {"status": "answered", "value": "good"},
                },
            )
            r_emerg_msg = client.post(
                "/api/chat",
                json={"profile_id": pid, "message": "Tengo dolor fuerte en el pecho", "use_llm": True},
            )
            assert r_emerg_msg.status_code == 200
            b1 = r_emerg_msg.json()
            assert calls["chat"] == 0
            assert b1["provenance"]["mode"] == "rules_only"
            assert b1["provenance"]["safety_audit"]["emergency_bypass"] is True
            assert b1["provenance"]["safety_audit"]["model_consulted"] is False

            # 2) Urgent red flag inside daily_context itself, with benign user message
            client.post(
                "/api/interview/daily-context",
                json={
                    "profile_id": pid,
                    "transcript_confirmed_by_user": True,
                    "consent": {"session_context_consent": True},
                    "symptoms": {
                        "status": "answered",
                        "confirmed_text": "No puedo respirar bien desde hace minutos",
                    },
                },
            )
            r_emerg_ctx = client.post(
                "/api/chat",
                json={"profile_id": pid, "message": "Resume mi estado operativo", "use_llm": True},
            )
            assert r_emerg_ctx.status_code == 200
            b2 = r_emerg_ctx.json()
            assert calls["chat"] == 0
            assert b2["provenance"]["mode"] == "rules_only"
            assert b2["provenance"]["safety_audit"]["emergency_bypass"] is True
            assert b2["provenance"]["safety_audit"]["model_consulted"] is False
    finally:
        _cleanup_profile(pid)


def test_chat_rejects_dehydration_inference_but_allows_negation_and_normalizes_action_label(
    tmp_path: Path,
) -> None:
    cfg = _settings(tmp_path)
    ctx = {
        "profile_id": "C001-sim",
        "namespace": "simulation_synthetic",
        "status": "attention",
        "observations": [
            "Pulso simulado +14 bpm sobre línea base (88 vs 74 bpm, 3 muestras).",
            "Hidratación simulada registrada en 1200 mL (<70% de referencia 2000 mL).",
        ],
    }

    def _adapter_for(answer: str, actions: list[dict] | None = None) -> LocalLLMAdapter:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "message": {
                        "content": json.dumps(
                            {
                                "answer": answer,
                                "citations": ["sim-profile-C001"],
                                "proposed_actions": actions or [],
                                "safety_note": "Prototipo educativo y operativo. No emite diagnósticos médicos.",
                            }
                        )
                    }
                },
            )

        return LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))

    # 1) Speculative dehydration inference -> rejected
    p1, avail1, reason1, _ = _adapter_for(
        "La hidratación simulada está por debajo del 70% de referencia, lo que indica una posible deshidratación."
    ).generate_structured(
        "Resume el contexto",
        context_payload=ctx,
        allowed_actions=["log_hydration"],
        allowed_citations=["sim-profile-C001"],
    )
    assert p1 is None
    assert avail1 is False
    assert reason1 is not None and "filtro de seguridad" in reason1

    # 2) Affirmative dehydration inference -> rejected
    p2, avail2, reason2, _ = _adapter_for(
        "Tienes deshidratación leve según el pulso de 88 bpm."
    ).generate_structured(
        "Resume el contexto",
        context_payload=ctx,
        allowed_actions=["log_hydration"],
        allowed_citations=["sim-profile-C001"],
    )
    assert p2 is None
    assert avail2 is False
    assert reason2 is not None and "filtro de seguridad" in reason2

    # 3) Negated statement ("no se puede inferir deshidratación") -> allowed
    #    and raw action ID label normalized to Spanish
    p3, avail3, reason3, _ = _adapter_for(
        "La ingesta simulada es 1200 mL, pero no se puede inferir deshidratación ni emitir diagnóstico.",
        actions=[
            {
                "action": "record_observation",
                "label": "record_observation",
                "requires_confirmation": False,
            }
        ],
    ).generate_structured(
        "Resume el contexto",
        context_payload=ctx,
        allowed_actions=["record_observation"],
        allowed_citations=["sim-profile-C001"],
    )
    assert p3 is not None
    assert avail3 is True
    assert reason3 is None
    assert len(p3.proposed_actions) == 1
    assert p3.proposed_actions[0].action == "record_observation"
    assert p3.proposed_actions[0].label == "Registrar observación operativa (requiere confirmación)"
    assert p3.proposed_actions[0].requires_confirmation is True

    # 4) Raw action ID in answer text -> rejected
    p4, avail4, reason4, _ = _adapter_for(
        "Sugiero ejecutar record_observation para registrar el estado."
    ).generate_structured(
        "Resume el contexto",
        context_payload=ctx,
        allowed_actions=["record_observation"],
        allowed_citations=["sim-profile-C001"],
    )
    assert p4 is None
    assert avail4 is False
    assert reason4 is not None and "filtro de seguridad" in reason4


def test_action_labels_always_use_trusted_spanish_map_and_record_audit(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    ctx = {
        "profile_id": "C001-sim",
        "namespace": "simulation_synthetic",
        "status": "attention",
        "observations": ["Pulso simulado +14 bpm sobre línea base (88 vs 74 bpm, 3 muestras)."],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "message": {
                    "content": json.dumps(
                        {
                            "answer": "Pulso simulado 88 bpm observado respecto a línea base 74 bpm.",
                            "citations": ["sim-profile-C001"],
                            "proposed_actions": [
                                {
                                    "action": "log_hydration",
                                    "label": "Toma 400 mg de ibuprofeno por deshidratación",
                                    "requires_confirmation": False,
                                    "target_zone": "texto_arbitrario_no_permitido",
                                },
                                {
                                    "action": "record_observation",
                                    "label": "Recordar observación",
                                    "requires_confirmation": False,
                                },
                                {
                                    "action": "prescribe_drug",
                                    "label": "Administrar fármaco",
                                    "requires_confirmation": False,
                                },
                                {
                                    "action": "unmapped_custom_action",
                                    "label": "Etiqueta no mapeada",
                                    "requires_confirmation": False,
                                },
                            ],
                            "safety_note": "Prototipo educativo y operativo. No emite diagnósticos médicos.",
                        }
                    )
                }
            },
        )

    adapter = LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))
    payload, available, reason, _ = adapter.generate_structured(
        "¿Qué acciones operativas aplican?",
        context_payload=ctx,
        allowed_actions=["log_hydration", "record_observation", "unmapped_custom_action"],
        allowed_citations=["sim-profile-C001"],
    )
    assert available is False
    assert reason is not None and "citas o acciones" in reason.lower()
    assert payload is None

    assert adapter.last_safety_audit["normalized_action_labels"] == [
        "log_hydration",
        "record_observation",
    ]
    assert adapter.last_safety_audit["dropped_actions"] == [
        "prescribe_drug",
        "unmapped_custom_action",
    ]
