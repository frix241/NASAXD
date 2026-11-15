#!/usr/bin/env bash
# Detiene de forma segura los sidecars de voz verificando identidad (PID, starttime, cmdline, UID).
# Uso: bash deploy/voice/stop_voice_sidecars.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

RUNTIME_DIR="${VOICE_RUNTIME_DIR:-/tmp/astrotwin_voice_$(id -u)}"
VOICE_PYTHON="${VOICE_PYTHON:-.venv-voice/bin/python}"
if [[ ! -x "$VOICE_PYTHON" ]]; then
  VOICE_PYTHON="$(command -v python3)"
fi

"$VOICE_PYTHON" - "$RUNTIME_DIR" <<'PY'
import json
import os
import signal
import sys
import time
from pathlib import Path

runtime_dir = Path(sys.argv[1])
EXPECTED_ROLES = {
    "stt": "whisper-server",
    "tts": "deploy/voice/sidecar_tts.py",
}

def read_proc_identity(pid: int) -> tuple[str, str, list[int]] | None:
    proc = Path(f"/proc/{pid}")
    if not proc.exists():
        return None
    try:
        stat_text = (proc / "stat").read_text(encoding="utf-8", errors="replace")
        rparen = stat_text.rfind(")")
        if rparen == -1:
            return None
        rest = stat_text[rparen + 2:].split()
        if len(rest) <= 19:
            return None
        starttime = rest[19]
        raw_cmd = (proc / "cmdline").read_bytes()
        cmdline = " ".join(arg.decode("utf-8", errors="replace") for arg in raw_cmd.split(b"\x00") if arg)
        uids: list[int] = []
        for line in (proc / "status").read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("Uid:"):
                uids = [int(x) for x in line.split()[1:5]]
                break
        return starttime, cmdline, uids
    except OSError:
        return None

errors = 0

for role, default_marker in EXPECTED_ROLES.items():
    pid_file = runtime_dir / f"{role}.pid"
    if not pid_file.exists():
        continue

    try:
        meta = json.loads(pid_file.read_text(encoding="utf-8"))
        if not isinstance(meta, dict):
            raise ValueError("formato no objeto")
        pid = int(meta["pid"])
        starttime = str(meta["starttime"])
        meta_role = str(meta.get("role", ""))
        marker = str(meta.get("marker", ""))
        uid = int(meta["uid"])
        if pid <= 1 or not starttime or meta_role != role or uid != os.getuid() or default_marker not in marker:
            raise ValueError("metadatos inválidos")
    except Exception as exc:
        print(
            f"ERROR: archivo PID inválido o sin identidad verificable ({pid_file}): {exc}; abortando sin enviar señal",
            file=sys.stderr,
        )
        errors += 1
        continue

    ident = read_proc_identity(pid)
    if ident is None:
        # Proceso ya no existe: limpiar archivo PID obsoleto.
        pid_file.unlink(missing_ok=True)
        continue

    cur_start, cur_cmd, cur_uids = ident
    if cur_start != starttime or default_marker not in cur_cmd or os.getuid() not in cur_uids:
        print(
            f"ERROR: PID {pid} en {pid_file} no coincide con sidecar AstroTwin '{role}' "
            f"(starttime/cmdline/uid distintos); abortando sin enviar señal",
            file=sys.stderr,
        )
        errors += 1
        continue

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pid_file.unlink(missing_ok=True)
        continue

    for _ in range(25):
        again = read_proc_identity(pid)
        if again is None or again[0] != starttime:
            break
        time.sleep(0.2)

    again = read_proc_identity(pid)
    if again is not None and again[0] == starttime and default_marker in again[1] and os.getuid() in again[2]:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass

    pid_file.unlink(missing_ok=True)

if errors:
    sys.exit(1)

print(f"Sidecars de voz detenidos (runtime dir: {runtime_dir})")
PY
