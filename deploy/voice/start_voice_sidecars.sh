#!/usr/bin/env bash
# Arranque de sidecars de voz offline (solo 127.0.0.1, sin audio en disco).
# Uso: bash deploy/voice/start_voice_sidecars.sh
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

MODEL_STT="${MODEL_STT:-voice_models/ggml-small-q5_1.bin}"
MODEL_VAD="${MODEL_VAD:-voice_models/ggml-silero-v6.2.0.bin}"
MODEL_TTS="${MODEL_TTS:-voice_models/sherpa-davefx/vits-piper-es_ES-davefx-medium/es_ES-davefx-medium.onnx}"
PORT_STT="${PORT_STT:-8081}"
PORT_TTS="${PORT_TTS:-8082}"
STT_THREADS="${STT_THREADS:-4}"
STT_LANGUAGE="${STT_LANGUAGE:-auto}"
VOICE_BIN_STT="${VOICE_BIN_STT:-voice_build/whisper.cpp/build/bin/whisper-server}"
VOICE_PYTHON="${VOICE_PYTHON:-.venv-voice/bin/python}"
RUNTIME_DIR="${VOICE_RUNTIME_DIR:-/tmp/astrotwin_voice_$(id -u)}"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

STT_PID_FILE="$RUNTIME_DIR/stt.pid"
TTS_PID_FILE="$RUNTIME_DIR/tts.pid"
STT_LOG="$RUNTIME_DIR/stt.log"
TTS_LOG="$RUNTIME_DIR/tts.log"

# Verificación de binarios y modelos antes de lanzar nada.
for req_file in "$VOICE_BIN_STT" "$VOICE_PYTHON" "deploy/voice/sidecar_tts.py" "$MODEL_STT" "$MODEL_VAD" "$MODEL_TTS"; do
  if [[ ! -e "$req_file" ]]; then
    echo "ERROR: falta artefacto requerido: $req_file" >&2
    exit 1
  fi
done

case "$STT_LANGUAGE" in
  auto|es|en) ;;
  *) echo "ERROR: STT_LANGUAGE debe ser auto, es o en" >&2; exit 2 ;;
esac

# Verificación de hashes antes de cargar (aborta si difieren del manifest).
# Las rutas del manifest son relativas a voice_models/: se verifica desde ahí.
(cd voice_models && sha256sum -c --quiet MANIFEST_SHA256.txt) \
  || { echo "ERROR: hash de pesos no coincide con voice_models/MANIFEST_SHA256.txt" >&2; exit 1; }

# Evitar colisión con sidecars ya activos o puertos ocupados.
"$VOICE_PYTHON" - "$PORT_STT" "$PORT_TTS" <<'PY'
import socket, sys
for port_s in sys.argv[1:]:
    port = int(port_s)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", port)) == 0:
            print(f"ERROR: el puerto 127.0.0.1:{port} ya está en uso", file=sys.stderr)
            sys.exit(1)
PY

STT_PID=""
TTS_PID=""

record_pid_identity() {
  local pid="$1"
  local role="$2"
  local marker="$3"
  local pid_file="$4"
  "$VOICE_PYTHON" - "$pid" "$role" "$marker" "$pid_file" <<'PY'
import json
import os
import sys
import time
from pathlib import Path

pid = int(sys.argv[1])
role = sys.argv[2]
marker = sys.argv[3]
pid_file = Path(sys.argv[4])

def read_identity(p: int) -> tuple[str, str] | None:
    try:
        stat_text = Path(f"/proc/{p}/stat").read_text(encoding="utf-8", errors="replace")
        rparen = stat_text.rfind(")")
        if rparen == -1:
            return None
        rest = stat_text[rparen + 2:].split()
        if len(rest) <= 19:
            return None
        starttime = rest[19]
        if not starttime:
            return None
        uids: list[int] = []
        for line in Path(f"/proc/{p}/status").read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("Uid:"):
                uids = [int(x) for x in line.split()[1:5]]
                break
        if os.getuid() not in uids:
            return None
        raw_cmd = Path(f"/proc/{p}/cmdline").read_bytes()
        cmdline = " ".join(arg.decode("utf-8", errors="replace") for arg in raw_cmd.split(b"\x00") if arg)
        return starttime, cmdline
    except OSError:
        return None

deadline = time.monotonic() + 2.0
ident = None
while time.monotonic() < deadline:
    res = read_identity(pid)
    if res is None:
        break
    if marker in res[1]:
        ident = res
        break
    time.sleep(0.02)

if ident is None:
    print(
        f"ERROR: no se pudo verificar identidad de '{role}' (PID {pid}) con marcador '{marker}'",
        file=sys.stderr,
    )
    sys.exit(1)

payload = {
    "pid": pid,
    "starttime": ident[0],
    "role": role,
    "marker": marker,
    "uid": os.getuid(),
}
pid_file.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
PY
}

