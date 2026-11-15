"""Tests del puente HTTP real a los sidecars locales de voz.

Cubre cada nivel del contrato de app/voice_bridge.py con sidecars HTTP
mock (http.server en 127.0.0.1, puerto efímero):
- STT: éxito, respuesta vacía, sidecar caído, límite de 10 MiB, audio vacío.
- TTS: éxito (con sample rate leído del WAV), límite de 500 chars,
  texto vacío, sidecar caído, cuerpo vacío.
- Config: solo loopback (http/https); tcp:// u host externo se rechazan.
- API: flags desactivados -> 409; flag activo sin puente -> 503; con
  puente mock -> 200/413/400/503 según el caso.

Nada de audio o texto de prueba se escribe a disco: los sidecars mock
mantienen todo en memoria.
"""

from __future__ import annotations

import io
import json
import threading
import wave
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app.config import AppSettings
from app.main import create_app
from app.voice_bridge import STTHttpBridge, TTSHttpBridge

STT_MAX_BYTES = 10 * 1024 * 1024
TTS_MAX_CHARS = 500


def settings(tmp_path, **overrides) -> AppSettings:
    project_root = Path("/home/bunuelo/Descargas/AstroTwin_")
    results_dir = tmp_path / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    base: dict = dict(
        project_root=project_root,
        data_root=Path("/home/bunuelo/Descargas/AstroTwin_datos"),
        results_dir=results_dir,
        prompts_dir=project_root / "prompts",
        web_dir=project_root / "web",
        llm_provider="ollama",
        llm_base_url="http://127.0.0.1:59999",
        llm_model="gemma3:1b",
        llm_timeout_seconds=1.0,
        stt_provider="whisper.cpp",
        stt_url="http://127.0.0.1:59998",
        tts_provider="sherpa-onnx",
        tts_url="http://127.0.0.1:59997",
        voice_timeout_seconds=2.0,
    )
    base.update(overrides)
    return AppSettings(**base)


def make_wav(sample_rate: int = 16000, frames: int = 16) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


