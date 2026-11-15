"""Contratos y sondeo para sidecars locales de voz (whisper.cpp y sherpa-onnx).

Los puentes HTTP están implementados (app/voice_bridge.py) y probados en
runtime con los sidecar reales (ver results/VOICE_BRIDGE_INTEGRATION.md).
El sondeo de abajo solo comprueba que el puerto responde: un sidecar
accesible NO equivale a transcripción/síntesis verificada en esa llamada.
"""

from __future__ import annotations

import socket
from urllib.parse import urlparse

from app.config import AppSettings
from app.contracts import VoiceServiceContract


def _probe_tcp(url: str, timeout: float) -> tuple[bool, str]:
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"Puerto accesible en {host}:{port}"
    except OSError as exc:
        return False, f"Servicio no activo en {host}:{port} ({type(exc).__name__})"


def get_voice_contracts(settings: AppSettings) -> list[VoiceServiceContract]:
    """Contratos de STT (whisper-server HTTP) y TTS (sidecar sherpa-onnx HTTP)."""
    stt_ok, stt_detail = _probe_tcp(settings.stt_url, min(settings.voice_timeout_seconds, 5.0))
    tts_ok, tts_detail = _probe_tcp(settings.tts_url, min(settings.voice_timeout_seconds, 5.0))

    stt_contract = VoiceServiceContract(
        service="stt",
        engine=settings.stt_provider,
        endpoint=settings.stt_url,
        transport="HTTP multipart/form-data sobre POST /inference (whisper.cpp server, solo 127.0.0.1)",
        docker_image="no requerido: binario local voice_build/whisper.cpp/build/bin/whisper-server",
        implemented_bridge=True,
        tested_in_runtime=True,
        available_now=stt_ok,
        status_detail=(
            f"{stt_detail}. Puente implementado en app/voice_bridge.py (STTHttpBridge): "
            "multipart en memoria, tope 10 MiB, timeout configurable, solo loopback, "
            "sin escritura de audio a disco ni logs. La llamada verificación de "
            "inferencia vive en results/VOICE_BRIDGE_INTEGRATION.md."
        ),
        contract_request={
            "content_type": "multipart/form-data (campo file, audio WAV/WEBM) | audio crudo",
            "max_bytes": 10_485_760,
            "fields": {"file": "audio binario en memoria", "response_format": "json", "language": "auto, es o en (selector de idioma)"},
        },
        contract_response={
            "text": "string (transcripción para revisión del usuario antes de enviar)",
            "language": "idioma reportado; auto solicita detección y es/en aplican la indicación del usuario",
            "language_source": "server_detected, user_hint o unavailable; no se infiere detección si falta en JSON",
            "requires_confirmation": True,
            "confirmed_by_user": False,
        },
    )

    tts_contract = VoiceServiceContract(
        service="tts",
        engine=settings.tts_provider,
        endpoint=settings.tts_url,
        transport="HTTP JSON sobre POST /tts (sidecar sherpa-onnx, solo 127.0.0.1)",
        docker_image="no requerido: proceso Python local deploy/voice/sidecar_tts.py",
        implemented_bridge=True,
        tested_in_runtime=True,
        available_now=tts_ok,
        status_detail=(
            f"{tts_detail}. Puente implementado en app/voice_bridge.py (TTSHttpBridge): "
            "JSON con tope de 500 caracteres, timeout configurable, solo loopback, "
            "WAV devuelto en memoria (cabecera X-Audio-Sample-Rate cuando el sidecar "
            "reporta WAV válido)."
        ),
        contract_request={
            "content_type": "application/json",
            "fields": {"text": "string (máx 500 caracteres)", "voice": "es_ES-davefx-medium", "format": "wav"},
        },
        contract_response={
            "content_type": "audio/wav",
            "sample_rate": "leído de la cabecera WAV en memoria (ver X-Audio-Sample-Rate)",
            "streamable": False,
        },
    )

    return [stt_contract, tts_contract]
