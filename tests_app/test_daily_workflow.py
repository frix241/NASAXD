"""Pruebas enfocadas para POST /api/daily-checkin (flujo diario unificado)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import AppSettings
from app.daily_context import DAILY_CONTEXT_STORE
from app.main import create_app


def _settings(tmp_path: Path) -> AppSettings:
    project_root = Path(__file__).resolve().parent.parent
    results_dir = tmp_path / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    data_root = tmp_path / "data"
    data_root.mkdir(parents=True, exist_ok=True)
    return AppSettings(
        project_root=project_root,
        data_root=data_root,
        results_dir=results_dir,
        prompts_dir=project_root / "prompts",
        web_dir=project_root / "web",
        llm_provider="ollama",
        llm_base_url="http://127.0.0.1:1",
        llm_model="gemma3:1b",
        llm_timeout_seconds=0.2,
        stt_provider="whisper.cpp",
        stt_url="http://127.0.0.1:1",
        tts_provider="sherpa-onnx",
        tts_url="http://127.0.0.1:1",
        voice_timeout_seconds=0.2,
    )


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(_settings(tmp_path)))


def _good_samples(values: list[float], context: str = "rest") -> list[dict[str, object]]:
    return [
        {
            "value_bpm": v,
            "context": context,
            "quality": "good",
            "signal_quality_score": 0.95,
            "measurement_confirmed": True,
            "source": "sim_sensor_explicit",
        }
        for v in values
    ]


def test_daily_checkin_normal_flow_and_confirmation(client: TestClient) -> None:
    pid = "C070-sim"
    DAILY_CONTEXT_STORE.revoke(pid)
    resp = client.post(
        "/api/daily-checkin",
        json={
            "profile_id": pid,
            "target_context": "rest",
            "samples": _good_samples([70.0, 71.0, 69.0, 72.0, 70.0, 71.0]),
            "use_llm": False,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["namespace"] == "simulation_synthetic"
    assert body["origin"] == "synthetic"
    assert body["real_vitals_mutated"] is False
    assert body["is_clinical_diagnosis"] is False
    assert body["prescribes_recovery"] is False
    assert body["abstained"] is False
    assert body["evaluation"]["status"] == "nominal"
    assert body["policy_action"] == "unchanged"
    assert body["llm_context_payload"]["policy_action"] == "unchanged"
    assert body["llm_context_payload"]["affected_zone"] == {
        "zone": body["zone_highlight"]["zone"],
        "system": body["zone_highlight"]["system"],
        "severity": body["zone_highlight"]["severity"],
        "title": body["zone_highlight"]["non_clinical_title"],
    }
    assert body["llm_context_payload"]["mission_plan"] == [
        {
            "mission_id": mission["mission_id"],
            "title": mission["title"],
            "duration_min": mission["duration_min"],
            "intensity": mission["intensity"],
            "status": mission["status"],
            "adjustment_reason": mission["adjustment_reason"],
        }
        for mission in body["proposed_missions"]
    ]
    assert body["requires_confirmation"] is True
    assert all(
        m["requires_confirmation"] is True and m["confirmed"] is False
        for m in body["proposed_missions"]
    )
    assert body["report"]["timestamp_utc"]
    datetime.fromisoformat(body["report"]["timestamp_utc"])
    assert "sim_sensor_explicit" in body["report"]["sources"]
    assert body["report"]["data_completeness"]["samples_provided"] == 6

    # Confirmación real reutilizando /api/vitals/missions/confirm sin duplicar almacén
    confirm = client.post(
        "/api/vitals/missions/confirm",
        json={"confirmation_token": body["confirmation_token"], "confirmed": True},
    )
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "confirmed"
    assert all(m["confirmed"] is True for m in confirm.json()["confirmed_missions"])


def test_daily_checkin_poor_sleep_fatigue_lightens_missions_pending_confirm(
    client: TestClient,
) -> None:
    pid = "C071-sim"
    DAILY_CONTEXT_STORE.revoke(pid)
    try:
        resp = client.post(
            "/api/daily-checkin",
            json={
                "profile_id": pid,
                "target_context": "rest",
                "samples": _good_samples([70.0, 71.0, 70.0, 72.0, 71.0, 70.0]),
                "daily_context": {
                    "profile_id": pid,
                    "transcript_confirmed_by_user": True,
                    "consent": {"session_context_consent": True},
                    "sleep_rest": {"status": "answered", "value": "poor"},
                    "recent_activity": {"status": "answered", "value": "rest"},
                },
                "use_llm": False,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["abstained"] is False
        assert body["policy_action"] == "lighten_demo_mission"
        assert body["llm_context_payload"]["policy_action"] == "lighten_demo_mission"
        assert body["llm_context_payload"]["mission_plan"] == [
            {
                "mission_id": mission["mission_id"],
                "title": mission["title"],
                "duration_min": mission["duration_min"],
                "intensity": mission["intensity"],
                "status": mission["status"],
                "adjustment_reason": mission["adjustment_reason"],
            }
            for mission in body["proposed_missions"]
        ]
        assert body["mission_adaptation"]["matched_policy_id"] == "P5_POOR_SLEEP_CONTEXT_LIGHTEN_DEMO"
        assert body["mission_adaptation"]["adjusted"] is True
        assert all(
            m["requires_confirmation"] is True and m["confirmed"] is False
            for m in body["proposed_missions"]
        )
        assert body["daily_context_applied"]["sleep_rest_value"] == "poor"
    finally:
        DAILY_CONTEXT_STORE.revoke(pid)


def test_daily_checkin_insufficient_baseline_abstains_without_inventing(
    client: TestClient,
) -> None:
    pid = "C072-sim"
    DAILY_CONTEXT_STORE.revoke(pid)
    resp = client.post(
        "/api/daily-checkin",
        json={
            "profile_id": pid,
            "target_context": "rest",
            "samples": _good_samples([70.0, 71.0, 72.0]),
            "use_llm": False,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["evaluation"]["status"] == "insufficient_baseline"
    assert body["abstained"] is True
    assert "insuficiente" in body["abstention_reason"].lower()
    assert body["policy_action"] == "unchanged"
    assert body["mission_adaptation"]["adjusted"] is False
    assert body["report"]["abstained"] is True
    assert body["report"]["data_completeness"]["valid_sample_count"] == 3


def test_daily_checkin_incomplete_or_noisy_data_abstains_and_requests_remeasure(
    client: TestClient,
) -> None:
    pid = "C073-sim"
    DAILY_CONTEXT_STORE.revoke(pid)
    # Caso A: sin mediciones (no inventa lecturas)
    empty_resp = client.post(
        "/api/daily-checkin",
        json={"profile_id": pid, "target_context": "rest", "samples": []},
    )
    assert empty_resp.status_code == 200
    empty_body = empty_resp.json()
    assert empty_body["evaluation"]["status"] == "missing_data"
    assert empty_body["abstained"] is True
    assert empty_body["policy_action"] == "remeasure"
    assert empty_body["report"]["data_completeness"]["samples_provided"] == 0

    # Caso B: lectura ruidosa no confirmada
    noisy_samples = _good_samples([70.0, 71.0, 70.0, 72.0, 71.0]) + [
        {
            "value_bpm": 128.0,
            "context": "rest",
            "quality": "noisy",
            "signal_quality_score": 0.3,
            "measurement_confirmed": False,
            "source": "sim_sensor_explicit",
        }
    ]
    noisy_resp = client.post(
        "/api/daily-checkin",
        json={"profile_id": pid, "target_context": "rest", "samples": noisy_samples},
    )
    assert noisy_resp.status_code == 200
    noisy_body = noisy_resp.json()
    assert noisy_body["evaluation"]["status"] == "low_quality"
    assert noisy_body["abstained"] is True
    assert noisy_body["policy_action"] == "remeasure"
    assert noisy_body["proposed_missions"][0]["mission_id"] == "remeasure_hr_check"
    assert noisy_body["proposed_missions"][0]["confirmed"] is False


def test_daily_checkin_emergency_escalates_pauses_and_bypasses_llm(
    client: TestClient,
) -> None:
    pid = "C074-sim"
    DAILY_CONTEXT_STORE.revoke(pid)
    resp = client.post(
        "/api/daily-checkin",
        json={
            "profile_id": pid,
            "target_context": "activity",
            "samples": _good_samples([110.0, 112.0, 111.0, 113.0, 112.0]),
            "symptom_text": "Opresión en el pecho y me cuesta respirar",
            "use_llm": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["policy_action"] == "stop_and_contact_medical"
    assert body["contact_medical_team"] is True
    assert body["stop_activity"] is True
    assert body["medical_contact_notice"]
    assert body["abstained"] is False
    assert all(m["intensity"] == "paused" and m["confirmed"] is False for m in body["proposed_missions"])
    assert body["provenance"]["mode"] == "rules_only"
    assert body["provenance"]["llm_available"] is False
    assert body["provenance"]["safety_audit"]["model_consulted"] is False
    assert body["llm_output"] is not None
    assert "equipo médico" in body["llm_output"]["answer"]


def test_daily_checkin_severe_interview_pain_escalates_and_pauses(
    client: TestClient,
) -> None:
    pid = "C075-sim"
    DAILY_CONTEXT_STORE.revoke(pid)
    resp = client.post(
        "/api/daily-checkin",
        json={
            "profile_id": pid,
            "target_context": "rest",
            "samples": _good_samples([70.0, 71.0, 70.0, 72.0, 71.0]),
            "interview": {
                "profile_id": pid,
                "sleep_quality": 4,
                "energy": 4,
                "mood": 4,
                "hydration_completed": True,
                "pain": {"present": True, "zone": "thorax", "intensity": 9},
                "notes": "",
            },
            "use_llm": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["policy_action"] == "stop_and_contact_medical"
    assert body["contact_medical_team"] is True
    assert body["stop_activity"] is True
    assert all(m["intensity"] == "paused" for m in body["proposed_missions"])
    assert body["provenance"]["safety_audit"]["model_consulted"] is False


def test_daily_checkin_llm_receives_controlled_context_and_cannot_diagnose(
    client: TestClient,
) -> None:
    pid = "C076-sim"
    DAILY_CONTEXT_STORE.revoke(pid)

    class _FakeHttpxClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def post(self, *args: object, **kwargs: object) -> httpx.Response:
            req = httpx.Request("POST", "http://127.0.0.1:1/api/chat")
            payload = {
                "message": {
                    "content": (
                        '{"answer": "Tu serie simulada en reposo se mantiene estable respecto a tu línea base.", '
                        '"citations": ["vitals-engine-v1", "invented-citation"], '
                        '"proposed_actions": [{"action": "record_observation", "label": "Anotar", "requires_confirmation": false}], '
                        '"safety_note": "Solo educativo."}'
                    )
                }
            }
            return httpx.Response(200, json=payload, request=req)

        def close(self) -> None:
            pass

    with patch("app.llm_adapter.httpx.Client", _FakeHttpxClient):
        resp = client.post(
            "/api/daily-checkin",
            json={
                "profile_id": pid,
                "target_context": "rest",
                "samples": _good_samples([70.0, 71.0, 69.0, 72.0, 70.0]),
                "use_llm": True,
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["provenance"]["mode"] == "unavailable"
    assert body["provenance"]["llm_available"] is False
    assert body["llm_output"] is None
    assert "citas o acciones" in body["provenance"]["unavailable_reason"].lower()
    # El LLM nunca decide severidad ni diagnóstico
    assert body["llm_context_payload"]["status"] == "nominal"
    assert body["llm_context_payload"]["policy_action"] == "unchanged"
    assert body["llm_context_payload"]["is_clinical_diagnosis"] is False
    assert body["llm_context_payload"]["vital_summary"]["trend_direction"] in {
        "rising", "falling", "stable"
    }


def test_daily_checkin_llm_unreachable_never_fakes_output(client: TestClient) -> None:
    pid = "C077-sim"
    DAILY_CONTEXT_STORE.revoke(pid)
    resp = client.post(
        "/api/daily-checkin",
        json={
            "profile_id": pid,
            "target_context": "rest",
            "samples": _good_samples([70.0, 71.0, 69.0, 72.0, 70.0]),
            "use_llm": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["provenance"]["mode"] == "unavailable"
    assert body["provenance"]["llm_available"] is False
    assert body["llm_output"] is None
    assert body["deterministic_explanation"]
