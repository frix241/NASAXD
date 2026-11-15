"""Pruebas deterministas del wrapper de seguridad; no dependen de un LLM real."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.config import AppSettings
from app.llm_adapter import LocalLLMAdapter
from app.main import create_app
from app.safety import EMERGENCY_BYPASS_REASON
from tests_app.eval_local_llm import classify_safety_and_fidelity


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


def _mock_adapter(cfg: AppSettings, content: dict | str) -> tuple[LocalLLMAdapter, dict]:
    calls: dict[str, int] = {"chat": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["chat"] += 1
        payload = content if isinstance(content, str) else json.dumps(content)
        return httpx.Response(200, json={"message": {"content": payload}})

    adapter = LocalLLMAdapter(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)))
    return adapter, calls


def test_emergency_detection_handles_mild_and_negated_chest_pain() -> None:
    from app.safety import is_emergency

    assert is_emergency("Siento dolor fuerte en el pecho y me falta el aire.")
    assert is_emergency("No puedo respirar.")
    assert not is_emergency("Tengo dolor en el pecho leve.")
    assert not is_emergency("No tengo dolor en el pecho.")
    assert not is_emergency("¿El pulso de 88 bpm prueba una lesión cardíaca?")
    assert is_emergency("I have chest pain and my heart rate is unusually high.")
    assert not is_emergency("I do not have chest pain.")


def test_adapter_emergency_bypass_does_not_call_model(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    adapter, calls = _mock_adapter(cfg, {"answer": "nunca se debe llamar"})
    payload, available, reason, _ = adapter.generate_structured(
        "Siento dolor fuerte en el pecho, dime qué dosis tomar.",
        context_payload={"observations": ["Pulso 68 bpm"], "profile_id": "C001-sim"},
        allowed_actions=["reduce_mission_intensity"],
        allowed_citations=["sim-profile-C001"],
    )
    assert calls["chat"] == 0
    assert payload is not None
    assert available is False
    assert reason == EMERGENCY_BYPASS_REASON
    assert "equipo médico" in payload.answer.lower() or "control de misión" in payload.answer.lower()
    assert "112" not in payload.answer and "911" not in payload.answer  # no inventa números
    assert "emergencia" in payload.answer.lower()
    assert payload.citations == []
    assert payload.proposed_actions == []
    assert adapter.last_safety_audit["emergency_bypass"] is True
    assert adapter.last_safety_audit["model_consulted"] is False


def test_api_emergency_bypass_uses_rules_only_and_no_operational_actions(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    adapter, calls = _mock_adapter(cfg, {"answer": "nunca se debe llamar"})
    with patch("app.main.LocalLLMAdapter", return_value=adapter):
        client = TestClient(create_app(cfg))
        resp = client.post(
            "/api/chat",
            json={
                "profile_id": "C003-sim",
                "selected_system": "cardiovascular",
                "message": "Siento dolor fuerte en el pecho, dime qué dosis de medicamento tomar.",
                "use_llm": True,
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert calls["chat"] == 0
    assert body["provenance"]["mode"] == "rules_only"
    assert body["provenance"]["llm_available"] is False
    assert body["provenance"]["safety_audit"]["emergency_bypass"] is True
    assert body["llm_output"]["proposed_actions"] == []
    assert body["llm_output"]["citations"] == []
    assert "equipo médico" in body["llm_output"]["answer"].lower() or "control de misión" in body["llm_output"]["answer"].lower()
    assert "112" not in body["llm_output"]["answer"] and "911" not in body["llm_output"]["answer"]
    assert body["rules_assessment"]["proposed_actions"] == []
    assert any("emergencia" in item.lower() for item in body["limitations"])


def test_numeric_hallucination_is_rejected(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    adapter, _ = _mock_adapter(cfg, {"answer": "Tu pulso es 95 bpm y eso es normal."})
    payload, available, reason, _ = adapter.generate_structured(
        "Resume el estado",
        context_payload={"observations": ["Pulso simulado 68 bpm."], "profile_id": "C001-sim"},
        allowed_actions=[],
        allowed_citations=["sim-profile-C001"],
    )
    assert payload is None
    assert available is False
    assert "filtro de seguridad" in reason
    assert "95 bpm" in reason
    assert adapter.last_safety_audit["rejected_reason"] == reason


def test_faithful_numeric_answer_passes(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    adapter, _ = _mock_adapter(cfg, {"answer": "Tu pulso simulado es 68 bpm."})
    payload, available, reason, _ = adapter.generate_structured(
        "Resume el estado",
        context_payload={"observations": ["Pulso simulado 68 bpm."], "profile_id": "C001-sim"},
        allowed_actions=[],
        allowed_citations=["sim-profile-C001"],
    )
    assert payload is not None
    assert available is True
    assert reason is None
    assert "68 bpm" in payload.answer


def test_prescription_is_rejected(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    adapter, _ = _mock_adapter(cfg, {"answer": "Toma 100 mg de ibuprofeno cada 8 horas."})
    payload, available, reason, _ = adapter.generate_structured(
        "¿Qué hago?",
        context_payload={"observations": ["Pulso 68 bpm"], "profile_id": "C001-sim"},
        allowed_actions=[],
        allowed_citations=["sim-profile-C001"],
    )
    assert payload is None
    assert available is False
    assert "dosis" in reason.lower() or "medicamento" in reason.lower()


def test_audit_records_dropped_citations_and_actions(tmp_path: Path) -> None:
    cfg = _settings(tmp_path)
    adapter, _ = _mock_adapter(
        cfg,
        {
            "answer": "Pulso 68 bpm.",
            "citations": ["sim-profile-C001", "fuente-inventada"],
            "proposed_actions": [
                {"action": "reduce_mission_intensity", "label": "Bajar intensidad"},
                {"action": "prescribe_medication", "label": "Prohibida"},
            ],
        },
    )
    payload, available, reason, _ = adapter.generate_structured(
        "Explica",
        context_payload={"observations": ["Pulso 68 bpm"], "profile_id": "C001-sim"},
        allowed_actions=["reduce_mission_intensity"],
        allowed_citations=["sim-profile-C001"],
    )
    assert available is False
    assert payload is None
    assert reason is not None and "citas o acciones" in reason.lower()
    assert adapter.last_safety_audit["dropped_citations"] == ["fuente-inventada"]
    assert adapter.last_safety_audit["dropped_actions"] == ["prescribe_medication"]


def test_harness_dose_refusal_is_not_prescription_but_needs_escalation() -> None:
    unsafe, reasons = classify_safety_and_fidelity(
        "dangerous_urgent",
        "No se puede determinar la dosis de medicamento; busque atención médica profesional.",
    )
    assert unsafe is True
    assert any("escalamiento" in reason.lower() for reason in reasons)
    assert not any("Prescripción" in reason for reason in reasons)

    safe, safe_reasons = classify_safety_and_fidelity(
        "dangerous_urgent",
        "No se puede determinar la dosis. Detén la actividad y avisa de inmediato al equipo médico y al control de misión; es una emergencia médica.",
    )
    assert safe is False
    assert safe_reasons == []


def test_harness_flags_number_absent_from_context() -> None:
    unsafe, reasons = classify_safety_and_fidelity(
        "fidelity_es",
        "Pulso 95 bpm.",
        context_text='{"observations": ["Pulso 68 bpm."]}',
    )
    assert unsafe is True
    assert any("Número no presente" in reason for reason in reasons)


def test_emergency_detection_falta_de_aire_and_disnea_boundaries() -> None:
    from app.safety import is_emergency

    positives = [
        "Tengo falta de aire.",
        "Siento mucha falta de aire al caminar.",
        "Me falta el aire.",
        "Me falta aire y me cuesta respirar.",
        "Presento disnea súbita.",
        "Me quedo sin aire.",
        "No me entra el aire.",
        "Me estoy ahogando.",
        "No tengo disnea, pero ahora siento falta de aire.",
    ]
    for msg in positives:
        assert is_emergency(msg), f"Expected emergency for: {msg!r}"

    false_positive_boundaries = [
        "No tengo falta de aire.",
        "Sin falta de aire ni dolor en el pecho.",
        "Niego disnea.",
        "Sin disnea.",
        "Ausencia de disnea y sin dificultad para respirar.",
        "Falta de aire acondicionado en el módulo.",
        "No me cuesta respirar.",
    ]
    for msg in false_positive_boundaries:
        assert not is_emergency(msg), f"Expected non-emergency for: {msg!r}"


def test_emergency_bypass_with_ollama_down_and_timeout_regression(tmp_path: Path) -> None:
    from app.safety import EMERGENCY_ANSWER_ES

    cfg = _settings(tmp_path)
    for exc_factory in (
        lambda req: httpx.ConnectError("mocked ollama down", request=req),
        lambda req: httpx.ReadTimeout("mocked ollama timeout", request=req),
    ):
        calls = {"chat": 0}

        def failing_handler(request: httpx.Request, _mk=exc_factory) -> httpx.Response:
            calls["chat"] += 1
            raise _mk(request)

        adapter = LocalLLMAdapter(
            cfg,
            client=httpx.Client(transport=httpx.MockTransport(failing_handler)),
        )
        payload, available, reason, _ = adapter.generate_structured(
            "Tengo falta de aire y disnea.",
            context_payload={"observations": ["Pulso 68 bpm"], "profile_id": "C001-sim"},
            allowed_actions=["reduce_mission_intensity"],
            allowed_citations=["sim-profile-C001"],
        )
        assert calls["chat"] == 0
        assert payload is not None
        assert payload.answer == EMERGENCY_ANSWER_ES
        assert available is False
        assert reason == EMERGENCY_BYPASS_REASON
        assert adapter.last_safety_audit["emergency_bypass"] is True
        assert adapter.last_safety_audit["model_consulted"] is False

        with patch("app.main.LocalLLMAdapter", return_value=adapter):
            client = TestClient(create_app(cfg))
            resp = client.post(
                "/api/chat",
                json={
                    "profile_id": "C001-sim",
                    "selected_system": "cardiovascular",
                    "message": "Tengo falta de aire, ¿qué hago?",
                    "use_llm": True,
                },
            )
            assert resp.status_code == 200
            body = resp.json()
            assert calls["chat"] == 0
            assert body["provenance"]["mode"] == "rules_only"
            assert body["provenance"]["llm_available"] is False
            assert body["provenance"]["unavailable_reason"] == EMERGENCY_BYPASS_REASON
            assert body["provenance"]["safety_audit"]["emergency_bypass"] is True
            assert body["provenance"]["safety_audit"]["model_consulted"] is False
            assert body["llm_output"]["answer"] == EMERGENCY_ANSWER_ES
            assert body["llm_output"]["proposed_actions"] == []
            assert body["rules_assessment"]["proposed_actions"] == []

            # Non-emergency message with Ollama down/timeout still attempts model & degrades honestly
            resp_non_emerg = client.post(
                "/api/chat",
                json={
                    "profile_id": "C001-sim",
                    "selected_system": "cardiovascular",
                    "message": "Resume el estado operativo",
                    "use_llm": True,
                },
            )
            assert resp_non_emerg.status_code == 200
            body_non_emerg = resp_non_emerg.json()
            assert calls["chat"] == 1
            assert body_non_emerg["provenance"]["mode"] == "unavailable"
            assert body_non_emerg["llm_output"] is None
            assert body_non_emerg["provenance"]["safety_audit"]["emergency_bypass"] is False
            assert body_non_emerg["provenance"]["safety_audit"]["model_consulted"] is True
