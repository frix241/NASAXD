"""API FastAPI autoalojada para AstroTwin."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Path as ApiPath, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from app import __version__
from app.config import AppSettings, load_settings
from app.context_isolation import (
    DISCLAIMER_EN,
    DISCLAIMER_ES,
    SYNTHETIC_PROFILES,
    build_interview_missions,
    evaluate_rules_and_3d,
    interview_requires_medical_escalation,
)
from app.contracts import (
    ChatRequest,
    ChatResponse,
    ConfirmMissionRequest,
    ConfirmMissionResponse,
    InterviewRequest,
    InterviewResponse,
    MissionProposal,
    ProvenanceInfo,
)
from app.daily_context import (
    DAILY_CONTEXT_STORE,
    DailyContextSubmission,
)
from app.daily_workflow import create_daily_workflow_router
from app.llm_adapter import LocalLLMAdapter
from app.mission_policy import MEDICAL_CONTACT_NOTICE_ES
from app.multi_vitals import router as multi_vitals_router
from app.safety import (
    EMERGENCY_ANSWER_ES,
    EMERGENCY_BYPASS_REASON,
    emergency_output,
    is_emergency,
)
from app.readers import (
    read_metrics_history_csv,
    read_parameter_catalog_json,
    read_real_labs_tidy,
    read_summary_json,
)
from app.voice_bridge import STTHttpBridge, STT_MAX_BYTES, TTSHttpBridge, TTS_MAX_CHARS
from app.voice_contracts import get_voice_contracts
from app.voice_pipeline import (
    VoiceActionRequest,
    VoiceSession,
    build_voice_contract,
)
from app.vitals_api import router as vitals_router
from app.vitals_engine import (
    ActivityContext,
    HeartRateSample,
    VitalEvaluationResult,
    VitalsEngineConfig,
    evaluate_heart_rate_series,
)


class TTSRequestBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=TTS_MAX_CHARS)
    voice: str = Field(default="es_ES-davefx-medium")


class RevokeContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: str = Field(..., min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_-]{2,40}$")
    context_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]{4,64}$")


class VitalsEvaluateRequest(BaseModel):
    samples: list[HeartRateSample] = Field(default_factory=list, max_length=500)
    target_context: ActivityContext
    config: VitalsEngineConfig | None = None
    symptom_text: str | None = Field(default=None, max_length=500)


def create_app(
    settings: AppSettings | None = None,
    stt_bridge: Any = None,
    tts_bridge: Any = None,
) -> FastAPI:
    cfg = settings or load_settings()
    # Puentes reales a los sidecars HTTP locales: solo si la feature flag del
    # motor está activa. En pruebas se inyectan mocks y tienen prioridad.
    if stt_bridge is None and cfg.stt_enabled:
        stt_bridge = STTHttpBridge(cfg.stt_url, cfg.voice_timeout_seconds)
    if tts_bridge is None and cfg.tts_enabled:
        tts_bridge = TTSHttpBridge(cfg.tts_url, cfg.voice_timeout_seconds)
    app = FastAPI(
        title="AstroTwin API Autoalojada",
        version=__version__,
        description=(
            "API local en español para resultados ML, catálogo NASA, laboratorios reales, "
            "copiloto az³tro, entrevista matutina y contratos 3D/voz."
        ),
    )

    cors_origins_raw = os.getenv(
        "ASTROTWIN_CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
    )
    cors_origins = [o.strip() for o in cors_origins_raw.split(",") if o.strip()]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    # Almacén en memoria para confirmación de misiones de la sesión
    interview_store: dict[str, list[MissionProposal]] = {}
    voice_sessions: dict[str, VoiceSession] = {}

    @app.get("/api/voice/pipeline")
    def get_voice_pipeline() -> dict[str, Any]:
        contract = build_voice_contract(cfg)
        return contract.model_dump()

    @app.post("/api/voice/pipeline/action")
    def post_voice_pipeline_action(req: VoiceActionRequest) -> JSONResponse:
        if not cfg.voice_enabled:
            return JSONResponse(
                status_code=409,
                content={
                    "enabled": False,
                    "reason": (
                        "Feature flag ASTROTWIN_VOICE_ENABLED desactivado; el pipeline "
                        "de voz no está habilitado y no se simula ningún estado."
                    ),
                },
            )
        session = voice_sessions.get(req.session_id)
        if session is None:
            session = VoiceSession(cfg, stt_bridge=stt_bridge, tts_bridge=tts_bridge)
            voice_sessions[req.session_id] = session
        if req.action == "start_push_to_talk":
            result = session.start_push_to_talk(req.mic_permission_granted)
        elif req.action == "stop_push_to_talk":
            result = session.stop_push_to_talk(req.transcript_text, req.language)
        elif req.action == "confirm_transcript":
            result = session.confirm_transcript(req.confirmed)
        else:
            result = session.cancel()
        return JSONResponse(status_code=200, content=result)

    @app.post("/api/voice/pipeline/reply")
    def post_voice_pipeline_reply(req: TTSRequestBody) -> JSONResponse:
        """Compone respuesta honesta: texto por defecto; TTS solo con puente activo."""
        session = VoiceSession(cfg, tts_bridge=tts_bridge)
        reply = session.synthesize_reply(req.text[:TTS_MAX_CHARS], llm_available=False)
        return JSONResponse(status_code=200, content=reply)


    @app.get("/api/status")
    def get_status() -> dict[str, Any]:
        llm_adapter = LocalLLMAdapter(cfg)
        llm_status = llm_adapter.check_availability()
        summary_check = read_summary_json(cfg.results_dir)
        history_check = read_metrics_history_csv(cfg.results_dir, limit=1)
        catalog_check = read_parameter_catalog_json(cfg.results_dir)
        voice_contracts = [c.model_dump() for c in get_voice_contracts(cfg)]

        return {
            "service": "astrotwin-api",
            "version": __version__,
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "self_hosted_only": True,
            "external_apis_enabled": False,
            "results_files": {
                "summary_json": summary_check["state"],
                "metrics_history_csv": history_check["state"],
                "parameter_catalog_json": catalog_check["state"],
            },
            "llm": llm_status,
            "voice_services": voice_contracts,
            "profiles_available": list(SYNTHETIC_PROFILES.keys()),
            "disclaimer": DISCLAIMER_ES,
        }

    @app.get("/api/results")
    def get_results(limit: int = Query(default=200, ge=1, le=1000)) -> dict[str, Any]:
        summary_data = read_summary_json(cfg.results_dir)
        history_data = read_metrics_history_csv(cfg.results_dir, limit=limit)
        real_labs = read_real_labs_tidy(cfg.data_root, limit=120)

        limitations = list(summary_data.get("limitations", []))
        for item in real_labs.get("limitations", []):
            if item not in limitations:
                limitations.append(item)

        overall_state = "ok"
        if summary_data["state"] == "error" or history_data["state"] == "error":
            overall_state = "partial"
        if summary_data["state"] == "empty" and history_data["state"] == "empty":
            overall_state = "empty"

        return {
            "state": overall_state,
            "summary": summary_data,
            "history": history_data,
            "real_labs": real_labs,
            "limitations": limitations,
            "disclaimer": DISCLAIMER_ES,
        }

    @app.get("/api/catalog")
    def get_catalog(
        search: str | None = Query(default=None, max_length=120),
        sheet: str | None = Query(default=None, max_length=80),
    ) -> dict[str, Any]:
        catalog = read_parameter_catalog_json(cfg.results_dir, search=search, sheet=sheet)
        return {
            **catalog,
            "disclaimer": (
                "Catálogo extraído del libro Excel NASA por el módulo ML. "
                "No convierte riesgos publicados en umbrales clínicos inventados."
            ),
        }

    @app.post("/api/chat", response_model=ChatResponse)
    def post_chat(req: ChatRequest) -> ChatResponse:
        real_labs = (
            read_real_labs_tidy(cfg.data_root, limit=10)
            if req.include_real_lab_reference
            else None
        )
        assessment, events_3d, rules_actions, allowed_citations = evaluate_rules_and_3d(
            profile_id=req.profile_id,
            selected_system=req.selected_system,
            real_labs_summary=real_labs,
        )

        allowed_action_names = sorted(
            {a for ev in events_3d for a in ev.allowed_actions}
        )

        daily_record = DAILY_CONTEXT_STORE.get(req.profile_id)
        if daily_record is not None:
            assessment["daily_context"] = daily_record.to_llm_safe_dict(
                now=DAILY_CONTEXT_STORE._now()
            )
            if daily_record.context_id not in allowed_citations:
                allowed_citations.append(daily_record.context_id)

        llm_output = None
        llm_available = False
        unavailable_reason: str | None = None
        prompt_version = "1.0.0"
        mode: str = "rules_only"
        safety_audit: dict[str, Any] = {}
        emergency_bypass = False

        if req.use_llm:
            adapter = LocalLLMAdapter(cfg)
            llm_output, llm_available, unavailable_reason, prompt_version = (
                adapter.generate_structured(
                    user_message=req.message,
                    context_payload=assessment,
                    allowed_actions=allowed_action_names,
                    allowed_citations=allowed_citations,
                    language=req.language,
                )
            )
            safety_audit = getattr(adapter, "last_safety_audit", {}) or {}
            emergency_bypass = unavailable_reason == EMERGENCY_BYPASS_REASON
            if emergency_bypass:
                mode = "rules_only"
            else:
                mode = "llm" if llm_available else "unavailable"
        elif is_emergency(req.message) or bool(
            daily_record is not None and daily_record.symptoms.urgent_red_flag
        ):
            # Modo solo reglas: la guarda de emergencia no puede depender de use_llm.
            emergency_bypass = True
            llm_output = emergency_output(req.language)
            unavailable_reason = EMERGENCY_BYPASS_REASON
            safety_audit = {"emergency_bypass": True, "model_consulted": False}

        # En una emergencia no se proponen acciones operativas que compitan con el escalamiento.
        assessment["proposed_actions"] = (
            [] if emergency_bypass else [a.model_dump() for a in rules_actions]
        )

        limitations = [
            "El motor de reglas no depende del LLM.",
            "Si el modelo local no responde, se muestra 'no disponible' sin fingir salida de LLM.",
            "Los perfiles simulados están aislados de los laboratorios reales Inspiration4.",
        ]
        if req.language == "en":
            limitations = [
                "The rules engine does not depend on the LLM.",
                "If the local model is unavailable, the app says so instead of fabricating an answer.",
                "Simulated profiles are kept separate from real Inspiration4 laboratory data.",
            ]
        if emergency_bypass:
            limitations.append(
                "Respuesta de emergencia determinista: el modelo local no fue consultado."
            )

        if req.language == "en":
            signals = assessment.get("signals", {})
            heart = signals.get("heart_rate", {}) if isinstance(signals, dict) else {}
            sleep = signals.get("sleep_hours", {}) if isinstance(signals, dict) else {}
            hydration = signals.get("hydration_ml", {}) if isinstance(signals, dict) else {}
            observations_en: list[str] = []
            selected = assessment.get("selected_system")
            if selected == "cardiovascular" and heart:
                delta = float(heart.get("value", 0)) - float(heart.get("baseline", 0))
                if delta >= 10 and int(heart.get("persistence_samples", 0)) >= 3:
                    observations_en.append(
                        f"Simulated pulse is +{delta:g} bpm above its baseline "
                        f"({heart.get('value')} vs {heart.get('baseline')} bpm). "
                        "This is an operational variation, not evidence of heart injury."
                    )
                else:
                    observations_en.append(
                        f"Simulated pulse: {heart.get('value')} bpm; baseline {heart.get('baseline')} bpm."
                    )
            elif selected == "sleep_circadian" and sleep:
                observations_en.append(
                    f"Simulated sleep: {sleep.get('value')} h; baseline {sleep.get('baseline')} h."
                )
            else:
                observations_en.append("This view contains simulated mission-health indicators.")
            if hydration and float(hydration.get("value", 0)) < 0.7 * float(hydration.get("baseline", 1)):
                observations_en.append(
                    f"User-reported fluid intake: {hydration.get('value')} mL; "
                    f"the demo profile reference is {hydration.get('baseline')} mL. This does not measure body hydration."
                )
            assessment["observations"] = observations_en
            assessment["pulse_disclaimer"] = "Pulse changes alone do not prove heart injury."
            if assessment.get("real_lab_context"):
                assessment["real_lab_context"]["note"] = (
                    "Inspiration4 population reference only; it is not assigned to the simulated profile."
                )
            if str(assessment.get("alias", "")).endswith("(Simulado)"):
                assessment["alias"] = str(assessment["alias"]).replace("(Simulado)", "(Simulated)")
            events_3d = [
                event.model_copy(
                    update={"reason": observations_en[0] if observations_en else "Simulated mission-health view."}
                )
                for event in events_3d
            ]
            action_labels = {
                "Reducir intensidad de la misión activa (requiere confirmación)": "Reduce active mission intensity (confirmation required)",
                "Programar nueva medición de control": "Schedule a repeat measurement",
                "Registrar observación operativa del turno": "Record an operational observation",
            }
            assessment["proposed_actions"] = [
                {**action, "label": action_labels.get(action.get("label"), action.get("label"))}
                for action in assessment.get("proposed_actions", [])
            ]

        return ChatResponse(
            profile_id=req.profile_id,
            origin="synthetic",
            disclaimer=DISCLAIMER_EN if req.language == "en" else DISCLAIMER_ES,
            provenance=ProvenanceInfo(
                provider=cfg.llm_provider,
                model=cfg.llm_model,
                llm_available=llm_available,
                mode=mode,  # type: ignore[arg-type]
                prompt_version=prompt_version,
                namespaces_isolated=True,
                unavailable_reason=unavailable_reason,
                safety_audit=safety_audit,
            ),
            rules_assessment=assessment,
            llm_output=llm_output,
            integration_3d=events_3d,
            limitations=limitations,
        )

    @app.post("/api/interview", response_model=InterviewResponse)
    def post_interview(req: InterviewRequest) -> InterviewResponse:
        interview_id, missions, events_3d = build_interview_missions(req)
        interview_store[interview_id] = missions
        daily_record = DAILY_CONTEXT_STORE.get(req.profile_id)
        escalate = interview_requires_medical_escalation(req) or bool(
            daily_record is not None and daily_record.symptoms.urgent_red_flag
        )
        if escalate and not any(m.mission_id == "stop_and_contact_medical" for m in missions):
            # Bandera urgente del contexto diario confirmado: no proponer carga física.
            missions = [
                m.model_copy(update={"intensity": "paused", "reason": MEDICAL_CONTACT_NOTICE_ES})
                for m in missions
            ]
            interview_store[interview_id] = missions

        subjective_record = {
            "sleep_quality": req.sleep_quality,
            "energy": req.energy,
            "pain": req.pain.model_dump(),
            "mood": req.mood,
            "hydration_completed": req.hydration_completed,
            "notes": req.notes,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }

        return InterviewResponse(
            interview_id=interview_id,
            profile_id=req.profile_id,
            namespace="simulation_synthetic",
            subjective_record=subjective_record,
            proposed_missions=missions,
            integration_3d=events_3d,
            disclaimer=DISCLAIMER_ES,
            llm_summary=None,
            llm_available=False,
            policy_action="stop_and_contact_medical" if escalate else None,
            contact_medical_team=escalate,
            medical_contact_notice=MEDICAL_CONTACT_NOTICE_ES if escalate else None,
        )

    @app.post("/api/interview/confirm", response_model=ConfirmMissionResponse)
    def post_interview_confirm(req: ConfirmMissionRequest) -> ConfirmMissionResponse:
        missions = interview_store.get(req.interview_id)
        if missions is None:
            raise HTTPException(
                status_code=404,
                detail="Entrevista no encontrada en la sesión actual.",
            )
        known_ids = {m.mission_id for m in missions}
        unknown_ids = sorted(set(req.mission_ids) - known_ids)
        if unknown_ids:
            # Nunca se reporta "confirmado" para misiones que no fueron propuestas.
            raise HTTPException(
                status_code=422,
                detail=f"Misiones no propuestas en esta entrevista: {unknown_ids}.",
            )

        updated: list[MissionProposal] = []
        for m in missions:
            if m.mission_id in req.mission_ids:
                m = m.model_copy(update={"confirmed": req.confirmed})
            updated.append(m)
        interview_store[req.interview_id] = updated

        return ConfirmMissionResponse(
            interview_id=req.interview_id,
            confirmed_missions=[m for m in updated if m.mission_id in req.mission_ids],
            status="confirmed" if req.confirmed else "rejected",
            recorded_at=datetime.now(timezone.utc).isoformat(),
        )

    @app.post("/api/interview/daily-context")
    def post_daily_context(req: DailyContextSubmission) -> JSONResponse:
        """Guarda contexto diario estructurado confirmado por el usuario (TTL real en memoria)."""
        try:
            record = DAILY_CONTEXT_STORE.store(req)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        vitals_view = DAILY_CONTEXT_STORE.get_vitals_view(req.profile_id)
        urgent = record.symptoms.urgent_red_flag
        return JSONResponse(
            status_code=200,
            content={
                "status": "emergency_escalation" if urgent else "stored",
                "record": record.to_redacted_api_dict(),
                "llm_safe_context": record.to_llm_safe_dict(),
                "vitals_view": vitals_view.model_dump() if vitals_view else None,
                "emergency_bypass": urgent,
                "model_consulted": False,
                "policy_action": "stop_and_contact_medical" if urgent else None,
                "emergency_notice": EMERGENCY_ANSWER_ES if urgent else None,
                "medical_contact_notice": MEDICAL_CONTACT_NOTICE_ES if urgent else None,
                "disclaimer": DISCLAIMER_ES,
            },
        )

    @app.get("/api/interview/daily-context/{profile_id}")
    def get_daily_context(
        profile_id: str = ApiPath(..., min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_-]{2,40}$"),
    ) -> dict[str, Any]:
        """Consulta el contexto diario vigente (expira automáticamente por TTL)."""
        record = DAILY_CONTEXT_STORE.get(profile_id)
        if record is None:
            return {
                "status": "missing_or_expired",
                "profile_id": profile_id,
                "record": None,
                "vitals_view": None,
            }
        vitals_view = DAILY_CONTEXT_STORE.get_vitals_view(profile_id)
        return {
            "status": "active",
            "profile_id": profile_id,
            "record": record.to_redacted_api_dict(),
            "vitals_view": vitals_view.model_dump() if vitals_view else None,
        }

    @app.delete("/api/interview/context/{profile_id}")
    def delete_daily_context(
        profile_id: str = ApiPath(..., min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_-]{2,40}$"),
        context_id: str | None = Query(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]{4,64}$"),
    ) -> dict[str, Any]:
        """Revoca y elimina de inmediato el contexto diario almacenado en memoria."""
        revoked = DAILY_CONTEXT_STORE.revoke(profile_id, context_id=context_id)
        return {
            "revoked": revoked,
            "profile_id": profile_id,
            "status": "revoked" if revoked else "not_found",
        }

    @app.post("/api/interview/context/revoke")
    def post_revoke_daily_context(req: RevokeContextRequest) -> dict[str, Any]:
        """Alternativa POST para revocar y borrar el contexto diario en memoria."""
        revoked = DAILY_CONTEXT_STORE.revoke(req.profile_id, context_id=req.context_id)
        return {
            "revoked": revoked,
            "profile_id": req.profile_id,
            "status": "revoked" if revoked else "not_found",
        }

    @app.get("/api/voice/contracts")
    def get_voice_contracts_endpoint() -> dict[str, Any]:
        contracts = [c.model_dump() for c in get_voice_contracts(cfg)]
        return {
            "services": contracts,
            "tested_in_runtime": True,
            "note": (
                "Puentes HTTP reales a sidecars locales (whisper.cpp 8081 / sherpa-onnx 8082, "
                "solo 127.0.0.1): implementados en app/voice_bridge.py y probados con sidecar "
                "real (ver results/VOICE_BRIDGE_INTEGRATION.md). available_now solo indica que "
                "el puerto responde, no que la inferencia de esa llamada se haya verificado."
            ),
        }

    MAX_STT_AUDIO_BYTES = STT_MAX_BYTES  # 10 MiB

    @app.post("/api/voice/stt")
    async def post_voice_stt(
        request: Request,
        language: Literal["auto", "es", "en"] = Query(default="auto"),
    ) -> JSONResponse:
        """Puente real STT: audio en memoria -> whisper-server local -> transcript.

        El audio no se escribe a disco ni se registra; el sidecar debe ser
        local (127.0.0.1/localhost) por diseño del puente.
        """
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_STT_AUDIO_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Audio supera el límite de 10 MiB (Content-Length).",
                    )
            except ValueError:
                raise HTTPException(status_code=400, detail="Cabecera Content-Length inválida.") from None

        total_bytes = 0
        audio_bytes = bytearray()
        async for chunk in request.stream():
            total_bytes += len(chunk)
            audio_bytes.extend(chunk)
            if total_bytes > MAX_STT_AUDIO_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="Audio supera el límite incremental de 10 MiB.",
                )
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Audio vacío.")

        if not cfg.stt_enabled:
            return JSONResponse(
                status_code=409,
                content={
                    "available": False,
                    "implemented_bridge": True,
                    "reason": (
                        "Feature flag ASTROTWIN_STT_ENABLED desactivado; el puente STT "
                        "existe pero no está habilitado en este entorno. No se simula "
                        "transcripción."
                    ),
                },
            )
        if stt_bridge is None:
            return JSONResponse(
                status_code=503,
                content={
                    "available": False,
                    "implemented_bridge": True,
                    "reason": (
                        "Puente STT no configurado en este proceso (flag activo sin "
                        "puente); no se simula transcripción."
                    ),
                },
            )

        try:
            result = await run_in_threadpool(
                stt_bridge.transcribe,
                bytes(audio_bytes),
                request.headers.get("content-type", "audio/webm"),
                language=language,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Cabecera STT inválida: {exc}") from exc
        del audio_bytes  # en memoria; se libera al terminar el turno
        if result is None:
            return JSONResponse(
                status_code=503,
                content={
                    "available": False,
                    "implemented_bridge": True,
                    "reason": (
                        "El sidecar STT local no devolvió transcripción (inactivo, "
                        "timeout o audio ilegible). No se simula texto."
                    ),
                },
            )
        return JSONResponse(
            status_code=200,
            content={
                "available": True,
                "implemented_bridge": True,
                "text": result["text"],
                "language": result.get("language", language),
                "language_source": result.get("language_source", "unavailable"),
                "requires_confirmation": True,
                "confirmed_by_user": False,
                "bytes_received": total_bytes,
                "note": (
                    "Transcripción local; confírmala o edítala antes de ejecutar "
                    "cualquier acción."
                ),
            },
        )

    @app.post("/api/voice/tts", response_model=None)
    def post_voice_tts(req: TTSRequestBody) -> Response:
        """Puente real TTS: texto (<= 500 chars) -> sidecar local -> WAV en memoria."""
        if not cfg.tts_enabled:
            return JSONResponse(
                status_code=409,
                content={
                    "available": False,
                    "implemented_bridge": True,
                    "text_length": len(req.text),
                    "reason": (
                        "Feature flag ASTROTWIN_TTS_ENABLED desactivado; el puente TTS "
                        "existe pero no está habilitado. No se genera audio falso."
                    ),
                },
            )
        if tts_bridge is None:
            return JSONResponse(
                status_code=503,
                content={
                    "available": False,
                    "implemented_bridge": True,
                    "reason": "Puente TTS no configurado en este proceso; no se simula audio.",
                },
            )
        result = tts_bridge.synthesize(req.text)
        if result is None:
            return JSONResponse(
                status_code=503,
                content={
                    "available": False,
                    "implemented_bridge": True,
                    "text_length": len(req.text),
                    "reason": (
                        "El sidecar TTS local no devolvió audio (inactivo o timeout). "
                        "La respuesta queda en modo texto."
                    ),
                },
            )
        audio = result["audio"]
        sample_rate = result.get("sample_rate")
        headers = {"X-TTS-Engine": "sherpa-onnx-local"}
        if sample_rate:
            headers["X-Audio-Sample-Rate"] = str(sample_rate)
        return Response(content=audio, media_type=result["content_type"], headers=headers)

    app.include_router(vitals_router)
    app.include_router(multi_vitals_router)
    app.include_router(create_daily_workflow_router(cfg))

    @app.post("/api/vitals/evaluate", response_model=VitalEvaluationResult)
    def post_vitals_evaluate(req: VitalsEvaluateRequest) -> VitalEvaluationResult:
        """Evalúa serie de frecuencia cardíaca con línea base personal por contexto (no clínico)."""
        return evaluate_heart_rate_series(
            samples=req.samples,
            target_context=req.target_context,
            config=req.config,
            symptom_text=req.symptom_text,
        )

    # Servir dashboard estático en /
    web_dir: Path = cfg.web_dir
    if web_dir.exists():
        app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")

        @app.get("/", include_in_schema=False)
        def serve_index() -> FileResponse:
            return FileResponse(str(web_dir / "index.html"))

    return app


app = create_app()
