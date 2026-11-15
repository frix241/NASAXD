"""Flujo unificado diario POST /api/daily-checkin para AstroTwin.

Conecta en una sola llamada determinista:
1. Entrevista matutina y/o contexto diario confirmado (sin inventar datos).
2. Mediciones explícitas de frecuencia cardíaca (nunca genera lecturas falsas).
3. Evaluación de anomalía respecto a línea base personal (``vitals_engine``).
4. Política determinista de ajuste de misiones y escalamiento (``mission_policy``).
5. Contexto explicativo controlado para el LLM local (``LocalLLMAdapter``), sin
   permitirle decidir severidad ni emitir diagnósticos.
6. Propuesta de misiones con ``requires_confirmation=True`` y ``confirmed=False``,
   más reporte estructurado con fuentes y timestamp UTC.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.config import AppSettings
from app.context_isolation import (
    DISCLAIMER_ES,
    build_interview_missions,
    interview_requires_medical_escalation,
)
from app.contracts import (
    ALLOWED_ACTIONS,
    Integration3DEvent,
    InterviewRequest,
    LLMOutputPayload,
    ProvenanceInfo,
)
from app.daily_context import (
    DAILY_CONTEXT_STORE,
    DailyContextSubmission,
    DailyContextVitalsView,
)
from app.llm_adapter import LocalLLMAdapter
from app.mission_policy import MEDICAL_CONTACT_NOTICE_ES, PolicyAction
from app.safety import EMERGENCY_BYPASS_REASON, emergency_output, is_emergency
from app.vitals_api import (
    DailyMissionItem,
    MissionAdaptationResult,
    MissionAdaptationRules,
    QualitySummary,
    TrendSummary,
    ZoneSystemHighlight,
    _run_analysis,
)
from app.vitals_engine import (
    NON_CLINICAL_DISCLAIMER_ES,
    ActivityContext,
    HeartRateSample,
    VitalEvaluationResult,
    VitalEvaluationStatus,
    VitalsEngineConfig,
)


class DailyCheckinRequest(BaseModel):
    """Entrada explícita para el bucle diario completo."""

    model_config = ConfigDict(extra="forbid")

    profile_id: str = Field(
        default="C001-sim",
        min_length=2,
        max_length=40,
        pattern=r"^[A-Za-z0-9_-]{2,40}$",
    )
    language: Literal["es", "en"] = "es"
    target_context: ActivityContext = ActivityContext.REST
    samples: list[HeartRateSample] = Field(default_factory=list, max_length=500)
    symptom_text: str | None = Field(default=None, max_length=500)
    interview: InterviewRequest | None = None
    daily_context: DailyContextSubmission | None = None
    use_stored_daily_context: bool = True
    config: VitalsEngineConfig | None = None
    daily_missions: list[DailyMissionItem] | None = None
    adaptation_rules: MissionAdaptationRules | None = None
    use_llm: bool = False
    user_question: str = Field(
        default="Explica de forma breve y no clínica el estado actual de mi check-in diario.",
        min_length=1,
        max_length=400,
    )


class DailyCheckinReport(BaseModel):
    """Reporte auditable del check-in diario con fuentes y marcas de tiempo."""

    report_id: str
    timestamp_utc: str
    profile_id: str
    namespace: Literal["simulation_synthetic"] = "simulation_synthetic"
    origin: Literal["synthetic"] = "synthetic"
    sources: list[str] = Field(default_factory=list)
    data_completeness: dict[str, Any] = Field(default_factory=dict)
    evaluation_status: VitalEvaluationStatus
    abstained: bool
    abstention_reason: str | None = None
    policy_action: PolicyAction
    matched_policy_id: str
    contact_medical_team: bool = False
    stop_activity: bool = False
    requires_confirmation: Literal[True] = True
    is_clinical_diagnosis: Literal[False] = False
    real_vitals_mutated: Literal[False] = False
    prescribes_recovery: Literal[False] = False


class DailyCheckinResponse(BaseModel):
    """Salida unificada de POST /api/daily-checkin."""

    checkin_id: str
    timestamp_utc: str
    profile_id: str
    namespace: Literal["simulation_synthetic"] = "simulation_synthetic"
    origin: Literal["synthetic"] = "synthetic"
    simulated_only: Literal[True] = True
    real_vitals_mutated: Literal[False] = False
    is_clinical_diagnosis: Literal[False] = False
    prescribes_recovery: Literal[False] = False
    disclaimer: str
    abstained: bool
    abstention_reason: str | None = None
    evaluation: VitalEvaluationResult
    quality_summary: QualitySummary
    trend: TrendSummary
    zone_highlight: ZoneSystemHighlight
    daily_context_applied: DailyContextVitalsView | None = None
    interview_events_3d: list[Integration3DEvent] = Field(default_factory=list)
    mission_adaptation: MissionAdaptationResult
    proposed_missions: list[DailyMissionItem]
    requires_confirmation: Literal[True] = True
    confirmation_token: str
    policy_action: PolicyAction
    contact_medical_team: bool = False
    stop_activity: bool = False
    medical_contact_notice: str | None = None
    deterministic_explanation: str
    llm_context_payload: dict[str, Any]
    llm_output: LLMOutputPayload | None = None
    provenance: ProvenanceInfo
    report: DailyCheckinReport


def _combine_symptom_text(req: DailyCheckinRequest) -> str | None:
    parts: list[str] = []
    if req.symptom_text and req.symptom_text.strip():
        parts.append(req.symptom_text.strip())
    if req.interview and req.interview.notes and req.interview.notes.strip():
        parts.append(req.interview.notes.strip())
    if not parts:
        return None
    return " | ".join(parts)[:500]


def _resolve_abstention(
    evaluation: VitalEvaluationResult,
    policy_action: PolicyAction,
    matched_policy_id: str,
) -> tuple[bool, str | None]:
    if policy_action == "stop_and_contact_medical":
        return False, None
    if evaluation.status == "missing_data":
        return True, "Faltan mediciones válidas en el contexto objetivo; se abstiene de ajustar carga."
    if evaluation.status == "low_quality" or policy_action == "remeasure":
        return True, "Calidad de señal o contexto incierta; se solicita remedición sin degradar misiones."
    if matched_policy_id == "P2C_UNCERTAIN_DATA_ABSTAIN_UNCHANGED":
        return True, "Datos inciertos con remedición deshabilitada; se abstiene de ajustar misiones."
    if evaluation.status == "insufficient_baseline":
        return (
            True,
            f"Línea base personal insuficiente ({evaluation.baseline.valid_sample_count}/"
            f"{evaluation.baseline.min_required_samples} muestras válidas); se abstiene de inferir anomalía.",
        )
    return False, None


def _build_deterministic_explanation(
    *,
    evaluation: VitalEvaluationResult,
    adaptation: MissionAdaptationResult,
    abstained: bool,
    abstention_reason: str | None,
    medical_notice: str | None,
) -> str:
    if medical_notice:
        return medical_notice
    if abstained and abstention_reason:
        return f"{abstention_reason} {evaluation.explanation}"
    return f"{evaluation.explanation} {adaptation.summary}".strip()


def _build_controlled_llm_context(
    *,
    req: DailyCheckinRequest,
    evaluation: VitalEvaluationResult,
    quality_summary: QualitySummary,
    adaptation: MissionAdaptationResult,
    zone_highlight: ZoneSystemHighlight,
    proposed_missions: list[DailyMissionItem],
    policy_action: PolicyAction,
    daily_ctx: DailyContextVitalsView | None,
    abstained: bool,
    abstention_reason: str | None,
    allowed_actions: list[str],
    allowed_citations: list[str],
) -> dict[str, Any]:
    """Construye contexto acotado y no clínico para explicación del LLM.

    La severidad, la zona y las misiones ya fueron resueltas de forma determinista;
    el LLM recibe el plan aprobado para explicarlo, no para cambiarlo ni inventar tareas.
    """
    observations = [evaluation.explanation, adaptation.summary]
    if abstention_reason:
        observations.append(abstention_reason)
    if quality_summary.remeasurement_reason:
        observations.append(quality_summary.remeasurement_reason)

    payload: dict[str, Any] = {
        "profile_id": req.profile_id,
        "response_language": "English" if req.language == "en" else "Spanish",
        "namespace": "simulation_synthetic",
        "status": evaluation.status,
        "policy_action": policy_action,
        "matched_policy_id": adaptation.matched_policy_id,
        "abstained": abstained,
        "affected_zone": {
            "zone": zone_highlight.zone,
            "system": zone_highlight.system,
            "severity": zone_highlight.severity,
            "title": zone_highlight.non_clinical_title,
        },
        "mission_plan": [
            {
                "mission_id": mission.mission_id,
                "title": mission.title,
                "duration_min": mission.duration_min,
                "intensity": mission.intensity,
                "status": mission.status,
                "adjustment_reason": mission.adjustment_reason,
            }
            for mission in proposed_missions
        ],
        "baseline": {
            "established": evaluation.baseline.established,
            "valid_sample_count": evaluation.baseline.valid_sample_count,
            "min_required_samples": evaluation.baseline.min_required_samples,
            "baseline_center_bpm": evaluation.baseline.baseline_center_bpm,
        },
        "vital_summary": {
            "latest_bpm": evaluation.window_summary.latest_bpm,
            "delta_from_baseline_bpm": evaluation.window_summary.delta_from_baseline_bpm,
            "trend_direction": (
                "rising"
                if evaluation.window_summary.delta_from_baseline_bpm is not None
                and evaluation.window_summary.delta_from_baseline_bpm > 0
                else "falling"
                if evaluation.window_summary.delta_from_baseline_bpm is not None
                and evaluation.window_summary.delta_from_baseline_bpm < 0
                else "stable"
                if evaluation.window_summary.delta_from_baseline_bpm == 0
                else "unknown"
            ),
            "illustrative_delta_threshold_bpm": evaluation.baseline.effective_delta_threshold_bpm,
        },
        "observations": observations,
        "pulse_disclaimer": "Cambios de pulso no prueban lesión de corazón.",
        "is_clinical_diagnosis": False,
        "allowed_actions": allowed_actions,
        "allowed_citations": allowed_citations,
    }
    if daily_ctx is not None:
        record = DAILY_CONTEXT_STORE.get(req.profile_id)
        if record is not None:
            payload["daily_context"] = record.to_llm_safe_dict(now=DAILY_CONTEXT_STORE._now())
    return payload


def create_daily_workflow_router(settings: AppSettings) -> APIRouter:
    """Crea el router de flujo diario unificado sin duplicar estado ni reglas."""
    router = APIRouter(prefix="/api", tags=["daily-workflow"])

    @router.post("/daily-checkin", response_model=DailyCheckinResponse)
    def post_daily_checkin(req: DailyCheckinRequest) -> DailyCheckinResponse:
        now_utc = datetime.now(timezone.utc).isoformat()
        checkin_id = f"chk-{uuid.uuid4().hex[:12]}"

        if req.daily_context is not None:
            if req.daily_context.profile_id != req.profile_id:
                raise HTTPException(
                    status_code=422,
                    detail="daily_context.profile_id debe coincidir con profile_id.",
                )
            try:
                DAILY_CONTEXT_STORE.store(req.daily_context)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

        if req.interview is not None and req.interview.profile_id != req.profile_id:
            raise HTTPException(
                status_code=422,
                detail="interview.profile_id debe coincidir con profile_id.",
            )

        combined_symptoms = _combine_symptom_text(req)
        analysis = _run_analysis(
            profile_id=req.profile_id,
            target_context=req.target_context,
            samples=list(req.samples),
            preset_used=None,
            symptom_text=combined_symptoms,
            config=req.config,
            daily_missions=req.daily_missions,
            adaptation_rules=req.adaptation_rules,
            use_daily_context=req.use_stored_daily_context or (req.daily_context is not None),
        )

        interview_events: list[Integration3DEvent] = []
        interview_escalate = False
        if req.interview is not None:
            _, _, interview_events = build_interview_missions(req.interview)
            interview_escalate = interview_requires_medical_escalation(req.interview)

        adaptation = analysis.mission_adaptation
        escalate = adaptation.contact_medical_team or interview_escalate
        policy_action: PolicyAction = (
            "stop_and_contact_medical" if escalate else adaptation.policy_action
        )
        stop_activity = adaptation.stop_activity or escalate
        medical_notice = (
            adaptation.medical_contact_notice
            or (MEDICAL_CONTACT_NOTICE_ES if escalate else None)
        )

        # Si la entrevista escaló por dolor severo (>=8) sin red flag textual en notas,
        # pausar explícitamente las misiones propuestas sin inventar mediciones.
        if escalate and not adaptation.contact_medical_team:
            proposed_missions = [
                m.model_copy(
                    update={
                        "intensity": "paused",
                        "status": "paused",
                        "adjustment_reason": MEDICAL_CONTACT_NOTICE_ES,
                        "confirmed": False,
                    }
                )
                for m in adaptation.adapted_missions
            ]
        else:
            proposed_missions = [
                m.model_copy(update={"confirmed": False})
                for m in adaptation.adapted_missions
            ]

        abstained, abstention_reason = _resolve_abstention(
            analysis.evaluation,
            policy_action,
            adaptation.matched_policy_id,
        )

        allowed_citations = ["vitals-engine-v1", "mission-policy-v1"]
        for s in req.samples:
            if s.source not in allowed_citations:
                allowed_citations.append(s.source)
        if analysis.daily_context_applied is not None:
            allowed_citations.append(analysis.daily_context_applied.context_id)

        allowed_action_names = sorted(
            {
                a
                for a in analysis.zone_highlight.event_3d.allowed_actions
                if a in ALLOWED_ACTIONS
            }
        )
        llm_context_payload = _build_controlled_llm_context(
            req=req,
            evaluation=analysis.evaluation,
            quality_summary=analysis.quality_summary,
            adaptation=adaptation,
            zone_highlight=analysis.zone_highlight,
            proposed_missions=proposed_missions,
            policy_action=policy_action,
            daily_ctx=analysis.daily_context_applied,
            abstained=abstained,
            abstention_reason=abstention_reason,
            allowed_actions=allowed_action_names,
            allowed_citations=allowed_citations,
        )

        llm_output: LLMOutputPayload | None = None
        llm_available = False
        unavailable_reason: str | None = None
        prompt_version = "1.0.0"
        mode: Literal["rules_only", "llm", "unavailable"] = "rules_only"
        safety_audit: dict[str, Any] = {}

        urgent_detected = escalate or is_emergency(combined_symptoms or "") or is_emergency(req.user_question)
        if urgent_detected:
            llm_output = emergency_output(req.language)
            unavailable_reason = EMERGENCY_BYPASS_REASON
            safety_audit = {"emergency_bypass": True, "model_consulted": False}
            mode = "rules_only"
        elif req.use_llm:
            adapter = LocalLLMAdapter(settings)
            llm_output, llm_available, unavailable_reason, prompt_version = (
                adapter.generate_structured(
                    user_message=req.user_question,
                    context_payload=llm_context_payload,
                    allowed_actions=allowed_action_names,
                    allowed_citations=allowed_citations,
                    language=req.language,
                )
            )
            safety_audit = getattr(adapter, "last_safety_audit", {}) or {}
            if unavailable_reason == EMERGENCY_BYPASS_REASON:
                mode = "rules_only"
            else:
                mode = "llm" if llm_available else "unavailable"

        sources = list(allowed_citations)
        if mode == "llm":
            sources.append(f"llm:{settings.llm_model}")

        deterministic_explanation = _build_deterministic_explanation(
            evaluation=analysis.evaluation,
            adaptation=adaptation,
            abstained=abstained,
            abstention_reason=abstention_reason,
            medical_notice=medical_notice,
        )
        if req.language == "en":
            delta = analysis.evaluation.window_summary.delta_from_baseline_bpm
            latest = analysis.evaluation.window_summary.latest_bpm
            center = analysis.evaluation.baseline.baseline_center_bpm
            if abstained:
                deterministic_explanation = (
                    "There is not enough validated data to compare this reading with the personal baseline. "
                    "Repeat the measurement with good signal quality before changing the demo mission."
                )
            elif delta is not None and latest is not None and center is not None:
                deterministic_explanation = (
                    f"The latest simulated pulse is {latest:g} bpm, {delta:+g} bpm from the personal baseline "
                    f"of {center:g} bpm. The deterministic policy is {policy_action.replace('_', ' ')}. "
                    "This is an operational signal, not a diagnosis."
                )
            else:
                deterministic_explanation = (
                    "The demo could not calculate a personal-baseline comparison for this check-in. "
                    "Review the available readings and repeat if needed."
                )

        report = DailyCheckinReport(
            report_id=f"rep-{uuid.uuid4().hex[:12]}",
            timestamp_utc=now_utc,
            profile_id=req.profile_id,
            sources=sources,
            data_completeness={
                "samples_provided": len(req.samples),
                "valid_sample_count": analysis.evaluation.baseline.valid_sample_count,
                "min_required_samples": analysis.evaluation.baseline.min_required_samples,
                "has_daily_context": analysis.daily_context_applied is not None,
                "has_interview": req.interview is not None,
                "abstained": abstained,
                "abstention_reason": abstention_reason,
            },
            evaluation_status=analysis.evaluation.status,
            abstained=abstained,
            abstention_reason=abstention_reason,
            policy_action=policy_action,
            matched_policy_id=adaptation.matched_policy_id,
            contact_medical_team=escalate,
            stop_activity=stop_activity,
        )

        return DailyCheckinResponse(
            checkin_id=checkin_id,
            timestamp_utc=now_utc,
            profile_id=req.profile_id,
            disclaimer=(
                "Educational demo only. It does not diagnose conditions; simulated pulse changes are not a clinical finding."
                if req.language == "en"
                else f"{DISCLAIMER_ES} {NON_CLINICAL_DISCLAIMER_ES}"
            ),
            abstained=abstained,
            abstention_reason=abstention_reason,
            evaluation=analysis.evaluation,
            quality_summary=analysis.quality_summary,
            trend=analysis.trend,
            zone_highlight=analysis.zone_highlight,
            daily_context_applied=analysis.daily_context_applied,
            interview_events_3d=interview_events,
            mission_adaptation=adaptation,
            proposed_missions=proposed_missions,
            confirmation_token=adaptation.confirmation_token,
            policy_action=policy_action,
            contact_medical_team=escalate,
            stop_activity=stop_activity,
            medical_contact_notice=(
                "An urgent warning symptom was reported. Stop the demo activity and contact the mission medical team now."
                if req.language == "en" and medical_notice
                else medical_notice
            ),
            deterministic_explanation=deterministic_explanation,
            llm_context_payload=llm_context_payload,
            llm_output=llm_output,
            provenance=ProvenanceInfo(
                provider=settings.llm_provider,
                model=settings.llm_model,
                llm_available=llm_available,
                mode=mode,
                prompt_version=prompt_version,
                namespaces_isolated=True,
                unavailable_reason=unavailable_reason,
                safety_audit=safety_audit,
            ),
            report=report,
        )

    return router
