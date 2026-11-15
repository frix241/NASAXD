"""Pruebas mockeadas del pipeline de voz offline (contrato MVP).

Ninguna prueba descarga modelos, abre puertos ni depende de procesos STT/TTS
reales; los puentes son mocks. Verifica: push-to-talk con permiso de
micrófono, confirmación explícita antes de acciones, cancelación/interrupción,
bypass de emergencia determinista por voz, modo texto honesto con LLM/STT/TTS
no disponibles y garantías de privacidad (sin grabación en segundo plano ni
subida de audio).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import AppSettings
from app.main import create_app
from app.voice_pipeline import VoiceSession


def _settings(tmp_path: Path, **flags: bool) -> AppSettings:
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
        stt_provider="whisper.cpp",
        stt_url="http://127.0.0.1:59998",
        tts_provider="sherpa-onnx",
        tts_url="http://127.0.0.1:59997",
        voice_timeout_seconds=0.2,
        **flags,
    )


class MockSTT:
    """Puente STT falso; cuenta llamadas y puede fallar a propósito."""

    def __init__(self, text: str | None = "Muestra el estado del corazón") -> None:
        self.text = text
        self.calls = 0

    def transcribe(self, audio_ref: str) -> dict[str, str] | None:
        self.calls += 1
        if self.text is None:
            return None
        return {"text": self.text, "language": "es"}


class MockTTS:
    """Puente TTS falso; devuelve un contrato de audio mínimo."""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    def synthesize(self, text: str) -> dict[str, object] | None:
        self.calls += 1
        if self.fail:
            return None
        return {"content_type": "audio/wav", "sample_rate": 22050}


def _full_flags() -> dict[str, bool]:
    return {
        "voice_enabled": True,
        "stt_enabled": True,
        "vad_enabled": False,
        "tts_enabled": True,
    }


# -- pipeline en proceso -----------------------------------------------------


def test_push_to_talk_requires_mic_permission(tmp_path: Path) -> None:
    session = VoiceSession(_settings(tmp_path, **_full_flags()))
    result = session.start_push_to_talk(mic_permission_granted=False)
    assert result["state"] == "mic_permission_required"
    assert result["recording"] is False
    assert session.recording is False


def test_recording_only_while_push_to_talk_active_and_cancel_discards(tmp_path: Path) -> None:
    session = VoiceSession(_settings(tmp_path, **_full_flags()))
    started = session.start_push_to_talk(mic_permission_granted=True)
    assert started["recording"] is True and session.recording is True
    stopped = session.stop_push_to_talk(transcript_text="Estado del corazón")
    assert stopped["state"] == "awaiting_confirmation"
    assert session.recording is False
    cancelled = session.cancel()
    assert cancelled["recording"] is False
    assert cancelled["transcript"] is None
    assert session.state == "cancelled"


def test_stt_disabled_yields_honest_text_fallback(tmp_path: Path) -> None:
    session = VoiceSession(_settings(tmp_path, voice_enabled=True, stt_enabled=False))
    started = session.start_push_to_talk(mic_permission_granted=True)
    assert started["recording"] is True
    result = session.stop_push_to_talk()
    assert result["state"] == "text_fallback"
    assert result["transcript"] is None
    assert "simula transcripción" in result["reason"]
    assert "modo texto" in result["reason"]


def test_typed_text_fallback_goes_through_same_confirmation_and_guards(tmp_path: Path) -> None:
    """El modo texto es un fallback honesto: mismas guardas, sin STT activo."""
    session = VoiceSession(_settings(tmp_path, voice_enabled=True, stt_enabled=False))
    session.start_push_to_talk(mic_permission_granted=True)
    result = session.stop_push_to_talk(transcript_text="¿Qué probabilidad de infarto es 80%?")
    assert result["state"] == "awaiting_confirmation"
    assert result["transcript"]["source"] == "text_fallback"
    confirmed = session.confirm_transcript(confirmed=True)
    assert confirmed["accepted"] is True


def test_stt_bridge_failure_degrades_to_text_fallback(tmp_path: Path) -> None:
    stt = MockSTT(text=None)
    session = VoiceSession(_settings(tmp_path, **_full_flags()), stt_bridge=stt)
    session.start_push_to_talk(mic_permission_granted=True)
    result = session.stop_push_to_talk()
    assert stt.calls == 1
    assert result["state"] == "text_fallback"
    assert result["transcript"] is None


def test_transcript_confirmation_required_before_action(tmp_path: Path) -> None:
    stt = MockSTT(text="Muestra el estado del corazón")
    session = VoiceSession(_settings(tmp_path, **_full_flags()), stt_bridge=stt)
    session.start_push_to_talk(mic_permission_granted=True)
    stopped = session.stop_push_to_talk()
    assert stopped["state"] == "awaiting_confirmation"
    transcript = stopped["transcript"]
    assert transcript["confirmed_by_user"] is False
    assert transcript["requires_confirmation"] is True

    refused = session.confirm_transcript(confirmed=False)
    assert refused["accepted"] is False
    assert session.transcript is None

    stt2 = MockSTT(text="Muestra el estado del corazón")
    session2 = VoiceSession(_settings(tmp_path, **_full_flags()), stt_bridge=stt2)
    session2.start_push_to_talk(mic_permission_granted=True)
    session2.stop_push_to_talk()
    confirmed = session2.confirm_transcript(confirmed=True)
    assert confirmed["accepted"] is True
    assert confirmed["transcript"]["confirmed_by_user"] is True
    assert session2.state == "confirmed"


def test_confirm_without_pending_transcript_executes_nothing(tmp_path: Path) -> None:
    session = VoiceSession(_settings(tmp_path, **_full_flags()))
    result = session.confirm_transcript(confirmed=True)
    assert result["accepted"] is False
    assert session.state == "idle"


def test_emergency_transcript_bypasses_generation_with_escalation(tmp_path: Path) -> None:
    stt = MockSTT(text="Emergencia: tengo dolor fuerte en el pecho y no puedo respirar")
    session = VoiceSession(_settings(tmp_path, **_full_flags()), stt_bridge=stt)
    session.start_push_to_talk(mic_permission_granted=True)
    result = session.stop_push_to_talk()
    assert result["state"] == "emergency_escalation"
    reply = result["reply"]
    assert reply["mode"] == "emergency_escalation"
    assert "equipo médico" in reply["text"].lower() or "control de misión" in reply["text"].lower()
    assert "112" not in reply["text"] and "911" not in reply["text"]  # wording de misión, sin números inventados
    assert reply["proposed_actions"] == []
    assert reply["citations"] == []
    assert reply["llm_available"] is False


def test_new_push_to_talk_interrupts_previous_turn(tmp_path: Path) -> None:
    stt = MockSTT(text="Primera consulta")
    session = VoiceSession(_settings(tmp_path, **_full_flags()), stt_bridge=stt)
    session.start_push_to_talk(mic_permission_granted=True)
    session.stop_push_to_talk()
    assert session.transcript is not None
    interrupted = session.start_push_to_talk(mic_permission_granted=True)
    assert interrupted["interrupted_previous_turn"] is True
    assert session.transcript is None
    assert session.state == "recording"


def test_tts_disabled_reply_is_text_only(tmp_path: Path) -> None:
    session = VoiceSession(_settings(tmp_path, voice_enabled=True, tts_enabled=False))
    reply = session.synthesize_reply("Respuesta operativa nominal.", llm_available=False)
    assert reply["mode"] == "rules_text_fallback"
    assert reply["llm_available"] is False
    assert reply["tts"]["mode"] == "text_only"
    assert reply["tts"]["available"] is False


def test_tts_bridge_produces_audio_contract_or_honest_text(tmp_path: Path) -> None:
    tts = MockTTS()
    session = VoiceSession(_settings(tmp_path, **_full_flags()), tts_bridge=tts)
    reply = session.synthesize_reply("Respuesta operativa nominal.", llm_available=False)
    assert tts.calls == 1
    assert reply["tts"]["available"] is True
    assert reply["tts"]["content_type"] == "audio/wav"

    failing = VoiceSession(
        _settings(tmp_path, **_full_flags()), tts_bridge=MockTTS(fail=True)
    )
    reply_fail = failing.synthesize_reply("Respuesta.", llm_available=False)
    assert reply_fail["tts"]["available"] is False
    assert reply_fail["tts"]["mode"] == "text_only"


# -- API ----------------------------------------------------------------------


def test_api_voice_pipeline_contract_privacy_guarantees(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path, **_full_flags())))
    resp = client.get("/api/voice/pipeline")
    assert resp.status_code == 200
    body = resp.json()
    assert body["privacy"]["no_background_recording"] is True
    assert body["privacy"]["no_audio_upload"] is True
    assert body["privacy"]["audio_accepted_by_pipeline_endpoints"] is False
    assert body["privacy"]["max_recording_seconds"] == 15
    assert body["feature_flags"]["voice_enabled"] is True
    assert body["engines"]["configured"]["stt"]["implemented_bridge"] is True
    assert "app/voice_bridge.py" in body["engines"]["configured"]["stt"]["bridge_module"]
    assert body["engines"]["configured"]["tts"]["tested_in_runtime"] is True
    assert body["engines"]["research_recommended"]["stt"]["recommended"].startswith(
        "whisper.cpp"
    )
    assert "torch.hub" in body["engines"]["research_recommended"]["vad"]["forbidden"]


def test_api_voice_pipeline_disabled_flag_is_honest(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path)))
    resp = client.post(
        "/api/voice/pipeline/action",
        json={
            "session_id": "sess-001",
            "action": "start_push_to_talk",
            "mic_permission_granted": True,
        },
    )
    assert resp.status_code == 409
    assert resp.json()["enabled"] is False


def test_api_voice_turn_flow_with_mocked_stt(tmp_path: Path) -> None:
    stt = MockSTT(text="Muestra el estado del corazón")
    client = TestClient(
        create_app(_settings(tmp_path, **_full_flags()), stt_bridge=stt)
    )
    start = client.post(
        "/api/voice/pipeline/action",
        json={
            "session_id": "sess-abc123",
            "action": "start_push_to_talk",
            "mic_permission_granted": True,
        },
    )
    assert start.status_code == 200
    assert start.json()["recording"] is True

    stop = client.post(
        "/api/voice/pipeline/action",
        json={"session_id": "sess-abc123", "action": "stop_push_to_talk"},
    )
    assert stop.status_code == 200
    assert stop.json()["state"] == "awaiting_confirmation"
    assert stt.calls == 1

    confirm = client.post(
        "/api/voice/pipeline/action",
        json={
            "session_id": "sess-abc123",
            "action": "confirm_transcript",
            "confirmed": True,
        },
    )
    assert confirm.status_code == 200
    assert confirm.json()["accepted"] is True


def test_api_voice_pipeline_rejects_audio_fields(tmp_path: Path) -> None:
    """Garantía de privacidad: el contrato no acepta audio (extra=forbid)."""
    client = TestClient(create_app(_settings(tmp_path, **_full_flags())))
    resp = client.post(
        "/api/voice/pipeline/action",
        json={
            "session_id": "sess-audio",
            "action": "start_push_to_talk",
            "mic_permission_granted": True,
            "audio_b64": "AAAA",
        },
    )
    assert resp.status_code == 422


def test_api_voice_emergency_transcript_via_mocked_stt(tmp_path: Path) -> None:
    stt = MockSTT(text="Dolor fuerte en el pecho, no puedo respirar")
    client = TestClient(
        create_app(_settings(tmp_path, **_full_flags()), stt_bridge=stt)
    )
    client.post(
        "/api/voice/pipeline/action",
        json={
            "session_id": "sess-emer001",
            "action": "start_push_to_talk",
            "mic_permission_granted": True,
        },
    )
    stop = client.post(
        "/api/voice/pipeline/action",
        json={"session_id": "sess-emer001", "action": "stop_push_to_talk"},
    )
    assert stop.status_code == 200
    body = stop.json()
    assert body["state"] == "emergency_escalation"
    assert "control de misión" in body["reply"]["text"].lower() or "equipo médico" in body["reply"]["text"].lower()
    assert "112" not in body["reply"]["text"] and "911" not in body["reply"]["text"]
    assert body["reply"]["proposed_actions"] == []


def test_api_voice_reply_text_mode_when_tts_unavailable(tmp_path: Path) -> None:
    client = TestClient(
        create_app(_settings(tmp_path, voice_enabled=True, tts_enabled=False))
    )
    resp = client.post(
        "/api/voice/pipeline/reply",
        json={"text": "Respuesta determinista de reglas."},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["tts"]["mode"] == "text_only"
    assert body["tts"]["available"] is False
    assert "no activo" in body["tts"]["reason"]
