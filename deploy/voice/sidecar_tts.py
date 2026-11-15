#!/usr/bin/env python3
"""Sidecar TTS local (sherpa-onnx + voz piper es_ES CC0).

Servidor HTTP mínimo (stdlib, sin dependencias web) que solo escucha en
127.0.0.1/localhost/::1 y sintetiza voz offline devolviendo WAV en memoria
(sin escribir audio a disco). Debe ejecutarse con el venv de voz:

    .venv-voice/bin/python deploy/voice/sidecar_tts.py \
        --port 8082 \
        --model voice_models/sherpa-davefx/vits-piper-es_ES-davefx-medium/es_ES-davefx-medium.onnx

Seguridad: solo loopback, sin audio persistente, sin telemetría ni logs con
contenido de usuario, límite de bytes en cuerpo HTTP y de 500 caracteres por
petición, y respuestas 4xx JSON deterministas ante entradas malformadas.
"""

from __future__ import annotations

import argparse
import array
import io
import json
import signal
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import sherpa_onnx

MAX_TEXT_CHARS = 500
DEFAULT_MAX_BODY_BYTES = 10_000
MAX_ALLOWED_BODY_BYTES = 65_536
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

_tts: sherpa_onnx.OfflineTts | None = None
_tts_lock = threading.Lock()
_max_body_bytes = DEFAULT_MAX_BODY_BYTES


def validate_loopback_host(host: str) -> str:
    normalized = host.strip().lower()
    if normalized not in LOOPBACK_HOSTS:
        raise ValueError(
            f"Host no permitido ({host!r}): el sidecar TTS solo puede escuchar en loopback (127.0.0.1, localhost, ::1)."
        )
    return host.strip()


def build_tts(model_path: str) -> sherpa_onnx.OfflineTts:
    model_file = Path(model_path).resolve()
    if not model_file.is_file():
        raise FileNotFoundError(f"Modelo TTS no encontrado: {model_file}")
    model_dir = model_file.parent
    tokens_file = model_dir / "tokens.txt"
    data_dir = model_dir / "espeak-ng-data"
    if not tokens_file.is_file():
        raise FileNotFoundError(f"tokens.txt no encontrado junto al modelo: {tokens_file}")
    if not data_dir.is_dir():
        raise FileNotFoundError(f"espeak-ng-data no encontrado junto al modelo: {data_dir}")

    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(model_file),
                tokens=str(tokens_file),
                data_dir=str(data_dir),
            ),
        ),
    )
    tts = sherpa_onnx.OfflineTts(config)
    if tts.sample_rate is None or int(tts.sample_rate) <= 0:
        raise RuntimeError("sherpa-onnx no reportó sample rate válido del modelo")
    return tts


def synthesize_wav_bytes(text: str, tts: sherpa_onnx.OfflineTts | None = None) -> bytes:
    engine = tts if tts is not None else _tts
    if engine is None:
        raise RuntimeError("Motor TTS no inicializado")
    with _tts_lock:
        audio = engine.generate(text, sid=0, speed=1.0)
        sample_rate = int(engine.sample_rate)
    pcm16 = array.array(
        "h", (max(-32768, min(32767, int(s * 32767))) for s in audio.samples)
    )
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm16.tobytes())
    return buffer.getvalue()


class LocalThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 16


class Handler(BaseHTTPRequestHandler):
    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(10.0)

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "ok": _tts is not None,
                    "engine": "sherpa-onnx",
                    "offline": True,
                    "sample_rate": int(_tts.sample_rate) if _tts is not None else None,
                },
            )
            return
        self._send_json(404, {"error": "Ruta no encontrada"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/tts":
            self._send_json(404, {"error": "Ruta no encontrada"})
            return

        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            self._send_json(400, {"error": "Transfer-Encoding chunked no soportado"})
            return

        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            self._send_json(411, {"error": "Content-Length requerido"})
            return
        try:
            length = int(raw_length)
        except ValueError:
            self._send_json(400, {"error": "Content-Length inválido"})
            return
        if length <= 0:
            self._send_json(400, {"error": "Cuerpo vacío"})
            return
        if length > _max_body_bytes:
            self._send_json(413, {"error": "Payload demasiado grande"})
            return

        raw_body = self.rfile.read(length)
        if len(raw_body) != length:
            self._send_json(400, {"error": "Cuerpo HTTP incompleto"})
            return

        try:
            decoded = raw_body.decode("utf-8", errors="strict")
            payload = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "JSON UTF-8 inválido"})
            return

        if not isinstance(payload, dict):
            self._send_json(400, {"error": "El cuerpo debe ser un objeto JSON"})
            return

        raw_text = payload.get("text")
        if not isinstance(raw_text, str):
            self._send_json(400, {"error": "El campo 'text' debe ser una cadena"})
            return
        if "\x00" in raw_text:
            self._send_json(400, {"error": "El texto contiene bytes nulos"})
            return

        text = raw_text.strip()
        if not text:
            self._send_json(400, {"error": "Texto vacío"})
            return
        if len(text) > MAX_TEXT_CHARS:
            self._send_json(400, {"error": f"Texto supera {MAX_TEXT_CHARS} caracteres"})
            return

        try:
            wav_bytes = synthesize_wav_bytes(text)
        except Exception:
            self._send_json(500, {"error": "Error interno al sintetizar audio"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav_bytes)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(wav_bytes)

    def log_message(self, fmt: str, *args: object) -> None:
        return  # sin logs con contenido de usuario


def main() -> None:
    parser = argparse.ArgumentParser(description="Sidecar TTS local offline")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--model", required=True)
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BODY_BYTES)
    args = parser.parse_args()

    try:
        host = validate_loopback_host(args.host)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(2)

    if args.max_bytes <= 0 or args.max_bytes > MAX_ALLOWED_BODY_BYTES:
        print(
            f"ERROR: --max-bytes debe estar entre 1 y {MAX_ALLOWED_BODY_BYTES}",
            file=sys.stderr,
        )
        sys.exit(2)

    global _tts, _max_body_bytes
    _max_body_bytes = args.max_bytes
    _tts = build_tts(args.model)

    server = LocalThreadingHTTPServer((host, args.port), Handler)

    def _request_shutdown(signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)

    print(f"sidecar TTS escuchando en {host}:{args.port} (solo localhost)", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
