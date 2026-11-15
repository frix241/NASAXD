"""Puentes HTTP reales a los sidecars locales de voz (STT y TTS).

STT: POST multipart a `whisper-server` (whisper.cpp) en /inference.
TTS: POST JSON al sidecar sherpa-onnx en /tts; respuesta WAV.

Garantías:
- Solo loopback: se rechaza cualquier URL cuyo host no sea 127.0.0.1,
  localhost o ::1 (el audio del usuario no viaja fuera del host).
- Entrada y salida en memoria: nada de audio ni texto se escribe a disco
  y nada de su contenido se registra en logs.
- Límite de tamaño para STT (10 MiB) y de caracteres para TTS (500).
- Timeout configurable; cualquier fallo devuelve None (degradación honesta)
  y el endpoint traduce a un error HTTP descriptivo.
"""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
import uuid
import wave
from urllib.parse import urlparse

STT_MAX_BYTES = 10_485_760  # 10 MiB
TTS_MAX_CHARS = 500

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

_STT_BOUNDARY = uuid.uuid4().hex
_FORBIDDEN_HEADER_CHARS = ("\r", "\n", "\x00")


def _reject_crlf(value: str, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} debe ser str.")
    if any(ch in value for ch in _FORBIDDEN_HEADER_CHARS):
        raise ValueError(f"{label} contiene caracteres de control/CRLF no permitidos.")
    return value


def _escape_quoted_param(value: str, label: str) -> str:
    clean = _reject_crlf(value, label)
    return clean.replace("\\", "\\\\").replace('"', '\\"')


class BridgeConfigError(ValueError):
    """URL de sidecar no local: el puente se niega a enviar audio fuera del host."""


def require_loopback_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BridgeConfigError(
            f"Esquema de sidecar no soportado ({parsed.scheme!r}); se requiere HTTP local."
        )
    host = (parsed.hostname or "").lower()
    if host not in _LOOPBACK_HOSTS:
        raise BridgeConfigError(
            f"Host de sidecar no permitido ({host!r}): el puente solo habla con 127.0.0.1/localhost."
        )
    return url.rstrip("/")