class _Sidecar:
    """Servidor HTTP de 127.0.0.1 que imita whisper-server y el TTS sherpa-onnx."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, str, bytes]] = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args, **kwargs):  # pragma: no cover - silencio
                pass

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                self.server.requests.append((self.path, self.headers.get("Content-Type", ""), body))
                if self.path == "/inference":
                    # multipart: extraer el texto simulado guardado en el campo response_format
                    payload = json.dumps(self.server.response_payload).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                elif self.path == "/tts":
                    wav = make_wav()
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/wav")
                    self.send_header("Content-Length", str(len(wav)))
                    self.end_headers()
                    self.wfile.write(wav)
                else:
                    self.send_response(404)
                    self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.requests = self.requests
        self.server.response_payload = {"text": "pulso 88", "language": "es"}
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture()
def sidecar():
    s = _Sidecar()
    yield s
    s.close()


# ---------------------------------------------------------------- STT puente


def test_stt_bridge_sends_multipart_and_parses_json(sidecar) -> None:
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    result = bridge.transcribe(b"RIFFAUDIO", "audio/webm")
    assert result == {"text": "pulso 88", "language": "es", "language_source": "server_detected"}
    path, content_type, body = sidecar.requests[0]
    assert path == "/inference"
    assert content_type.startswith("multipart/form-data; boundary=")
    assert b'name="file"' in body and b"RIFFAUDIO" in body
    assert b"response_format" in body
    assert b'name="response_format"' in body
    assert b"\r\nverbose_json\r\n" in body
    assert b'name="detect_language"' not in body


def test_stt_bridge_sends_requested_language_for_bilingual_transcription(sidecar) -> None:
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    result = bridge.transcribe(b"RIFFAUDIO", "audio/wav", language="en")
    assert result is not None
    body = sidecar.requests[-1][2]
    assert b'name="language"' in body
    assert b"\r\nen\r\n" in body


def test_stt_bridge_uses_explicit_language_if_whisper_json_omits_language(sidecar) -> None:
    sidecar.server.response_payload = {"text": "My chest feels okay."}
    result = STTHttpBridge(sidecar.url(), timeout_seconds=2.0).transcribe(
        b"RIFFAUDIO", "audio/wav", language="en"
    )
    assert result == {
        "text": "My chest feels okay.",
        "language": "en",
        "language_source": "user_hint",
    }


def test_stt_bridge_rejects_oversize_before_http(sidecar) -> None:
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    assert bridge.transcribe(b"x" * (STT_MAX_BYTES + 1)) is None
    assert sidecar.requests == []  # no se envió nada


def test_stt_bridge_empty_audio_returns_none(sidecar) -> None:
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    assert bridge.transcribe(b"") is None
    assert sidecar.requests == []


def test_stt_bridge_sidecar_down_returns_none() -> None:
    # Puerto cerrado garantizado: 127.0.0.1:1 no escucha.
    bridge = STTHttpBridge("http://127.0.0.1:1", timeout_seconds=1.0)
    assert bridge.transcribe(b"RIFFAUDIO") is None


def test_stt_bridge_non_json_response_returns_none(sidecar) -> None:
    def handler(self):  # pragma: no cover - executed in thread
        self.send_response(500)
        self.end_headers()

    sidecar.server.RequestHandlerClass.do_POST = handler
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    assert bridge.transcribe(b"RIFFAUDIO") is None


# ---------------------------------------------------------------- TTS puente


def test_tts_bridge_posts_json_and_reads_wav_header(sidecar) -> None:
    bridge = TTSHttpBridge(sidecar.url(), timeout_seconds=2.0)
    result = bridge.synthesize("Pulso dentro de rango normal.")
    assert result is not None
    assert result["audio"] == make_wav()
    assert result["content_type"] == "audio/wav"
    assert result["sample_rate"] == 16000
    path, content_type, body = sidecar.requests[0]
    assert path == "/tts"
    assert json.loads(body) == {"text": "Pulso dentro de rango normal."}
    assert content_type == "application/json"


def test_tts_bridge_rejects_text_over_500_chars(sidecar) -> None:
    bridge = TTSHttpBridge(sidecar.url(), timeout_seconds=2.0)
    assert bridge.synthesize("a" * (TTS_MAX_CHARS + 1)) is None
    assert sidecar.requests == []


def test_tts_bridge_empty_text_returns_none(sidecar) -> None:
    bridge = TTSHttpBridge(sidecar.url(), timeout_seconds=2.0)
    assert bridge.synthesize("") is None
    assert sidecar.requests == []


def test_tts_bridge_sidecar_down_returns_none() -> None:
    bridge = TTSHttpBridge("http://127.0.0.1:1", timeout_seconds=1.0)
    assert bridge.synthesize("Hola") is None


def test_tts_bridge_non_wav_body_returns_none_sample_rate(sidecar) -> None:
    def handler(self):  # pragma: no cover
        payload = b"not-a-wav"
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    sidecar.server.RequestHandlerClass.do_POST = handler
    bridge = TTSHttpBridge(sidecar.url(), timeout_seconds=2.0)
    result = bridge.synthesize("Hola")
    assert result is not None and result["sample_rate"] is None


# ---------------------------------------------------------------- configuración


@pytest.mark.parametrize(
    "url",
    [
        "http://192.168.1.5:8081",
        "https://example.com/inference",
        "tcp://127.0.0.1:59998",
        "ftp://localhost",
    ],
)
def test_bridge_config_rejects_non_loopback_or_non_http(url: str) -> None:
    from app.voice_bridge import BridgeConfigError

    with pytest.raises(BridgeConfigError):
        STTHttpBridge(url, timeout_seconds=1.0)
    with pytest.raises(BridgeConfigError):
        TTSHttpBridge(url, timeout_seconds=1.0)


@pytest.mark.parametrize("url", ["http://127.0.0.1:8081", "http://localhost:8082"])
def test_bridge_config_accepts_loopback_http(url: str) -> None:
    assert STTHttpBridge(url, timeout_seconds=1.0).base_url == url


# ---------------------------------------------------------------- API con sidecar mock


def test_api_stt_roundtrip_with_mock_sidecar(tmp_path, sidecar) -> None:
    cfg = settings(
        tmp_path,
        stt_enabled=True,
        stt_url=sidecar.url(),
        stt_provider="whisper.cpp",
    )
    client = TestClient(create_app(cfg))
    resp = client.post(
        "/api/voice/stt",
        content=b"RIFFAUDIO",
        headers={"Content-Type": "audio/webm"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert body["implemented_bridge"] is True
    assert body["text"] == "pulso 88"
    assert body["requires_confirmation"] is True and body["confirmed_by_user"] is False
    assert body["bytes_received"] == len(b"RIFFAUDIO")


def test_api_stt_accepts_explicit_english_language(tmp_path, sidecar) -> None:
    cfg = settings(tmp_path, stt_enabled=True, stt_url=sidecar.url())
    client = TestClient(create_app(cfg))
    resp = client.post("/api/voice/stt?language=en", content=b"RIFFAUDIO", headers={"Content-Type": "audio/wav"})
    assert resp.status_code == 200
    assert resp.json()["language"] == "es"  # mock server fixture language is authoritative
    assert b'name="language"' in sidecar.requests[-1][2]
    assert b"\r\nen\r\n" in sidecar.requests[-1][2]


def test_api_stt_flag_off_returns_409(tmp_path) -> None:
    client = TestClient(create_app(settings(tmp_path)))
    resp = client.post("/api/voice/stt", content=b"RIFFAUDIO")
    assert resp.status_code == 409
    assert resp.json()["implemented_bridge"] is True


def test_api_stt_oversize_returns_413_even_with_flag_off(tmp_path) -> None:
    client = TestClient(create_app(settings(tmp_path)))
    resp = client.post("/api/voice/stt", content=b"x" * (STT_MAX_BYTES + 512))
    assert resp.status_code == 413


def test_api_stt_empty_body_returns_400(tmp_path, sidecar) -> None:
    cfg = settings(tmp_path, stt_enabled=True, stt_url=sidecar.url())
    client = TestClient(create_app(cfg))
    resp = client.post("/api/voice/stt", content=b"")
    assert resp.status_code == 400


def test_api_stt_sidecar_failure_returns_503(tmp_path) -> None:
    cfg = settings(
        tmp_path,
        stt_enabled=True,
        stt_url="http://127.0.0.1:1",
        stt_provider="whisper.cpp",
    )
    client = TestClient(create_app(cfg))
    resp = client.post("/api/voice/stt", content=b"RIFFAUDIO")
    assert resp.status_code == 503
    assert resp.json()["available"] is False


def test_api_tts_roundtrip_with_mock_sidecar(tmp_path, sidecar) -> None:
    cfg = settings(
        tmp_path,
        tts_enabled=True,
        tts_url=sidecar.url(),
        tts_provider="sherpa-onnx",
    )
    client = TestClient(create_app(cfg))
    resp = client.post("/api/voice/tts", json={"text": "Pulso dentro de rango normal."})
    assert resp.status_code == 200
    assert resp.headers["X-TTS-Engine"] == "sherpa-onnx-local"
    assert resp.headers["X-Audio-Sample-Rate"] == "16000"
    assert resp.headers["Content-Type"].startswith("audio/wav")
    assert resp.content == make_wav()


def test_api_tts_flag_off_returns_409(tmp_path) -> None:
    client = TestClient(create_app(settings(tmp_path)))
    resp = client.post("/api/voice/tts", json={"text": "Hola"})
    assert resp.status_code == 409
    assert resp.json()["implemented_bridge"] is True


def test_api_tts_over_500_chars_returns_422(tmp_path) -> None:
    client = TestClient(create_app(settings(tmp_path, tts_enabled=True)))
    resp = client.post("/api/voice/tts", json={"text": "a" * (TTS_MAX_CHARS + 1)})
    assert resp.status_code == 422


def test_api_tts_sidecar_failure_returns_503(tmp_path) -> None:
    cfg = settings(
        tmp_path,
        tts_enabled=True,
        tts_url="http://127.0.0.1:1",
        tts_provider="sherpa-onnx",
    )
    client = TestClient(create_app(cfg))
    resp = client.post("/api/voice/tts", json={"text": "Hola"})
    assert resp.status_code == 503


def test_settings_reject_non_loopback_sidecar_urls(tmp_path) -> None:
    with pytest.raises(Exception):
        AppSettings(
            project_root=tmp_path,
            data_root=tmp_path,
            results_dir=tmp_path,
            stt_enabled=True,
            stt_url="http://0.0.0.0:8081",
        )


@pytest.mark.parametrize(
    "bad_ct",
    [
        "audio/wav\r\nX-Injected: 1",
        "audio/wav\nX-Injected: 1",
        "audio/wav\rX-Injected: 1",
        "audio/wav\x00evil",
        "   ",
    ],
)
def test_stt_bridge_rejects_crlf_in_content_type(sidecar, bad_ct: str) -> None:
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    with pytest.raises(ValueError):
        bridge.transcribe(b"RIFFAUDIO", bad_ct)
    assert sidecar.requests == []


@pytest.mark.parametrize(
    "bad_filename",
    [
        'audio.wav"\r\nX-Injected: 1',
        "audio\n.wav",
        "audio\r.wav",
        "audio\x00.wav",
    ],
)
def test_stt_bridge_rejects_crlf_in_filename(sidecar, bad_filename: str) -> None:
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    with pytest.raises(ValueError):
        bridge.transcribe(b"RIFFAUDIO", "audio/wav", filename=bad_filename)
    assert sidecar.requests == []


def test_stt_bridge_escapes_quotes_and_backslashes_in_filename_and_field_names() -> None:
    body = STTHttpBridge._multipart_body(
        b"RIFFAUDIO",
        "audio/wav",
        filename='evil"; name="other\\file.wav',
        fields={'resp"onse': "json"},
        boundary="testboundary",
    )
    assert b'filename="evil\\"; name=\\"other\\\\file.wav"' in body
    assert b'name="resp\\"onse"' in body


@pytest.mark.parametrize(
    "bad_fields",
    [
        {"response_format\r\nX-Evil: 1": "json"},
        {"response_format": "json\r\n--testboundary\r\nX-Evil: 1"},
        {"response_format": "json\nnewline"},
        {"response_format": "json\x00nul"},
    ],
)
def test_stt_bridge_rejects_crlf_in_fields(sidecar, bad_fields: dict[str, str]) -> None:
    bridge = STTHttpBridge(sidecar.url(), timeout_seconds=2.0)
    with pytest.raises(ValueError):
        bridge.transcribe(b"RIFFAUDIO", "audio/wav", fields=bad_fields)
    assert sidecar.requests == []
