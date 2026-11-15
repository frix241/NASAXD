"""API separada para integración del motor de anomalías de signos vitales en AstroTwin.

Este módulo envuelve ``app.vitals_engine`` sin modificarlo y expone:
- Presets deterministas de demostración (claramente marcados como simulados).
- Evaluación contextualizada (rest / activity / sleep), calidad de señal y tendencia.
- Solicitud explícita de remedición ante calidad sospechosa.
- Señalización de zona/sistema 3D e información educativa no clínica.
- Ajuste adaptativo de misiones diarias sujeto exclusivamente a reglas seguras
  configurables y confirmación humana explícita. Nunca muta signos vitales reales
  ni emite diagnósticos médicos.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.contracts import Integration3DEvent
from app.daily_context import DAILY_CONTEXT_STORE, DailyContextVitalsView
from app.mission_policy import (
    EXPLICIT_POLICY_TABLE,
    MEDICAL_CONTACT_NOTICE_ES,
    MissionChangeAudit,
    MissionPolicyAuditEntry,
    PolicyAction,
    PolicyTableRow,
    build_audit_entry,
    build_policy_matrix_snapshot,
    classify_policy_inputs,
    resolve_policy_row,
)
from app.safety import is_emergency
from app.vitals_engine import (
    NON_CLINICAL_DISCLAIMER_ES,
    ActivityContext,
    HeartRateSample,
    SignalQuality,
    VitalEvaluationResult,
    VitalsEngineConfig,
    evaluate_heart_rate_series,
)

router = APIRouter(prefix="/api/vitals", tags=["vitals-anomaly"])


class MissionAdaptationRules(BaseModel):
    """Reglas seguras explícitas y configurables para adaptar misiones diarias."""

    allow_adaptive_adjustment: bool = True
    reduce_intensity_on_sustained_deviation: bool = True
    sustained_target_intensity: Literal["low", "paused"] = "low"
    duration_reduction_factor: float = Field(default=0.5, ge=0.25, le=1.0)
    pause_high_load_on_active_symptoms: bool = True
    hold_unchanged_on_suspect_quality: bool = True
    hold_unchanged_on_transient_spike: bool = True
    require_human_confirmation: Literal[True] = True


class DailyMissionItem(BaseModel):
    """Misión diaria operativa (simulada, no prescripción médica)."""

    mission_id: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=2, max_length=160)
    duration_min: int = Field(..., ge=1, le=180)
    intensity: Literal["paused", "low", "moderate", "high"]
    category: str = Field(default="operational", max_length=64)
    status: Literal[
        "unchanged", "intensity_reduced", "paused", "remeasurement_added",
        "context_review_added",
    ] = "unchanged"
    adjustment_reason: str | None = None
    requires_confirmation: Literal[True] = True
    confirmed: bool = False


class TrendPoint(BaseModel):
    """Punto de la serie temporal para visualización de tendencia."""

    index: int
    value_bpm: float | None
    context: ActivityContext
    quality: SignalQuality
    signal_quality_score: float | None = None
    measurement_confirmed: bool
    valid_for_engine: bool
    deviating_from_baseline: bool = False


class TrendSummary(BaseModel):
    """Resumen determinista de tendencia en el contexto evaluado."""

    direction: Literal["rising", "falling", "stable", "insufficient_data"]
    delta_from_baseline_bpm: float | None = None
    recent_slope_bpm: float | None = None
    valid_point_count: int
    points: list[TrendPoint] = Field(default_factory=list)


class QualitySummary(BaseModel):
    """Estado de calidad de señal y solicitud de remedición si es sospechosa."""

    latest_quality: SignalQuality | None = None
    latest_signal_quality_score: float | None = None
    latest_measurement_confirmed: bool | None = None
    suspect_quality: bool
    remeasurement_requested: bool
    remeasurement_reason: str | None = None
    quality_counts: dict[str, int] = Field(default_factory=dict)


class ZoneSystemHighlight(BaseModel):
    """Señalización de zona/sistema en gemelo 3D e información no clínica."""

    zone: Literal["thorax", "head", "abdomen", "musculoskeletal", "systemic", "none"]
    system: str
    severity: Literal["nominal", "attention", "priority", "insufficient_data"]
    event_3d: Integration3DEvent
    non_clinical_title: str
    non_clinical_info: str
    reference_citation: str | None = None
    is_clinical_diagnosis: Literal[False] = False
    limitations: list[str] = Field(default_factory=list)


class MissionAdaptationResult(BaseModel):
    """Resultado de adaptación de misiones diarias bajo reglas seguras."""

    adjusted: bool
    policy_action: PolicyAction
    matched_policy_id: str
    rule_applied: str
    summary: str
    stop_activity: bool = False
    contact_medical_team: bool = False
    medical_contact_notice: str | None = None
    requires_confirmation: Literal[True] = True
    confirmation_token: str
    prescribes_recovery: Literal[False] = False
    rules_snapshot: MissionAdaptationRules
    original_missions: list[DailyMissionItem]
    adapted_missions: list[DailyMissionItem]
    audit_entry: MissionPolicyAuditEntry
    safety_note: str


class VitalsAnalyzeRequest(BaseModel):
    """Entrada para análisis integrado de anomalías, contexto y misiones."""

    profile_id: str = Field(default="C001-sim", min_length=2, max_length=40)
    target_context: ActivityContext | None = None
    samples: list[HeartRateSample] = Field(default_factory=list, max_length=500)
    preset_id: str | None = Field(default=None, max_length=64)
    symptom_text: str | None = Field(default=None, max_length=500)
    config: VitalsEngineConfig | None = None
    daily_missions: list[DailyMissionItem] | None = None
    adaptation_rules: MissionAdaptationRules | None = None
    use_daily_context: bool = True


class VitalsAnalyzeResponse(BaseModel):
    """Respuesta completa de integración para UI y consumidores API."""

    profile_id: str
    namespace: Literal["simulation_synthetic"] = "simulation_synthetic"
    simulated_detection: Literal[True] = True
    real_vitals_mutated: Literal[False] = False
    is_clinical_diagnosis: Literal[False] = False
    disclaimer: str = NON_CLINICAL_DISCLAIMER_ES
    preset_used: str | None = None
    evaluation: VitalEvaluationResult
    quality_summary: QualitySummary
    trend: TrendSummary
    zone_highlight: ZoneSystemHighlight
    mission_adaptation: MissionAdaptationResult
    daily_context_applied: DailyContextVitalsView | None = None


class RemeasureRequest(BaseModel):
    """Solicitud de remedición tras lectura de calidad sospechosa."""

    profile_id: str = Field(default="C001-sim", min_length=2, max_length=40)
    target_context: ActivityContext
    prior_samples: list[HeartRateSample] = Field(default_factory=list, max_length=500)
    new_sample: HeartRateSample | None = None
    use_clean_demo_reading: bool = False
    symptom_text: str | None = Field(default=None, max_length=500)
    config: VitalsEngineConfig | None = None
    daily_missions: list[DailyMissionItem] | None = None
    adaptation_rules: MissionAdaptationRules | None = None
    use_daily_context: bool = True
    confirmed_rest_for_remeasure: bool = False


class ConfirmAdaptedMissionsRequest(BaseModel):
    """Confirmación humana explícita de misiones diarias adaptadas."""

    confirmation_token: str = Field(..., min_length=4, max_length=80)
    mission_ids: list[str] = Field(default_factory=list)
    confirmed: bool = True


class ConfirmAdaptedMissionsResponse(BaseModel):
    """Respuesta de confirmación de misiones adaptadas."""

    confirmation_token: str
    status: Literal["confirmed", "rejected"]
    confirmed_missions: list[DailyMissionItem]
    recorded_at: str
    simulated_only: Literal[True] = True


# Almacén en memoria para confirmaciones de misiones adaptadas y auditoría (solo sesión simulada)
_ADAPTATION_MAX_RECORDS = 200
_ADAPTATION_TTL_SECONDS = 86400


class _AdaptationRecord(BaseModel):
    profile_id: str
    evaluation: VitalEvaluationResult
    anomaly_severity: str
    measurement_quality: str
    latest_quality: SignalQuality | None = None
    latest_signal_quality_score: float | None = None
    latest_measurement_confirmed: bool | None = None
    policy_row: PolicyTableRow
    has_active_symptoms: bool = False
    missions: list[DailyMissionItem]
    expires_at_utc: str


_ADAPTATION_STORE: dict[str, _AdaptationRecord] = {}
_AUDIT_TRAIL_STORE: list[MissionPolicyAuditEntry] = []


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _purge_expired_adaptations(now: datetime | None = None) -> int:
    current = now or _utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    expired = [
        tok
        for tok, rec in _ADAPTATION_STORE.items()
        if current >= datetime.fromisoformat(rec.expires_at_utc)
    ]
    for tok in expired:
        del _ADAPTATION_STORE[tok]
    return len(expired)


def _store_adaptation(token: str, record: _AdaptationRecord) -> None:
    _purge_expired_adaptations()
    if token not in _ADAPTATION_STORE and len(_ADAPTATION_STORE) >= _ADAPTATION_MAX_RECORDS:
        oldest_key = next(iter(_ADAPTATION_STORE))
        del _ADAPTATION_STORE[oldest_key]
    _ADAPTATION_STORE[token] = record


def _record_audit_entry(entry: MissionPolicyAuditEntry) -> None:
    _AUDIT_TRAIL_STORE.append(entry)
    if len(_AUDIT_TRAIL_STORE) > 200:
        del _AUDIT_TRAIL_STORE[: len(_AUDIT_TRAIL_STORE) - 200]


def _default_daily_missions() -> list[DailyMissionItem]:
    return [
        DailyMissionItem(
            mission_id="eva_prep_check",
            title="Revisión de equipo y lista de chequeo EVA",
            duration_min=20,
            intensity="low",
            category="checklist",
        ),
        DailyMissionItem(
            mission_id="ergometer_cycle",
            title="Sesión de cicloergómetro programada",
            duration_min=30,
            intensity="high",
            category="exercise",
        ),
        DailyMissionItem(
            mission_id="core_mobility",
            title="Movilidad y resistencia moderada",
            duration_min=20,
            intensity="moderate",
            category="exercise",
        ),
    ]


def _make_series(
    values: list[tuple[float | None, SignalQuality, float | None, bool]],
    context: ActivityContext,
) -> list[HeartRateSample]:
    base_time = datetime(2026, 11, 14, 8, 0, 0, tzinfo=timezone.utc)
    return [
        HeartRateSample(
            value_bpm=val,
            context=context,
            quality=qual,
            signal_quality_score=qscore,
            measurement_confirmed=confirmed,
            timestamp=base_time + timedelta(minutes=10 * idx),
            source="simulated_demo_preset",
        )
        for idx, (val, qual, qscore, confirmed) in enumerate(values)
    ]


def _build_demo_presets() -> dict[str, dict[str, Any]]:
    return {
        "nominal_rest": {
            "preset_id": "nominal_rest",
            "label": "Reposo nominal (simulado)",
            "description": "Serie estable en reposo con 7 lecturas válidas confirmadas dentro de la línea base personal.",
            "target_context": ActivityContext.REST,
            "symptom_text": "Sin molestias ni mareos",
            "samples": _make_series(
                [
                    (68.0, SignalQuality.GOOD, 0.95, True),
                    (70.0, SignalQuality.GOOD, 0.96, True),
                    (69.0, SignalQuality.GOOD, 0.94, True),
                    (71.0, SignalQuality.GOOD, 0.95, True),
                    (70.0, SignalQuality.GOOD, 0.97, True),
                    (69.0, SignalQuality.GOOD, 0.95, True),
                    (71.0, SignalQuality.GOOD, 0.96, True),
                ],
                ActivityContext.REST,
            ),
        },
        "sustained_rest_deviation": {
            "preset_id": "sustained_rest_deviation",
            "label": "Desviación sostenida en reposo (simulado)",
            "description": "Línea base ~70 bpm seguida de 3 lecturas sostenidas entre 90 y 95 bpm en reposo.",
            "target_context": ActivityContext.REST,
            "symptom_text": "Sin dolor en el pecho, ligera fatiga operativa",
            "samples": _make_series(
                [
                    (69.0, SignalQuality.GOOD, 0.96, True),
                    (71.0, SignalQuality.GOOD, 0.95, True),
                    (70.0, SignalQuality.GOOD, 0.94, True),
                    (68.0, SignalQuality.GOOD, 0.97, True),
                    (70.0, SignalQuality.GOOD, 0.95, True),
                    (71.0, SignalQuality.GOOD, 0.96, True),
                    (88.0, SignalQuality.GOOD, 0.93, True),
                    (92.0, SignalQuality.GOOD, 0.94, True),
                    (96.0, SignalQuality.GOOD, 0.95, True),
                ],
                ActivityContext.REST,
            ),
        },
        "transient_activity_spike": {
            "preset_id": "transient_activity_spike",
            "label": "Pico aislado en actividad (simulado)",
            "description": "Serie en actividad ~118 bpm con un único pico aislado de 150 bpm; no sostenido.",
            "target_context": ActivityContext.ACTIVITY,
            "symptom_text": "Sin síntomas activos",
            "samples": _make_series(
                [
                    (116.0, SignalQuality.GOOD, 0.92, True),
                    (118.0, SignalQuality.GOOD, 0.93, True),
                    (120.0, SignalQuality.GOOD, 0.91, True),
                    (117.0, SignalQuality.GOOD, 0.94, True),
                    (119.0, SignalQuality.GOOD, 0.92, True),
                    (118.0, SignalQuality.GOOD, 0.93, True),
                    (150.0, SignalQuality.GOOD, 0.90, True),
                ],
                ActivityContext.ACTIVITY,
            ),
        },
        "suspect_quality_sleep": {
            "preset_id": "suspect_quality_sleep",
            "label": "Calidad sospechosa en sueño (simulado)",
            "description": "Lectura más reciente con señal ruidosa (calidad noisy, score 0.35): solicita remedición sin alterar misiones.",
            "target_context": ActivityContext.SLEEP,
            "symptom_text": None,
            "samples": _make_series(
                [
                    (57.0, SignalQuality.GOOD, 0.95, True),
                    (58.0, SignalQuality.GOOD, 0.94, True),
                    (56.0, SignalQuality.GOOD, 0.96, True),
                    (58.0, SignalQuality.GOOD, 0.95, True),
                    (57.0, SignalQuality.GOOD, 0.94, True),
                    (112.0, SignalQuality.NOISY, 0.35, False),
                ],
                ActivityContext.SLEEP,
            ),
        },
        "insufficient_baseline_rest": {
            "preset_id": "insufficient_baseline_rest",
            "label": "Línea base insuficiente (simulado)",
            "description": "Solo 3 muestras válidas en reposo (< 5 requeridas); continúa recopilación sin inferir anomalía.",
            "target_context": ActivityContext.REST,
            "symptom_text": None,
            "samples": _make_series(
                [
                    (70.0, SignalQuality.GOOD, 0.95, True),
                    (72.0, SignalQuality.GOOD, 0.94, True),
                    (71.0, SignalQuality.GOOD, 0.96, True),
                ],
                ActivityContext.REST,
            ),
        },
        "urgent_symptom_activity": {
            "preset_id": "urgent_symptom_activity",
            "label": "Síntoma urgente en actividad (simulado)",
            "description": "Lecturas limpias en actividad con síntoma urgente reportado: detiene misión demo y solicita contacto con equipo médico.",
            "target_context": ActivityContext.ACTIVITY,
            "symptom_text": "Dolor en el pecho y mareo durante actividad",
            "samples": _make_series(
                [
                    (116.0, SignalQuality.GOOD, 0.93, True),
                    (118.0, SignalQuality.GOOD, 0.94, True),
                    (119.0, SignalQuality.GOOD, 0.92, True),
                    (117.0, SignalQuality.GOOD, 0.95, True),
                    (120.0, SignalQuality.GOOD, 0.93, True),
                    (118.0, SignalQuality.GOOD, 0.94, True),
                ],
                ActivityContext.ACTIVITY,
            ),
        },
    }


_EXPECTED_RECENT_ACTIVITY: dict[ActivityContext, tuple[str, ...]] = {
    ActivityContext.REST: ("rest",),
    ActivityContext.ACTIVITY: ("activity",),
    ActivityContext.SLEEP: ("sleep_recovery",),
}


def _resolve_daily_context_for_vitals(
    profile_id: str,
    target_context: ActivityContext,
    use_daily_context: bool,
) -> DailyContextVitalsView | None:
    if not use_daily_context:
        return None
    ctx = DAILY_CONTEXT_STORE.get_vitals_view(profile_id)
    if ctx is None:
        return None
    expected_values = _EXPECTED_RECENT_ACTIVITY.get(target_context, ())
    if (
        ctx.recent_activity_status == "answered"
        and ctx.recent_activity_value is not None
        and expected_values
        and ctx.recent_activity_value not in expected_values
    ):
        ctx.context_mismatch = True
        ctx.context_note = (
            f"Desajuste de contexto: la entrevista diaria reportó '{ctx.recent_activity_value}' "
            f"y no coincide con el contexto objetivo '{target_context.value}'; "
            "no se compara esta lectura con la línea base objetivo. Confirma el contexto y remide."
        )
    elif ctx.recent_activity_status in ("ambiguous", "expired"):
        ctx.context_uncertain = True
        ctx.context_note = (
            f"Contexto de actividad reciente '{ctx.recent_activity_status}': no se asume "
            f"'{target_context.value}'; se solicita remedición con contexto confirmado."
        )
    elif ctx.recent_activity_status == "skipped":
        ctx.context_note = (
            f"Actividad reciente omitida (skipped) en la entrevista; no se asume "
            f"'{target_context.value}' ni patología."
        )
    return ctx


def _compute_quality_summary(
    context_samples: list[HeartRateSample],
    evaluation: VitalEvaluationResult,
    daily_ctx: DailyContextVitalsView | None = None,
) -> QualitySummary:
    latest = context_samples[-1] if context_samples else None
    signal_suspect = evaluation.status in ("low_quality", "missing_data") or (
        evaluation.window_summary.rejected_latest_reason is not None
    )
    context_suspect = bool(
        daily_ctx is not None and (daily_ctx.context_mismatch or daily_ctx.context_uncertain)
    )
    suspect = signal_suspect or context_suspect
    remeasure_reason: str | None = None
    if signal_suspect:
        reason_code = evaluation.window_summary.rejected_latest_reason or evaluation.status
        remeasure_reason = (
            f"Calidad de señal sospechosa o lectura no confirmada ({reason_code}). "
            "Se solicita remedición antes de actualizar la línea base o ajustar misiones."
        )
    if context_suspect and daily_ctx and daily_ctx.context_note:
        remeasure_reason = (
            f"{remeasure_reason} {daily_ctx.context_note}"
            if remeasure_reason
            else daily_ctx.context_note
        )
    return QualitySummary(
        latest_quality=latest.quality if latest else None,
        latest_signal_quality_score=latest.signal_quality_score if latest else None,
        latest_measurement_confirmed=latest.measurement_confirmed if latest else None,
        suspect_quality=suspect,
        remeasurement_requested=suspect,
        remeasurement_reason=remeasure_reason,
        quality_counts=dict(evaluation.window_summary.quality_counts),
    )


def _compute_trend(
    context_samples: list[HeartRateSample],
    evaluation: VitalEvaluationResult,
    cfg: VitalsEngineConfig,
) -> TrendSummary:
    center = evaluation.baseline.baseline_center_bpm
    threshold = evaluation.baseline.effective_delta_threshold_bpm
    points: list[TrendPoint] = []
    valid_values: list[float] = []

    for idx, sample in enumerate(context_samples):
        is_valid = (
            sample.value_bpm is not None
            and sample.quality == SignalQuality.GOOD
            and (
                sample.signal_quality_score is None
                or sample.signal_quality_score >= cfg.min_signal_quality_score
            )
            and (not cfg.require_measurement_confirmation or sample.measurement_confirmed)
        )
        if is_valid and sample.value_bpm is not None:
            valid_values.append(float(sample.value_bpm))
        deviating = (
            is_valid
            and sample.value_bpm is not None
            and center is not None
            and threshold is not None
            and abs(float(sample.value_bpm) - center) >= threshold
        )
        points.append(
            TrendPoint(
                index=idx,
                value_bpm=sample.value_bpm,
                context=sample.context,
                quality=sample.quality,
                signal_quality_score=sample.signal_quality_score,
                measurement_confirmed=sample.measurement_confirmed,
                valid_for_engine=is_valid,
                deviating_from_baseline=deviating,
            )
        )

    slope: float | None = None
    direction: Literal["rising", "falling", "stable", "insufficient_data"] = "insufficient_data"
    if len(valid_values) >= 3:
        recent = valid_values[-3:]
        slope = round((recent[-1] - recent[0]) / 2.0, 2)
        if slope >= 3.0:
            direction = "rising"
        elif slope <= -3.0:
            direction = "falling"
        else:
            direction = "stable"

    return TrendSummary(
        direction=direction,
        delta_from_baseline_bpm=evaluation.window_summary.delta_from_baseline_bpm,
        recent_slope_bpm=slope,
        valid_point_count=len(valid_values),
        points=points,
    )


def _build_zone_highlight(
    evaluation: VitalEvaluationResult,
    quality_summary: QualitySummary,
    daily_ctx: DailyContextVitalsView | None = None,
) -> ZoneSystemHighlight:
    status = evaluation.status
    urgent_from_ctx = bool(daily_ctx is not None and daily_ctx.urgent_red_flag)
    symptom_text = evaluation.symptom_context.raw_text or ""
    urgent = urgent_from_ctx or is_emergency(symptom_text)
    active_symptoms = bool(
        evaluation.symptom_context.has_active_symptoms
        or (daily_ctx is not None and daily_ctx.has_active_symptoms)
    )
    if urgent:
        severity: Literal["nominal", "attention", "priority", "insufficient_data"] = "priority"
        zone: Literal["thorax", "head", "abdomen", "musculoskeletal", "systemic", "none"] = "thorax"
        allowed = ["pause_exertion", "request_recheck", "record_observation"]
    elif active_symptoms:
        severity = "attention"
        zone = "systemic"
        allowed = ["record_observation", "request_recheck"]
    elif quality_summary.suspect_quality or status in (
        "low_quality",
        "missing_data",
        "insufficient_baseline",
    ):
        severity = "insufficient_data"
        zone = "thorax" if quality_summary.suspect_quality else "none"
        allowed = ["request_recheck", "record_observation"]
    elif status == "sustained_deviation":
        severity = "attention"
        zone = "thorax"
        allowed = ["reduce_mission_intensity", "request_recheck", "record_observation", "open_system_view"]
    elif status == "transient_spike":
        severity = "attention"
        zone = "thorax"
        allowed = ["request_recheck", "record_observation", "open_system_view"]
    else:
        severity = "nominal"
        zone = "none"
        allowed = ["record_observation", "open_system_view"]

    reason_text = evaluation.explanation[:300]
    if daily_ctx and (daily_ctx.context_mismatch or daily_ctx.context_uncertain) and daily_ctx.context_note and not urgent_from_ctx:
        reason_text = daily_ctx.context_note[:300]

    event = Integration3DEvent(
        zone=zone,
        severity=severity,
        reason=reason_text,
        source="simulated",
        allowed_actions=allowed,  # type: ignore[arg-type]
    )

    ref_ctx = evaluation.reference_range_context or {}
    citation = ref_ctx.get("citation")
    info_text = (
        f"Contexto '{evaluation.context.value}': el motor compara lecturas válidas confirmadas "
        "contra la línea base personal de ese mismo contexto. Los rangos poblacionales son solo "
        "referencia educativa y nunca constituyen un diagnóstico médico."
    )
    if quality_summary.suspect_quality:
        info_text += " Ante calidad sospechosa o desajuste de contexto se prioriza repetir la medición antes de actuar."

    return ZoneSystemHighlight(
        zone=zone,
        system="cardiovascular",
        severity=severity,
        event_3d=event,
        non_clinical_title="Sistema Cardiovascular · Zona Tórax (Información educativa no clínica)",
        non_clinical_info=info_text,
        reference_citation=citation,
        is_clinical_diagnosis=False,
        limitations=[
            "Detección simulada con fines educativos y operativos.",
            "No diagnostica arritmias, cardiopatías ni condiciones clínicas.",
            "Los umbrales por defecto son ilustrativos y configurables.",
        ],
    )


def _adapt_daily_missions(
    missions: list[DailyMissionItem],
    evaluation: VitalEvaluationResult,
    quality_summary: QualitySummary,
    rules: MissionAdaptationRules,
    *,
    profile_id: str = "C001-sim",
    symptom_text: str | None = None,
    daily_ctx: DailyContextVitalsView | None = None,
) -> MissionAdaptationResult:
    token = f"adapt-{uuid.uuid4().hex[:10]}"
    originals = [m.model_copy(deep=True) for m in missions]

    anomaly_severity, measurement_quality, _ctx = classify_policy_inputs(
        evaluation=evaluation,
        suspect_quality=quality_summary.suspect_quality,
        latest_measurement_confirmed=quality_summary.latest_measurement_confirmed,
        symptom_text=symptom_text,
    )
    if daily_ctx is not None and daily_ctx.urgent_red_flag:
        anomaly_severity = "urgent_symptom"
    policy_row = resolve_policy_row(
        anomaly_severity=anomaly_severity,
        measurement_quality=measurement_quality,
        context=evaluation.context,
        allow_adaptive_adjustment=rules.allow_adaptive_adjustment,
        hold_unchanged_on_suspect_quality=rules.hold_unchanged_on_suspect_quality,
        hold_unchanged_on_transient_spike=rules.hold_unchanged_on_transient_spike,
        reduce_intensity_on_sustained_deviation=rules.reduce_intensity_on_sustained_deviation,
    )
    if (
        evaluation.status == "insufficient_baseline"
        and policy_row.rule_applied == "nominal_keep_plan"
    ):
        policy_row = PolicyTableRow(
            policy_id="P4C_INSUFFICIENT_BASELINE_ABSTAIN",
            priority=6,
            anomaly_severity=anomaly_severity,
            measurement_quality=measurement_quality,
            context=evaluation.context,
            policy_action="unchanged",
            rule_applied="insufficient_baseline_abstain",
            description=(
                "Línea base personal insuficiente: el motor se abstiene de inferir anomalías "
                "o adaptar misiones hasta reunir suficientes muestras válidas."
            ),
        )

    has_poor_sleep = bool(
        daily_ctx is not None
        and daily_ctx.sleep_rest_status == "answered"
        and daily_ctx.sleep_rest_value == "poor"
    )
    has_major_change = bool(
        daily_ctx is not None
        and daily_ctx.routine_change_status == "answered"
        and daily_ctx.routine_change_value == "major_change"
    )

    if policy_row.rule_applied == "nominal_keep_plan" and rules.allow_adaptive_adjustment:
        if has_poor_sleep:
            # Contextual planning only: the astronaut's confirmed self-report may
            # lower simulated workload, but it is not a medical finding or therapy.
            policy_row = PolicyTableRow(
                policy_id="P5_POOR_SLEEP_CONTEXT_LIGHTEN_DEMO",
                priority=7,
                anomaly_severity=anomaly_severity,
                measurement_quality=measurement_quality,
                context=evaluation.context,
                policy_action="lighten_demo_mission",
                rule_applied="poor_sleep_context_lighten_demo_mission",
                description=(
                    "Ante descanso reportado como deficiente y datos nominales, proponer "
                    "menor carga para misiones demo que requieren confirmación humana."
                ),
            )
        elif has_major_change:
            policy_row = PolicyTableRow(
                policy_id="P6_MAJOR_ROUTINE_CHANGE_REVIEW",
                priority=8,
                anomaly_severity=anomaly_severity,
                measurement_quality=measurement_quality,
                context=evaluation.context,
                policy_action="unchanged",
                rule_applied="major_routine_change_review",
                description=(
                    "Ante un cambio de rutina autodeclarado, añadir una revisión confirmable "
                    "del horario sin modificar la carga de otras misiones."
                ),
            )

    adapted: list[DailyMissionItem] = []
    mission_changes: list[MissionChangeAudit] = []
    adjusted = False
    summary = ""
    safety_note = ""

    if policy_row.policy_action == "stop_and_contact_medical":
        for m in originals:
            updated_m = m.model_copy(
                update={
                    "intensity": "paused",
                    "status": "paused",
                    "adjustment_reason": MEDICAL_CONTACT_NOTICE_ES,
                    "confirmed": False,
                }
            )
            adapted.append(updated_m)
            mission_changes.append(
                MissionChangeAudit(
                    mission_id=m.mission_id,
                    before_intensity=m.intensity,
                    after_intensity="paused",
                    before_duration_min=m.duration_min,
                    after_duration_min=m.duration_min,
                    status="paused",
                    reason=MEDICAL_CONTACT_NOTICE_ES,
                )
            )
        adjusted = bool(adapted)
        summary = MEDICAL_CONTACT_NOTICE_ES
        safety_note = (
            "Detención operativa por síntoma urgente. Contactar equipo médico de la misión; "
            "sin diagnóstico ni prescripción de recuperación y sin mutar signos vitales reales."
        )
    elif policy_row.policy_action == "remeasure":
        adapted = [m.model_copy(deep=True) for m in originals]
        remeasure_reason = (
            "Señal incierta o lectura no confirmada; se solicita remedición sin alterar la carga diaria."
        )
        remeasure_item = DailyMissionItem(
            mission_id="remeasure_hr_check",
            title="Repetir medición de pulso con sensor estable",
            duration_min=2,
            intensity="low",
            category="quality_check",
            status="remeasurement_added",
            adjustment_reason=remeasure_reason,
        )
        adapted.insert(0, remeasure_item)
        mission_changes.append(
            MissionChangeAudit(
                mission_id=remeasure_item.mission_id,
                before_intensity="low",
                after_intensity="low",
                before_duration_min=0,
                after_duration_min=remeasure_item.duration_min,
                status="remeasurement_added",
                reason=remeasure_reason,
            )
        )
        adjusted = True
        summary = "Calidad sospechosa: misiones existentes conservadas y tarea de remedición añadida (requiere confirmación)."
        safety_note = "Nunca se degrada la rutina por lecturas ruidosas sin reconfirmar."
    elif policy_row.policy_action == "lighten_demo_mission":
        target_intensity = rules.sustained_target_intensity
        sleep_context_adjustment = (
            policy_row.rule_applied == "poor_sleep_context_lighten_demo_mission"
        )
        for m in originals:
            if m.intensity in ("high", "moderate"):
                adjusted = True
                new_duration = max(5, round(m.duration_min * rules.duration_reduction_factor))
                new_status: Literal["intensity_reduced", "paused"] = (
                    "paused" if target_intensity == "paused" else "intensity_reduced"
                )
                reason = (
                    "Descanso reportado como deficiente: se propone menor carga para esta "
                    "misión de demostración; confirma o rechaza el cambio."
                    if sleep_context_adjustment
                    else (
                        f"Política {policy_row.policy_id} ({evaluation.context.value}): "
                        f"misión demo aligerada a '{target_intensity}' sujeto a confirmación."
                    )
                )
                adapted.append(
                    m.model_copy(
                        update={
                            "intensity": target_intensity,
                            "duration_min": new_duration,
                            "status": new_status,
                            "adjustment_reason": reason,
                            "confirmed": False,
                        }
                    )
                )
                mission_changes.append(
                    MissionChangeAudit(
                        mission_id=m.mission_id,
                        before_intensity=m.intensity,
                        after_intensity=target_intensity,
                        before_duration_min=m.duration_min,
                        after_duration_min=new_duration,
                        status=new_status,
                        reason=reason,
                    )
                )
            else:
                adapted.append(m.model_copy(deep=True))
        if sleep_context_adjustment:
            summary = (
                "Según tu respuesta de descanso, se propone reducir la carga de algunas "
                "misiones de demostración. Revisa y confirma antes de aplicarlas."
            )
            safety_note = (
                "Ajuste opcional basado solo en contexto autodeclarado; no es una "
                "recomendación médica ni una prescripción de recuperación."
            )
            if has_major_change:
                review_item = DailyMissionItem(
                    mission_id="review_routine_change",
                    title="Revisar el cambio de rutina con el plan de misión",
                    duration_min=3,
                    intensity="low",
                    category="context_review",
                    status="context_review_added",
                    adjustment_reason=(
                        "Cambio importante de rutina reportado; revisar el horario y confirmar "
                        "si las misiones siguen siendo adecuadas."
                    ),
                )
                adapted.insert(0, review_item)
                mission_changes.append(
                    MissionChangeAudit(
                        mission_id=review_item.mission_id,
                        before_intensity="low",
                        after_intensity="low",
                        before_duration_min=0,
                        after_duration_min=review_item.duration_min,
                        status="context_review_added",
                        reason=review_item.adjustment_reason,
                    )
                )
                summary += " Además, se añadió una revisión del horario por el cambio de rutina."
        else:
            summary = "Desviación sostenida detectada (simulada): se propone reducir carga física sujeto a confirmación humana."
            safety_note = "Ajuste operativo no clínico. Requiere confirmación explícita y no muta datos reales."
    else:
        adapted = [m.model_copy(deep=True) for m in originals]
        adjusted = False
        if policy_row.rule_applied == "adaptive_adjustment_disabled":
            summary = "Ajuste adaptativo deshabilitado por configuración; plan diario sin cambios."
            safety_note = "Plan simulado sin cambios; signos vitales reales intactos."
        elif policy_row.rule_applied == "transient_spike_recheck_only":
            summary = "Variación aislada no sostenida: se mantiene el plan diario y se recomienda reconfirmación."
            safety_note = "Los picos aislados no disparan reducción automática de misiones."
        elif policy_row.rule_applied == "insufficient_baseline_abstain":
            summary = (
                "Abstención operativa por línea base personal insuficiente: "
                "se mantienen las misiones diarias sin inferir anomalías."
            )
            safety_note = "Se requieren más muestras válidas antes de evaluar desviaciones personales."
        elif policy_row.rule_applied == "major_routine_change_review":
            review_item = DailyMissionItem(
                mission_id="review_routine_change",
                title="Revisar el cambio de rutina con el plan de misión",
                duration_min=3,
                intensity="low",
                category="context_review",
                status="context_review_added",
                adjustment_reason=(
                    "Cambio importante de rutina reportado; revisar el horario y confirmar "
                    "si las misiones siguen siendo adecuadas."
                ),
            )
            adapted.insert(0, review_item)
            mission_changes.append(
                MissionChangeAudit(
                    mission_id=review_item.mission_id,
                    before_intensity="low",
                    after_intensity="low",
                    before_duration_min=0,
                    after_duration_min=review_item.duration_min,
                    status="context_review_added",
                    reason=review_item.adjustment_reason,
                )
            )
            adjusted = True
            summary = (
                "Se añadió una revisión del horario por el cambio de rutina que reportaste. "
                "Las demás misiones siguen iguales hasta que las confirmes."
            )
            safety_note = (
                "Ajuste de organización basado en contexto autodeclarado; no es consejo médico."
            )
        else:
            summary = f"Estado '{evaluation.status}': misiones diarias mantenidas sin modificaciones."
            safety_note = "Datos simulados aislados; sin cambios automáticos."

    has_active_symptoms = (
        evaluation.symptom_context.has_active_symptoms
        or bool(daily_ctx is not None and daily_ctx.has_active_symptoms)
    )
    if (
        has_active_symptoms
        and rules.allow_adaptive_adjustment
        and rules.pause_high_load_on_active_symptoms
        and policy_row.policy_action in ("unchanged", "lighten_demo_mission")
    ):
        pause_reason = (
            "Síntomas activos reportados: se propone pausar carga alta de demostración "
            "sujeto a confirmación humana (no es diagnóstico ni prescripción)."
        )
        paused_any = False
        for idx, m in enumerate(adapted):
            if m.intensity == "high":
                adapted[idx] = m.model_copy(
                    update={
                        "intensity": "paused",
                        "status": "paused",
                        "adjustment_reason": pause_reason,
                        "confirmed": False,
                    }
                )
                mission_changes.append(
                    MissionChangeAudit(
                        mission_id=m.mission_id,
                        before_intensity=m.intensity,
                        after_intensity="paused",
                        before_duration_min=m.duration_min,
                        after_duration_min=m.duration_min,
                        status="paused",
                        reason=pause_reason,
                    )
                )
                paused_any = True
        if paused_any:
            adjusted = True
            summary += " Carga alta pausada preventivamente por síntomas activos (sujeto a confirmación)."

    audit_entry = build_audit_entry(
        profile_id=profile_id,
        evaluation=evaluation,
        anomaly_severity=anomaly_severity,
        measurement_quality=measurement_quality,
        latest_quality=quality_summary.latest_quality,
        latest_signal_quality_score=quality_summary.latest_signal_quality_score,
        latest_measurement_confirmed=quality_summary.latest_measurement_confirmed,
        policy_row=policy_row,
        mission_changes=mission_changes,
        summary=summary,
        has_active_symptoms=has_active_symptoms,
    )
    _record_audit_entry(audit_entry)
    _store_adaptation(
        token,
        _AdaptationRecord(
            profile_id=profile_id,
            evaluation=evaluation,
            anomaly_severity=anomaly_severity,
            measurement_quality=measurement_quality,
            latest_quality=quality_summary.latest_quality,
            latest_signal_quality_score=quality_summary.latest_signal_quality_score,
            latest_measurement_confirmed=quality_summary.latest_measurement_confirmed,
            policy_row=policy_row,
            has_active_symptoms=has_active_symptoms,
            missions=adapted,
            expires_at_utc=(_utc_now() + timedelta(seconds=_ADAPTATION_TTL_SECONDS)).isoformat(),
        ),
    )

    return MissionAdaptationResult(
        adjusted=adjusted,
        policy_action=policy_row.policy_action,
        matched_policy_id=policy_row.policy_id,
        rule_applied=policy_row.rule_applied,
        summary=summary,
        stop_activity=policy_row.stop_activity,
        contact_medical_team=policy_row.contact_medical_team,
        medical_contact_notice=(
            MEDICAL_CONTACT_NOTICE_ES if policy_row.contact_medical_team else None
        ),
        confirmation_token=token,
        rules_snapshot=rules,
        original_missions=originals,
        adapted_missions=adapted,
        audit_entry=audit_entry,
        safety_note=safety_note,
    )


def _run_analysis(
    profile_id: str,
    target_context: ActivityContext,
    samples: list[HeartRateSample],
    preset_used: str | None,
    symptom_text: str | None,
    config: VitalsEngineConfig | None,
    daily_missions: list[DailyMissionItem] | None,
    adaptation_rules: MissionAdaptationRules | None,
    use_daily_context: bool = True,
) -> VitalsAnalyzeResponse:
    cfg = config or VitalsEngineConfig()
    rules = adaptation_rules or MissionAdaptationRules()
    missions = daily_missions if daily_missions is not None else _default_daily_missions()
    daily_ctx = _resolve_daily_context_for_vitals(
        profile_id=profile_id,
        target_context=target_context,
        use_daily_context=use_daily_context,
    )

    evaluation = evaluate_heart_rate_series(
        samples=samples,
        target_context=target_context,
        config=cfg,
        symptom_text=symptom_text,
    )
    context_samples = [s for s in samples if s.context == target_context]
    quality_summary = _compute_quality_summary(context_samples, evaluation, daily_ctx=daily_ctx)
    trend = _compute_trend(context_samples, evaluation, cfg)
    zone_highlight = _build_zone_highlight(evaluation, quality_summary, daily_ctx=daily_ctx)
    mission_adaptation = _adapt_daily_missions(
        missions,
        evaluation,
        quality_summary,
        rules,
        profile_id=profile_id,
        symptom_text=symptom_text,
        daily_ctx=daily_ctx,
    )

    return VitalsAnalyzeResponse(
        profile_id=profile_id,
        preset_used=preset_used,
        evaluation=evaluation,
        quality_summary=quality_summary,
        trend=trend,
        zone_highlight=zone_highlight,
        mission_adaptation=mission_adaptation,
        daily_context_applied=daily_ctx,
    )


@router.get("/presets")
def get_vitals_presets() -> dict[str, Any]:
    """Lista presets deterministas de demostración y reglas seguras configurables."""
    presets = _build_demo_presets()
    return {
        "namespace": "simulation_synthetic",
        "simulated_only": True,
        "is_clinical_diagnosis": False,
        "disclaimer": NON_CLINICAL_DISCLAIMER_ES,
        "default_config": VitalsEngineConfig().model_dump(),
        "default_adaptation_rules": MissionAdaptationRules().model_dump(),
        "default_daily_missions": [m.model_dump() for m in _default_daily_missions()],
        "policy_table": [row.model_dump() for row in EXPLICIT_POLICY_TABLE],
        "presets": [
            {
                "preset_id": item["preset_id"],
                "label": item["label"],
                "description": item["description"],
                "target_context": item["target_context"].value,
                "symptom_text": item["symptom_text"],
                "sample_count": len(item["samples"]),
                "samples": [s.model_dump(mode="json") for s in item["samples"]],
            }
            for item in presets.values()
        ],
    }


@router.get("/policy")
def get_vitals_policy() -> dict[str, Any]:
    """Expone la tabla de política determinista explícita y la matriz completa."""
    return {
        "namespace": "simulation_synthetic",
        "real_vitals_mutated": False,
        "is_clinical_diagnosis": False,
        "prescribes_recovery": False,
        "policy_table": [row.model_dump() for row in EXPLICIT_POLICY_TABLE],
        "policy_matrix": build_policy_matrix_snapshot(),
    }


@router.get("/audit")
def get_vitals_audit(
    profile_id: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Devuelve la pista de auditoría de decisiones de ajuste de misiones."""
    bounded_limit = max(1, min(limit, 200))
    items = _AUDIT_TRAIL_STORE
    if profile_id:
        items = [entry for entry in items if entry.profile_id == profile_id]
    recent = [entry.model_dump() for entry in reversed(items[-bounded_limit:])]
    return {
        "namespace": "simulation_synthetic",
        "count": len(recent),
        "audit_trail": recent,
    }