safe_kill_verified() {
  local pid_file="$1"
  local fallback_pid="$2"
  local expected_marker="$3"
  "$VOICE_PYTHON" - "$pid_file" "$fallback_pid" "$expected_marker" <<'PY'
import json
import os
import signal
import sys
import time
from pathlib import Path

pid_file = Path(sys.argv[1])
fallback_pid = sys.argv[2].strip()
expected_marker = sys.argv[3]

pid = None
expected_start = None
if pid_file.is_file():
    try:
        meta = json.loads(pid_file.read_text(encoding="utf-8"))
        pid = int(meta["pid"])
        expected_start = str(meta["starttime"])
        expected_marker = str(meta.get("marker", expected_marker))
    except Exception:
        pid = None
elif fallback_pid.isdigit():
    pid = int(fallback_pid)

if not pid or pid <= 1:
    sys.exit(0)

def matches_process(p: int) -> bool:
    try:
        stat_text = Path(f"/proc/{p}/stat").read_text(encoding="utf-8", errors="replace")
        rparen = stat_text.rfind(")")
        if rparen == -1:
            return False
        rest = stat_text[rparen + 2:].split()
        if len(rest) <= 19:
            return False
        if expected_start is not None and rest[19] != expected_start:
            return False
        raw_cmd = Path(f"/proc/{p}/cmdline").read_bytes()
        cmdline = " ".join(arg.decode("utf-8", errors="replace") for arg in raw_cmd.split(b"\x00") if arg)
        if expected_marker not in cmdline:
            return False
        for line in Path(f"/proc/{p}/status").read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("Uid:"):
                uids = [int(x) for x in line.split()[1:3]]
                if os.getuid() not in uids:
                    return False
                break
        return True
    except OSError:
        return False

if not matches_process(pid):
    sys.exit(0)

try:
    os.kill(pid, signal.SIGTERM)
except OSError:
    sys.exit(0)

for _ in range(15):
    if not matches_process(pid):
        sys.exit(0)
    time.sleep(0.1)

if matches_process(pid):
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
PY
  if [[ -f "$pid_file" ]]; then
    rm -f "$pid_file"
  fi
}

cleanup_on_failure() {
  safe_kill_verified "$STT_PID_FILE" "${STT_PID:-}" "whisper-server" || true
  safe_kill_verified "$TTS_PID_FILE" "${TTS_PID:-}" "deploy/voice/sidecar_tts.py" || true
}

trap 'cleanup_on_failure' ERR

# STT: whisper.cpp v1.9.5 (CPU, 4 hilos) + Silero VAD, bind 127.0.0.1
"$VOICE_BIN_STT" \
  -m "$MODEL_STT" -l "$STT_LANGUAGE" --vad --vad-model "$MODEL_VAD" \
  --host 127.0.0.1 --port "$PORT_STT" -t "$STT_THREADS" \
  > "$STT_LOG" 2>&1 &
STT_PID=$!
if ! record_pid_identity "$STT_PID" "stt" "whisper-server" "$STT_PID_FILE"; then
  cleanup_on_failure
  exit 1
fi

# TTS: sherpa-onnx (Python stdlib HTTP), bind 127.0.0.1
"$VOICE_PYTHON" deploy/voice/sidecar_tts.py \
  --host 127.0.0.1 --port "$PORT_TTS" --model "$MODEL_TTS" \
  > "$TTS_LOG" 2>&1 &
TTS_PID=$!
if ! record_pid_identity "$TTS_PID" "tts" "deploy/voice/sidecar_tts.py" "$TTS_PID_FILE"; then
  cleanup_on_failure
  exit 1
fi

# Esperar readiness real de ambos sidecars (máx. 20 s).
if ! "$VOICE_PYTHON" - "$PORT_STT" "$PORT_TTS" "$STT_PID" "$TTS_PID" <<'PY'
import json
import os
import sys
import time
import urllib.error
import urllib.request

port_stt, port_tts, pid_stt, pid_tts = (int(x) for x in sys.argv[1:5])
deadline = time.monotonic() + 20.0

def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

def stt_ready() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port_stt}/", timeout=1.0) as r:
            return r.status == 200
    except urllib.error.HTTPError as e:
        return 200 <= e.code < 500
    except Exception:
        return False

def tts_ready() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port_tts}/health", timeout=1.0) as r:
            data = json.loads(r.read().decode("utf-8"))
            return r.status == 200 and bool(data.get("ok"))
    except Exception:
        return False

while time.monotonic() < deadline:
    if not pid_alive(pid_stt):
        print("ERROR: whisper-server terminó prematuramente", file=sys.stderr)
        sys.exit(1)
    if not pid_alive(pid_tts):
        print("ERROR: sidecar_tts.py terminó prematuramente", file=sys.stderr)
        sys.exit(1)
    if stt_ready() and tts_ready():
        sys.exit(0)
    time.sleep(0.2)

print("ERROR: timeout esperando readiness de sidecars de voz", file=sys.stderr)
sys.exit(1)
PY
then
  echo "--- Últimas líneas de $STT_LOG ---" >&2
  tail -n 20 "$STT_LOG" >&2 || true
  echo "--- Últimas líneas de $TTS_LOG ---" >&2
  tail -n 20 "$TTS_LOG" >&2 || true
  cleanup_on_failure
  exit 1
fi

trap - ERR

echo "STT_PID=$STT_PID TTS_PID=$TTS_PID"
echo "RUNTIME_DIR=$RUNTIME_DIR"
echo "STT http://127.0.0.1:$PORT_STT/inference"
echo "TTS http://127.0.0.1:$PORT_TTS/tts (health: /health)"
echo "Parar con: bash deploy/voice/stop_voice_sidecars.sh"
