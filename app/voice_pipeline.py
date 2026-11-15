"""Contrato mínimo del pipeline de voz offline (MVP).

Estados deterministas: push-to-talk -> transcripción local -> confirmación
explícita del texto -> respuesta. Los motores STT/TTS son locales y se
inyectan como puentes opcionales; sin puente activo el pipeline degrada a
modo texto honesto (nunca finge audio ni transcripción).

Garantías de privacidad del contrato: sin grabación en segundo plano (solo
mientras el botón está pulsado), sin subida de audio fuera del host y sin
aceptación de audio en los endpoints del pipeline de estados; los puentes
HTTP reales (app/voice_bridge.py) hablan solo con sidecars en 127.0.0.1.

Pila real instalada y medida (results/VOICE_RUNTIME_MEASURED.md): whisper.cpp
v1.9.5 (CPU) + Silero VAD en el puerto 8081 y sherpa-onnx 1.12.39 con voz
piper es_ES-davefx-medium (CC0) en el 8082. Puentes HTTP implementados y
probados en runtime el 2026-11-14; evidencia de integración en
results/VOICE_BRIDGE_INTEGRATION.md.
"""

from __future__ import annotations

import socket
import uuid
from typing import Any, Literal, Protocol
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

from app.config import AppSettings
from app.safety import is_emergency

VOICE_STATES = (
    "idle",
    "mic_permission_required",
    "recording",
    "text_fallback",
    "awaiting_confirmation",
    "confirmed",
    "emergency_escalation",
    "cancelled",
)

VOICE_ACTIONS = (
    "start_push_to_talk",
    "stop_push_to_talk",
    "confirm_transcript",
    "cancel",
)

MAX_PTT_SECONDS = 15

_RESEARCHED_ENGINES = {
    "stt": {
        "recommended": "whisper.cpp + ggml-small-q5_1.bin (-l es)",
        "fallback": "whisper.cpp + ggml-base.bin",
        "license_reported": "MIT",
        "source": "results/VOICE_QA_RESEARCH.md (Antigravity); checksums reportados, no verificados localmente",
    },
    "vad": {
        "recommended": "silero-vad ggml-silero-v6.2.0.bin / silero_vad.onnx",
        "license_reported": "MIT",
        "forbidden": "torch.hub.load y ficheros .pt/.jit pickle (riesgo RCE y RAM)",
        "source": "results/VOICE_QA_RESEARCH.md (Antigravity)",
    },
    "tts": {
        "recommended": "sherpa-onnx + piper-voices es_ES-davefx-medium.onnx (CC0)",
        "alternative": "piper CLI solo como subproceso aislado (shell=False) por GPL-3.0+ de espeak-ng",
        "license_reported": "sherpa-onnx Apache-2.0; verificar MODEL_CARD de cada voz",
        "source": "results/VOICE_QA_RESEARCH.md (Antigravity)",
    },
}


class STTBridge(Protocol):
    """Puente opcional a un proceso STT local; devuelve None si falla."""

    def transcribe(self, audio_ref: str) -> dict[str, str] | None:
        """Devuelve {'text': ..., 'language': 'es'} o None."""
        ...


class TTSBridge(Protocol):
    """Puente opcional a un proceso TTS local; devuelve None si falla."""

    def synthesize(self, text: str) -> dict[str, Any] | None:
        """Devuelve {'content_type': 'audio/wav', 'sample_rate': ...} o None."""
        ...


class VoiceTranscript(BaseModel):
    """Transcripción local que exige confirmación explícita del usuario."""

    text: str = Field(..., min_length=1, max_length=1000)
    language: str = "es"
    source: Literal["stt_bridge", "text_fallback"]
    confirmed_by_user: bool = False
    requires_confirmation: Literal[True] = True


class VoiceActionRequest(BaseModel):
    """Solicitud de transición del pipeline; nunca incluye audio."""

    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=6, max_length=64)
    action: Literal[
        "start_push_to_talk", "stop_push_to_talk", "confirm_transcript", "cancel"
    ]
    mic_permission_granted: bool = False
    transcript_text: str | None = Field(default=None, max_length=1000)
    language: Literal["es", "en"] = "es"
    confirmed: bool = False