@router.post("/analyze", response_model=VitalsAnalyzeResponse)
def post_vitals_analyze(req: VitalsAnalyzeRequest) -> VitalsAnalyzeResponse:
    """Evalúa serie simulada o preset determinista con contexto, calidad, tendencia y misiones."""
    presets = _build_demo_presets()
    samples = list(req.samples)
    target_context = req.target_context
    symptom_text = req.symptom_text
    preset_used: str | None = None

    if req.preset_id is not None:
        if req.preset_id not in presets:
            raise HTTPException(
                status_code=404,
                detail=f"Preset determinista desconocido: '{req.preset_id}'.",
            )
        preset = presets[req.preset_id]
        preset_used = req.preset_id
        if not samples:
            samples = list(preset["samples"])
        if target_context is None:
            target_context = preset["target_context"]
        if symptom_text is None:
            symptom_text = preset["symptom_text"]

    if target_context is None:
        target_context = ActivityContext.REST

    return _run_analysis(
        profile_id=req.profile_id,
        target_context=target_context,
        samples=samples,
        preset_used=preset_used,
        symptom_text=symptom_text,
        config=req.config,
        daily_missions=req.daily_missions,
        adaptation_rules=req.adaptation_rules,
        use_daily_context=req.use_daily_context,
    )


@router.post("/remeasure", response_model=VitalsAnalyzeResponse)
def post_vitals_remeasure(req: RemeasureRequest) -> VitalsAnalyzeResponse:
    """Registra una remedición confirmada tras calidad sospechosa y reevalúa la serie."""
    if req.confirmed_rest_for_remeasure and req.target_context == ActivityContext.REST:
        DAILY_CONTEXT_STORE.confirm_rest_for_remeasure(req.profile_id)
    if req.new_sample is not None:
        next_sample = req.new_sample
    elif req.use_clean_demo_reading:
        valid_priors = [
            s.value_bpm
            for s in req.prior_samples
            if s.context == req.target_context
            and s.value_bpm is not None
            and s.quality == SignalQuality.GOOD
            and s.measurement_confirmed
        ]
        fallback_bpm = valid_priors[-1] if valid_priors else 70.0
        next_sample = HeartRateSample(
            value_bpm=fallback_bpm,
            context=req.target_context,
            quality=SignalQuality.GOOD,
            signal_quality_score=0.96,
            measurement_confirmed=True,
            timestamp=datetime.now(timezone.utc),
            source="simulated_remeasurement",
        )
    else:
        raise HTTPException(
            status_code=422,
            detail="Debe proporcionar 'new_sample' o activar 'use_clean_demo_reading'.",
        )

    updated_samples = [*req.prior_samples, next_sample]
    return _run_analysis(
        profile_id=req.profile_id,
        target_context=req.target_context,
        samples=updated_samples,
        preset_used=None,
        symptom_text=req.symptom_text,
        config=req.config,
        daily_missions=req.daily_missions,
        adaptation_rules=req.adaptation_rules,
        use_daily_context=req.use_daily_context,
    )


