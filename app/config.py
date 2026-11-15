"""Configuración central de la API autoalojada AstroTwin."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppSettings:
    """Rutas y parámetros configurables desde variables de entorno."""

    project_root: Path
    data_root: Path
    results_dir: Path
    prompts_dir: Path
    web_dir: Path
    llm_provider: str
    llm_base_url: str
    llm_model: str
    llm_timeout_seconds: float
    stt_provider: str
    stt_url: str
    tts_provider: str
    tts_url: str
    voice_timeout_seconds: float
    voice_enabled: bool = False
    stt_enabled: bool = False
    vad_enabled: bool = False
    tts_enabled: bool = False


def load_settings() -> AppSettings:
    """Carga configuración sin secretos ni llamadas de red al importar."""
    default_root = Path(__file__).resolve().parent.parent
    project_root = Path(os.getenv("ASTROTWIN_ROOT", str(default_root)))
    data_root = Path(
        os.getenv("ASTROTWIN_DATA_ROOT", "/home/bunuelo/Descargas/AstroTwin_datos")
    )
    results_dir = Path(
        os.getenv("ASTROTWIN_RESULTS_DIR", str(project_root / "results"))
    )
    prompts_dir = Path(
        os.getenv("ASTROTWIN_PROMPTS_DIR", str(project_root / "prompts"))
    )
    web_dir = Path(os.getenv("ASTROTWIN_WEB_DIR", str(project_root / "web")))

    return AppSettings(
        project_root=project_root,
        data_root=data_root,
        results_dir=results_dir,
        prompts_dir=prompts_dir,
        web_dir=web_dir,
        llm_provider=os.getenv("ASTROTWIN_LLM_PROVIDER", "ollama").strip().lower(),
        llm_base_url=os.getenv("ASTROTWIN_LLM_BASE_URL", "http://localhost:11434").rstrip("/"),
        llm_model=os.getenv("ASTROTWIN_LLM_MODEL", "gemma3:1b"),
        llm_timeout_seconds=float(os.getenv("ASTROTWIN_LLM_TIMEOUT", "15.0")),
        stt_provider=os.getenv("ASTROTWIN_STT_PROVIDER", "whisper.cpp (sidecar HTTP local)").strip().lower(),
        stt_url=os.getenv("ASTROTWIN_STT_URL", "http://127.0.0.1:8081").rstrip("/"),
        tts_provider=os.getenv("ASTROTWIN_TTS_PROVIDER", "sherpa-onnx (sidecar HTTP local)").strip().lower(),
        tts_url=os.getenv("ASTROTWIN_TTS_URL", "http://127.0.0.1:8082").rstrip("/"),
        voice_timeout_seconds=float(os.getenv("ASTROTWIN_VOICE_TIMEOUT", "30.0")),
        voice_enabled=os.getenv("ASTROTWIN_VOICE_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on"),
        stt_enabled=os.getenv("ASTROTWIN_STT_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on"),
        vad_enabled=os.getenv("ASTROTWIN_VAD_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on"),
        tts_enabled=os.getenv("ASTROTWIN_TTS_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on"),
    )