class VoicePipelineContract(BaseModel):
    """Descripción estática del contrato de voz (privacy + estados + flags)."""

    enabled: bool
    privacy: dict[str, Any]
    stages: list[dict[str, Any]]
    feature_flags: dict[str, bool]
    engines: dict[str, Any]
    states: list[str] = list(VOICE_STATES)
    sidecars: dict[str, Any] = Field(default_factory=dict)


def build_voice_contract(settings: AppSettings) -> VoicePipelineContract:
    """Contrato determinista; describe lo implementado y lo pendiente sin fingir."""
    return VoicePipelineContract(
        enabled=settings.voice_enabled,
        privacy={
            "no_background_recording": True,
            "recording_only_while_push_to_talk_active": True,
            "hard_teardown_on_release_cancel_unmount": True,
            "max_recording_seconds": MAX_PTT_SECONDS,
            "no_audio_upload": True,
            "audio_never_leaves_host": True,
            "audio_written_to_disk": False,
            "audio_accepted_by_pipeline_endpoints": False,
            "max_bytes_for_optional_local_stt_bridge": 10_485_760,
            "tts_cancellation": "Escape o botón Detener interrumpe la reproducción; un nuevo PTT la interrumpe.",
        },
        stages=[
            {
                "stage": "push_to_talk",
                "detail": "Grabación solo mientras el usuario mantiene pulsado; "
                "permiso de micrófono comprobado antes de grabar.",
            },
            {
                "stage": "local_transcription",
                "detail": "STT local opcional tras feature flag; sin puente activo "
                "se devuelve modo texto honesto (text_fallback).",
            },
            {
                "stage": "transcript_confirmation",
                "detail": "El texto transcrito exige confirmación explícita antes de "
                "ejecutar cualquier acción; sin confirmación no se ejecuta nada.",
            },
            {
                "stage": "reply",
                "detail": "Respuesta del copiloto; TTS local opcional tras feature "
                "flag; sin TTS la respuesta queda en modo texto.",
            },
            {
                "stage": "cancel_or_interrupt",
                "detail": "Cancelar descarta transcript y grabación; iniciar un nuevo "
                "push-to-talk interrumpe el turno anterior.",
            },
        ],
        feature_flags={
            "voice_enabled": settings.voice_enabled,
            "stt_enabled": settings.stt_enabled,
            "vad_enabled": settings.vad_enabled,
            "tts_enabled": settings.tts_enabled,
        },
        engines={
            "configured": {
                "stt": {
                    "provider": settings.stt_provider,
                    "endpoint": settings.stt_url,
                    "implemented_bridge": settings.stt_enabled,
                    "bridge_module": "app/voice_bridge.py (STTHttpBridge, solo loopback)",
                    "tested_in_runtime": True,
                },
                "vad": {
                    "provider": "silero-vad integrado en whisper-server (--vad)",
                    "implemented": settings.vad_enabled,
                    "note": "VAD se ejecuta dentro del sidecar STT, no en la API.",
                },
                "tts": {
                    "provider": settings.tts_provider,
                    "endpoint": settings.tts_url,
                    "implemented_bridge": settings.tts_enabled,
                    "bridge_module": "app/voice_bridge.py (TTSHttpBridge, solo loopback)",
                    "tested_in_runtime": True,
                },
            },
            "research_recommended": _RESEARCHED_ENGINES,
            "research_status": (
                "Recomendación documentada de results/VOICE_QA_RESEARCH.md. Pila real "
                "instalada y medida: whisper.cpp v1.9.5 (CPU) + Silero VAD y sherpa-onnx "
                "1.12.39; ver results/VOICE_RUNTIME_MEASURED.md. Puentes HTTP locales "
                "implementados (app/voice_bridge.py) y probados con sidecar real; UI "
                "push-to-talk en web/ con micrófono simulado en Playwright (captura "
                "humana real de micrófono aún sin verificar con personas)."
            ),
        },
        sidecars=probe_voice_sidecars(settings),
    )


def _probe_local(url: str, timeout: float) -> tuple[bool, str]:
    """Sondeo TCP solo-lectura de un sidecar local (127.0.0.1 esperado)."""
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 80
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"Sidecar accesible en {host}:{port}"
    except OSError as exc:
        return False, f"Sidecar no activo en {host}:{port} ({type(exc).__name__})"