@router.post("/missions/confirm", response_model=ConfirmAdaptedMissionsResponse)
def post_confirm_adapted_missions(
    req: ConfirmAdaptedMissionsRequest,
) -> ConfirmAdaptedMissionsResponse:
    """Confirma o rechaza explícitamente las misiones diarias adaptadas."""
    _purge_expired_adaptations()
    record = _ADAPTATION_STORE.get(req.confirmation_token)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail="Token de adaptación no encontrado o expirado en la sesión actual.",
        )

    missions = record.missions
    target_ids = set(req.mission_ids) if req.mission_ids else {m.mission_id for m in missions}
    unknown_ids = sorted(target_ids - {m.mission_id for m in missions})
    if unknown_ids:
        raise HTTPException(
            status_code=422,
            detail=f"Misiones no presentes en esta adaptación: {unknown_ids}.",
        )
    updated: list[DailyMissionItem] = []
    confirm_changes: list[MissionChangeAudit] = []
    for m in missions:
        if m.mission_id in target_ids:
            m = m.model_copy(update={"confirmed": req.confirmed})
            confirm_changes.append(
                MissionChangeAudit(
                    mission_id=m.mission_id,
                    before_intensity=m.intensity,
                    after_intensity=m.intensity,
                    before_duration_min=m.duration_min,
                    after_duration_min=m.duration_min,
                    status=m.status,
                    reason=(
                        "Confirmado explícitamente por el usuario."
                        if req.confirmed
                        else "Rechazado explícitamente por el usuario."
                    ),
                )
            )
        updated.append(m)
    _ADAPTATION_STORE[req.confirmation_token] = record.model_copy(update={"missions": updated})

    confirm_rule = (
        "human_confirmation_accepted" if req.confirmed else "human_confirmation_rejected"
    )
    confirm_policy_row = record.policy_row.model_copy(update={"rule_applied": confirm_rule})
    confirm_audit = build_audit_entry(
        profile_id=record.profile_id,
        evaluation=record.evaluation,
        anomaly_severity=record.anomaly_severity,  # type: ignore[arg-type]
        measurement_quality=record.measurement_quality,  # type: ignore[arg-type]
        latest_quality=record.latest_quality,
        latest_signal_quality_score=record.latest_signal_quality_score,
        latest_measurement_confirmed=record.latest_measurement_confirmed,
        policy_row=confirm_policy_row,
        mission_changes=confirm_changes,
        summary=(
            f"Decisión humana registrada ({'confirmada' if req.confirmed else 'rechazada'}) "
            f"para token {req.confirmation_token} ({len(confirm_changes)} misiones)."
        ),
        has_active_symptoms=record.has_active_symptoms,
    )
    _record_audit_entry(confirm_audit)

    return ConfirmAdaptedMissionsResponse(
        confirmation_token=req.confirmation_token,
        status="confirmed" if req.confirmed else "rejected",
        confirmed_missions=[m for m in updated if m.mission_id in target_ids],
        recorded_at=_utc_now().isoformat(),
    )