class STTHttpBridge:
    """Puente STT: multipart in-memory -> whisper-server -> transcripción."""

    def __init__(self, url: str, timeout_seconds: float, max_bytes: int = STT_MAX_BYTES) -> None:
        self.base_url = require_loopback_url(url)
        self.timeout_seconds = timeout_seconds
        self.max_bytes = max_bytes

    def transcribe(
        self,
        audio: bytes,
        content_type: str = "audio/webm",
        filename: str = "audio.bin",
        fields: dict[str, str] | None = None,
        language: str = "auto",
    ) -> dict[str, str] | None:
        """Devuelve {'text', 'language'} o None si el sidecar falla o no transcribe."""
        if language not in {"auto", "es", "en"}:
            raise ValueError("language debe ser auto, es o en.")
        request_fields = {
            "response_format": "verbose_json" if language == "auto" else "json",
            "language": language,
        }
        if fields:
            request_fields.update(fields)
        boundary = uuid.uuid4().hex
        if not audio or len(audio) > self.max_bytes:
            # Validar metadatos aunque no se envíe audio para rechazar inyección CRLF temprano.
            self._validate_multipart_params(content_type, filename, request_fields, boundary)
            return None
        body = self._multipart_body(
            audio,
            content_type,
            filename=filename,
            fields=request_fields,
            boundary=boundary,
        )
        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        }
        try:
            with urllib.request.urlopen(
                urllib.request.Request(
                    f"{self.base_url}/inference",
                    data=body,
                    headers=headers,
                    method="POST",
                ),
                timeout=self.timeout_seconds,
            ) as resp:
                payload = json.loads(resp.read().decode("utf-8", errors="replace"))
        except (OSError, ValueError, urllib.error.URLError):
            return None
        text = str(payload.get("text", "")).strip()
        if not text:
            return None
        detected_language = payload.get("detected_language") or payload.get("language")
        if detected_language:
            language_result = str(detected_language).strip().lower()
            language_result = {
                "english": "en",
                "spanish": "es",
            }.get(language_result, language_result)
            language_source = "server_detected"
        elif language != "auto":
            # Plain whisper.cpp JSON omits language unless detection was requested.
            language_result = language
            language_source = "user_hint"
        else:
            language_result = "unknown"
            language_source = "unavailable"
        return {
            "text": text,
            "language": language_result,
            "language_source": language_source,
        }

    @staticmethod
    def _validate_multipart_params(
        content_type: str,
        filename: str,
        fields: dict[str, str] | None,
        boundary: str,
    ) -> tuple[str, str, dict[str, str], str]:
        clean_boundary = _reject_crlf(boundary, "boundary")
        if not clean_boundary:
            raise ValueError("boundary vacío.")
        clean_ct = _reject_crlf(content_type, "content_type").strip()
        if not clean_ct:
            raise ValueError("content_type vacío.")
        safe_filename = _escape_quoted_param(filename, "filename")
        if not safe_filename:
            raise ValueError("filename vacío.")
        effective_fields = {"response_format": "json"} if fields is None else fields
        safe_fields: dict[str, str] = {}
        for key, val in effective_fields.items():
            safe_key = _escape_quoted_param(key, "field name")
            if not safe_key:
                raise ValueError("field name vacío.")
            clean_val = _reject_crlf(val, f"field[{key!r}]")
            if f"--{clean_boundary}" in clean_val:
                raise ValueError(f"field[{key!r}] contiene secuencia boundary prohibida.")
            safe_fields[safe_key] = clean_val
        return clean_ct, safe_filename, safe_fields, clean_boundary

    @classmethod
    def _multipart_body(
        cls,
        audio: bytes,
        content_type: str,
        filename: str = "audio.bin",
        fields: dict[str, str] | None = None,
        boundary: str | None = None,
    ) -> bytes:
        active_boundary = boundary if boundary is not None else _STT_BOUNDARY
        clean_ct, safe_filename, safe_fields, clean_boundary = cls._validate_multipart_params(
            content_type, filename, fields, active_boundary
        )
        parts: list[bytes] = [
            (
                f"--{clean_boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{safe_filename}"\r\n'
                f"Content-Type: {clean_ct}\r\n\r\n"
            ).encode("utf-8"),
            audio,
            b"\r\n",
        ]
        for safe_key, clean_val in safe_fields.items():
            parts.append(
                (
                    f"--{clean_boundary}\r\n"
                    f'Content-Disposition: form-data; name="{safe_key}"\r\n\r\n'
                    f"{clean_val}\r\n"
                ).encode("utf-8")
            )
        parts.append(f"--{clean_boundary}--\r\n".encode("utf-8"))
        return b"".join(parts)


class TTSHttpBridge:
    """Puente TTS: texto (<= 500 chars) -> sidecar sherpa-onnx -> WAV en memoria."""

    def __init__(self, url: str, timeout_seconds: float, max_chars: int = TTS_MAX_CHARS) -> None:
        self.base_url = require_loopback_url(url)
        self.timeout_seconds = timeout_seconds
        self.max_chars = max_chars

    def synthesize(self, text: str) -> dict[str, object] | None:
        """Devuelve {'audio': bytes, 'content_type', 'sample_rate'} o None si falla."""
        if not text or len(text) > self.max_chars:
            return None
        payload = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Content-Length": str(len(payload))}
        try:
            with urllib.request.urlopen(
                urllib.request.Request(
                    f"{self.base_url}/tts",
                    data=payload,
                    headers=headers,
                    method="POST",
                ),
                timeout=self.timeout_seconds,
            ) as resp:
                content_type = resp.headers.get("Content-Type", "audio/wav")
                audio = resp.read()
        except (OSError, ValueError, urllib.error.URLError):
            return None
        if not audio:
            return None
        sample_rate = self._wav_sample_rate(audio)
        return {"audio": audio, "content_type": content_type, "sample_rate": sample_rate}

    @staticmethod
    def _wav_sample_rate(audio: bytes) -> int | None:
        """Lee el sample rate de la cabecera WAV en memoria; None si no es WAV."""
        try:
            with wave.open(io.BytesIO(audio), "rb") as wav:
                return wav.getframerate()
        except (wave.Error, EOFError, OSError, ValueError):
            return None
