from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import AppSettings
from app.daily_context import DAILY_CONTEXT_STORE, DailyContextSubmission
from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    project_root = Path(__file__).resolve().parent.parent
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    data_root = tmp_path / "data"
    data_root.mkdir()
    settings = AppSettings(
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
    return TestClient(create_app(settings))


def test_multi_vitals_within_general_adult_reference(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={
            "heart_rate_bpm": 72,
            "respiratory_rate_per_min": 16,
            "systolic_mmhg": 118,
            "diastolic_mmhg": 76,
            "spo2_percent": 98,
            "temperature_celsius": 37.0,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["overall_state"] == "within_reference"
    assert len(body["observations"]) == 5
    assert all(item["state"] == "within_reference" for item in body["observations"])
    assert body["is_clinical_diagnosis"] is False
    assert body["simulated_only"] is True


def test_english_multi_vital_response_and_sources(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={"language": "en", "heart_rate_bpm": 112},
    )
    assert response.status_code == 200
    body = response.json()
    assert "outside" in body["observations"][0]["state"] or body["observations"][0]["state"] == "outside_reference"
    assert "Rest for 5 minutes" in body["recommendations"][0]
    assert "chest" in body["integration_3d"]["reason"].lower() or body["integration_3d"]["zone"] == "thorax"


def test_english_chest_pain_and_abnormal_reading_escalate(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={"language": "en", "heart_rate_bpm": 112, "symptom_text": "I have chest pain"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["emergency_bypass"] is True
    assert body["contact_medical_team"] is True
    assert "medical" in body["copilot_message"].lower()


@pytest.mark.parametrize("symptom_text", [
    "No tengo dolor en el pecho",
    "No me falta el aire",
    "I do not have chest pain",
])
def test_negated_chest_or_breathing_symptoms_are_not_emergency_or_active(
    client: TestClient, symptom_text: str
) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={"symptom_text": symptom_text, "heart_rate_bpm": 72},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["emergency_bypass"] is False
    assert body["contact_medical_team"] is False
    assert body["context_used"]["symptoms_confirmed"] is False


def test_mission_metrics_keep_hydration_as_intake_not_body_status(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={"language": "en", "hydration_intake_ml": 900},
    )
    assert response.status_code == 200
    body = response.json()
    metric = next(item for item in body["mission_metrics"] if item["key"] == "hydration_intake")
    assert metric["status"] == "logged_only"
    assert "does not measure body hydration" in metric["message"].lower()
    assert body["contact_medical_team"] is False


def test_muscle_strength_and_bone_density_use_personal_baseline_and_mission_context(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={
            "muscle_strength_percent_baseline": 75,
            "bone_density_percent_baseline": 92,
            "bone_site": "hip_spine",
        },
    )
    assert response.status_code == 200
    metrics = {item["key"]: item for item in response.json()["mission_metrics"]}
    assert metrics["muscle_strength"]["status"] == "below_mission_reference"
    assert metrics["bone_density"]["status"] == "below_mission_reference"
    assert response.json()["contact_medical_team"] is False


def test_femoral_neck_reference_and_radiation_need_mission_limit(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={
            "language": "en",
            "bone_density_percent_baseline": 92,
            "bone_site": "femoral_neck",
            "radiation_dose_msv": 35,
        },
    )
    assert response.status_code == 200
    metrics = {item["key"]: item for item in response.json()["mission_metrics"]}
    assert metrics["bone_density"]["status"] == "meeting_mission_reference"
    assert metrics["radiation_dose"]["status"] == "unassessed"
    assert "mission-specific" in metrics["radiation_dose"]["message"].lower()


def test_radiation_dose_compares_only_to_explicit_mission_limit(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={"radiation_dose_msv": 22, "radiation_limit_msv": 20},
    )
    assert response.status_code == 200
    metric = next(item for item in response.json()["mission_metrics"] if item["key"] == "radiation_dose")
    assert metric["status"] == "limit_reached"
    assert response.json()["contact_medical_team"] is False


def test_out_of_range_readings_recommend_rest_and_remeasurement(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={"heart_rate_bpm": 112, "respiratory_rate_per_min": 22},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["overall_state"] == "outside_reference"
    assert body["zone_highlight"] == "thorax"
    assert any("descansa" in item.lower() and "repite" in item.lower() for item in body["recommendations"])
    assert all(item["state"] == "outside_reference" for item in body["observations"])


def test_low_spo2_recommends_medical_contact_and_critical_value_is_urgent(
    client: TestClient,
) -> None:
    attention = client.post("/api/vitals/multi-check", json={"spo2_percent": 91})
    assert attention.status_code == 200
    assert attention.json()["overall_state"] == "urgent"
    assert attention.json()["contact_medical_team"] is True

    urgent = client.post("/api/vitals/multi-check", json={"spo2_percent": 88})
    assert urgent.status_code == 200
    assert urgent.json()["overall_state"] == "urgent"
    assert any("inmediato" in text.lower() for text in urgent.json()["recommendations"])


def test_severe_blood_pressure_escalation_depends_on_red_flag_symptoms(
    client: TestClient,
) -> None:
    no_symptoms = client.post(
        "/api/vitals/multi-check",
        json={"systolic_mmhg": 185, "diastolic_mmhg": 122},
    )
    assert no_symptoms.status_code == 200
    assert no_symptoms.json()["overall_state"] == "urgent"
    assert no_symptoms.json()["contact_medical_team"] is True
    assert no_symptoms.json()["emergency_bypass"] is False

    symptoms = client.post(
        "/api/vitals/multi-check",
        json={
            "systolic_mmhg": 185,
            "diastolic_mmhg": 122,
            "symptom_text": "Tengo opresión en el pecho y dificultad para respirar",
        },
    )
    assert symptoms.status_code == 200
    assert symptoms.json()["emergency_bypass"] is True
    assert symptoms.json()["contact_medical_team"] is True


def test_extreme_low_temperature_escalates_without_llm(client: TestClient) -> None:
    response = client.post(
        "/api/vitals/multi-check",
        json={"temperature_celsius": 34.8},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["overall_state"] == "urgent"
    assert body["contact_medical_team"] is True
    assert body["emergency_bypass"] is True
    assert body["llm_used"] is False


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"systolic_mmhg": 120},
        {"systolic_mmhg": 110, "diastolic_mmhg": 115},
        {"spo2_percent": 101},
        {"temperature_celsius": 46},
    ],
)
def test_invalid_or_empty_multi_vital_input_is_rejected(
    client: TestClient, payload: dict[str, object]
) -> None:
    response = client.post("/api/vitals/multi-check", json=payload)
    assert response.status_code == 422


def test_confirmed_voice_context_combines_chest_symptoms_and_abnormal_vitals(
    client: TestClient,
) -> None:
    profile_id = "MULTI-VOICE-01"
    DAILY_CONTEXT_STORE.revoke(profile_id)
    DAILY_CONTEXT_STORE.store(
        DailyContextSubmission(
            profile_id=profile_id,
            capture_mode="voice_ptt_confirmed",
            transcript_confirmed_by_user=True,
            consent={"session_context_consent": True},
            recent_activity={"status": "answered", "value": "activity"},
            symptoms={
                "status": "answered",
                "confirmed_text": "Tengo opresión en el pecho y dificultad para respirar",
            },
        )
    )
    try:
        response = client.post(
            "/api/vitals/multi-check",
            json={"profile_id": profile_id, "heart_rate_bpm": 112},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["context_used"]["daily_context_found"] is True
        assert body["context_used"]["recent_activity"] == "activity"
        assert body["emergency_bypass"] is True
        assert body["contact_medical_team"] is True
        assert "contacta" in body["copilot_message"].lower()
        assert body["suggested_actions"] == ["contact_medical_team"]
    finally:
        DAILY_CONTEXT_STORE.revoke(profile_id)


def test_recent_exercise_still_leads_to_rest_then_remeasurement(
    client: TestClient,
) -> None:
    profile_id = "MULTI-ACTIVE-02"
    DAILY_CONTEXT_STORE.revoke(profile_id)
    DAILY_CONTEXT_STORE.store(
        DailyContextSubmission(
            profile_id=profile_id,
            capture_mode="voice_ptt_confirmed",
            transcript_confirmed_by_user=True,
            consent={"session_context_consent": True},
            recent_activity={"status": "answered", "value": "activity"},
            symptoms={"status": "answered", "reported_none": True},
        )
    )
    try:
        response = client.post(
            "/api/vitals/multi-check",
            json={"profile_id": profile_id, "heart_rate_bpm": 112},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["overall_state"] == "outside_reference"
        assert "actividad reciente" in body["recommendations"][0].lower()
        assert "descansa 5 minutos" in body["recommendations"][0].lower()
        assert body["suggested_actions"] == [
            "rest",
            "hydrate_if_not_restricted",
            "remeasure",
        ]
    finally:
        DAILY_CONTEXT_STORE.revoke(profile_id)