def probe_voice_sidecars(settings: AppSettings) -> dict[str, Any]:
    """Disponibilidad real (sondeo) de los sidecars STT/TTS configurados.

    Un sidecar accesible NO significa transcripción/síntesis verificada:
    solo indica que el proceso local responde en su puerto.
    """
    stt_ok, stt_detail = _probe_local(settings.stt_url, settings.voice_timeout_seconds)
    tts_ok, tts_detail = _probe_local(settings.tts_url, settings.voice_timeout_seconds)
    return {
        "stt": {
            "reachable": stt_ok,
            "endpoint": settings.stt_url,
            "detail": stt_detail,
            "inference_verified_by_probe": False,
        },
        "tts": {
            "reachable": tts_ok,
            "endpoint": settings.tts_url,
            "detail": tts_detail,
            "inference_verified_by_probe": False,
        },
    }


class VoiceSession:
    """Máquina de estados determinista de un turno de voz."""

    def __init__(
        self,
        settings: AppSettings,
        stt_bridge: STTBridge | None = None,
        tts_bridge: TTSBridge | None = None,
    ) -> None:
        self.settings = settings
        self.stt_bridge = stt_bridge
        self.tts_bridge = tts_bridge
        self.session_id = uuid.uuid4().hex
        self.state: str = "idle"
        self.recording = False
        self.transcript: VoiceTranscript | None = None
        self.reply: dict[str, Any] | None = None
        self.interrupted_previous_turn = False

    # -- push-to-talk ------------------------------------------------------
    def start_push_to_talk(self, mic_permission_granted: bool) -> dict[str, Any]:
        if not mic_permission_granted:
            self.state = "mic_permission_required"
            self.recording = False
            self.transcript = None
            return {
                "state": self.state,
                "recording": False,
                "reason": (
                    "Permiso de micrófono concedido por el usuario es obligatorio; "
                    "no se inicia grabación ni se solicita en segundo plano."
                ),
            }
        if self.state in ("awaiting_confirmation", "confirmed", "emergency_escalation"):
            self.interrupted_previous_turn = True
            self.transcript = None
        self.state = "recording"
        self.recording = True
        return {
            "state": self.state,
            "recording": True,
            "note": (
                "Grabando solo mientras el botón esté pulsado; el audio no sale "
                "del host y no hay grabación en segundo plano."
            ),
            "interrupted_previous_turn": self.interrupted_previous_turn,
        }

    # -- transcripción local ------------------------------------------------
    def stop_push_to_talk(
        self,
        transcript_text: str | None = None,
        language_hint: str = "es",
    ) -> dict[str, Any]:
        """Al soltar el botón la grabación se detiene siempre (sin segundo plano).

        Si hay puente STT activo y sin texto pre-cargado, consulta el proceso
        local; un puente ausente o que falle degrada a modo texto honesto.
        """
        self.recording = False
        if not transcript_text:
            if self.stt_bridge is None or not self.settings.stt_enabled:
                self.state = "text_fallback"
                self.transcript = None
                return {
                    "state": self.state,
                    "recording": False,
                    "transcript": None,
                    "reason": (
                        "Puente STT local no activo (feature flag o proceso ausente). "
                        "No se simula transcripción: escriba su consulta en modo texto. "
                        "El modo texto usa las mismas guardas de seguridad."
                    ),
                }
            bridge_result = self.stt_bridge.transcribe("local_ptt_buffer")
            if not isinstance(bridge_result, dict) or not str(
                bridge_result.get("text", "")
            ).strip():
                self.state = "text_fallback"
                self.transcript = None
                return {
                    "state": self.state,
                    "recording": False,
                    "transcript": None,
                    "reason": (
                        "El proceso STT local no devolvió texto; modo texto honesto."
                    ),
                }
            transcript_text = str(bridge_result["text"])
            detected_language = str(bridge_result.get("language", language_hint)).lower()
            language = "en" if detected_language.startswith("en") else "es"
            source: Literal["stt_bridge", "text_fallback"] = "stt_bridge"
        else:
            language = "en" if language_hint == "en" else "es"
            source = "text_fallback"
        if not transcript_text.strip():
            self.state = "text_fallback"
            self.transcript = None
            return {
                "state": self.state,
                "recording": False,
                "transcript": None,
                "reason": "El proceso STT local no devolvió texto; modo texto honesto.",
            }
        self.transcript = VoiceTranscript(
            text=transcript_text.strip()[:1000],
            language=language,
            source=source,
            confirmed_by_user=False,
        )
        if is_emergency(self.transcript.text):
            self.state = "emergency_escalation"
            self.reply = emergency_reply(self.transcript.language)
            return {
                "state": self.state,
                "recording": False,
                "transcript": self.transcript.model_dump(),
                "reply": self.reply,
                "reason": (
                    "Bandera roja de emergencia detectada en el audio transcrito: "
                    "bypass determinista, sin diagnóstico, sin dosis y sin acciones."
                ),
            }
        self.state = "awaiting_confirmation"
        return {
            "state": self.state,
            "recording": False,
            "transcript": self.transcript.model_dump(),
            "reason": (
                "Confirme explícitamente la transcripción antes de ejecutar "
                "cualquier acción."
            ),
        }

    # -- confirmación explícita --------------------------------------------
    def confirm_transcript(self, confirmed: bool) -> dict[str, Any]:
        if self.transcript is None or self.state != "awaiting_confirmation":
            self.state = "idle"
            return {
                "state": self.state,
                "accepted": False,
                "reason": (
                    "No hay transcripción pendiente de confirmación; ninguna acción "
                    "se ejecutó."
                ),
            }
        if not confirmed:
            self.transcript = None
            self.state = "cancelled"
            return {
                "state": self.state,
                "accepted": False,
                "reason": "Transcripción rechazada por el usuario; no se ejecutó nada.",
            }
        self.transcript.confirmed_by_user = True
        self.state = "confirmed"
        return {
            "state": self.state,
            "accepted": True,
            "transcript": self.transcript.model_dump(),
            "reason": (
                "Transcripción confirmada explícitamente; solo ahora puede enviarse "
                "a /api/chat con las mismas guardas de seguridad."
            ),
        }

    # -- cancelación / interrupción -----------------------------------------
    def cancel(self) -> dict[str, Any]:
        self.recording = False
        self.transcript = None
        self.state = "cancelled"
        return {
            "state": self.state,
            "recording": False,
            "transcript": None,
            "reason": "Turno cancelado; grabación detenida y transcripción descartada.",
        }

    # -- respuesta (TTS opcional / texto honesto) ----------------------------
    def synthesize_reply(
        self, reply_text: str, llm_available: bool
    ) -> dict[str, Any]:
        """Compone la respuesta en modo texto u TTS local opcional.

        Nunca afirma que hay audio si no existe un puente TTS activo, y nunca
        atribuye a un LLM una respuesta generada por reglas.
        """
        base = {
            "text": reply_text,
            "llm_available": llm_available,
            "mode": "llm_text" if llm_available else "rules_text_fallback",
        }
        if self.tts_bridge is None or not self.settings.tts_enabled:
            base.update(
                {
                    "tts": {
                        "available": False,
                        "mode": "text_only",
                        "reason": (
                            "Puente TTS local no activo (feature flag o proceso "
                            "ausente); la respuesta se muestra como texto."
                        ),
                    }
                }
            )
            self.state = "text_fallback" if not llm_available else self.state
            return base
        audio = self.tts_bridge.synthesize(reply_text)
        if audio is None:
            base.update(
                {
                    "tts": {
                        "available": False,
                        "mode": "text_only",
                        "reason": "El proceso TTS local no devolvió audio; modo texto.",
                    }
                }
            )
            return base
        base.update({"tts": {"available": True, "mode": "audio", **audio}})
        return base


def emergency_reply(language: str = "es") -> dict[str, Any]:
    """Escalamiento inmediato determinista para banderas rojas por voz."""
    from app.safety import EMERGENCY_ANSWER_EN, EMERGENCY_ANSWER_ES, EMERGENCY_SAFETY_NOTE

    return {
        "text": EMERGENCY_ANSWER_EN if language == "en" else EMERGENCY_ANSWER_ES,
        "llm_available": False,
        "mode": "emergency_escalation",
        "citations": [],
        "proposed_actions": [],
        "safety_note": EMERGENCY_SAFETY_NOTE,
    }
