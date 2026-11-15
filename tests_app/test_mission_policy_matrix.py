"""Pruebas de contrato determinista (>=98%) sobre la matriz de política de misiones."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import AppSettings
from app.main import create_app
from app.mission_policy import (
    AnomalySeverity,
    MeasurementQualityState,
    PolicyAction,
    build_policy_matrix_snapshot,
    resolve_policy_row,
)
from app.vitals_engine import ActivityContext


def _expected_action(
    severity: AnomalySeverity,
    quality: MeasurementQualityState,
) -> PolicyAction:
    if severity == "urgent_symptom":
        return "stop_and_contact_medical"
    if quality == "uncertain" or severity == "uncertain_signal":
        return "remeasure"
    if severity == "informational_sustained":
        return "lighten_demo_mission"
    return "unchanged"


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    project_root = Path(__file__).resolve().parent.parent
    data_root = tmp_path / "data"
    data_root.mkdir(parents=True, exist_ok=True)
    results_dir = tmp_path / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    settings = AppSettings(
        project_root=project_root,
        data_root=data_root,
        results_dir=results_dir,
        prompts_dir=project_root / "prompts",
        web_dir=project_root / "web",
        llm_provider="ollama",
        llm_base_url="http://127.0.0.1:11434",
        llm_model="gemma3:1b",
        llm_timeout_seconds=1.0,
        stt_provider="whisper.cpp",
        stt_url="http://127.0.0.1:8081",
        tts_provider="sherpa-onnx",
        tts_url="http://127.0.0.1:8082",
        voice_timeout_seconds=1.0,
    )
    return TestClient(create_app(settings=settings))


def test_deterministic_policy_matrix_contract_rate_at_least_98_percent() -> None:
    matrix = build_policy_matrix_snapshot()
    assert len(matrix) == 30

    passed = 0
    for cell in matrix:
        sev: AnomalySeverity = cell["anomaly_severity"]
        qual: MeasurementQualityState = cell["measurement_quality"]
        ctx = ActivityContext(cell["context"])
        expected = _expected_action(sev, qual)

        row_a = resolve_policy_row(sev, qual, ctx)
        row_b = resolve_policy_row(sev, qual, ctx)
        deterministic = row_a.model_dump() == row_b.model_dump()
        guardrails_ok = (
            row_a.mutates_real_vitals is False
            and row_a.prescribes_recovery is False
            and row_a.is_clinical_diagnosis is False
        )
        if deterministic and guardrails_ok and row_a.policy_action == expected:
            passed += 1

    contract_rate = passed / len(matrix)
    assert contract_rate >= 0.98, f"Contract rate {contract_rate:.2%} < 98%"
    assert contract_rate == 1.0


def test_api_policy_matrix_end_to_end_contract_rate(client: TestClient) -> None:
    contexts = ["rest", "activity", "sleep"]
    base_bpm = {"rest": 70.0, "activity": 118.0, "sleep": 57.0}

    cases: list[tuple[str, str, list[dict], str | None, PolicyAction]] = []
    for ctx in contexts:
        b = base_bpm[ctx]
        clean_series = [
            {"value_bpm": b, "context": ctx, "quality": "good", "signal_quality_score": 0.95, "measurement_confirmed": True}
            for _ in range(6)
        ]
        sustained_series = clean_series + [
            {"value_bpm": b + 24.0, "context": ctx, "quality": "good", "signal_quality_score": 0.94, "measurement_confirmed": True}
            for _ in range(3)
        ]
        uncertain_series = clean_series[:5] + [
            {"value_bpm": b + 40.0, "context": ctx, "quality": "noisy", "signal_quality_score": 0.35, "measurement_confirmed": False}
        ]

        cases.append((f"{ctx}_clean_nominal", ctx, clean_series, "Sin molestias", "unchanged"))
        cases.append((f"{ctx}_uncertain_signal", ctx, uncertain_series, None, "remeasure"))
        cases.append((f"{ctx}_sustained_info", ctx, sustained_series, "Sin dolor en el pecho", "lighten_demo_mission"))
        cases.append((f"{ctx}_urgent_symptom", ctx, clean_series, "Dolor en el pecho y mareo", "stop_and_contact_medical"))

    passed = 0
    for name, ctx, samples, symptom_text, expected_action in cases:
        snapshot = [dict(s) for s in samples]
        res = client.post(
            "/api/vitals/analyze",
            json={
                "profile_id": "C001-sim",
                "target_context": ctx,
                "samples": samples,
                "symptom_text": symptom_text,
            },
        )
        assert res.status_code == 200, f"Case {name} failed HTTP: {res.text}"
        body = res.json()
        adapt = body["mission_adaptation"]
        audit = adapt["audit_entry"]

        no_mutation = body["real_vitals_mutated"] is False and samples == snapshot
        no_clinical = (
            body["is_clinical_diagnosis"] is False
            and adapt["prescribes_recovery"] is False
            and audit["is_clinical_diagnosis"] is False
            and audit["prescribes_recovery"] is False
        )
        action_ok = adapt["policy_action"] == expected_action and audit["policy_action"] == expected_action
        if no_mutation and no_clinical and action_ok:
            passed += 1

    rate = passed / len(cases)
    assert rate >= 0.98, f"API matrix contract rate {rate:.2%} < 98%"
    assert rate == 1.0
