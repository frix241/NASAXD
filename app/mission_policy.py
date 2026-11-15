"""Política determinista explícita y pista de auditoría para ajuste de misiones demo.

Reglas estrictas no clínicas:
- Nunca modifica signos vitales reales (`real_vitals_mutated=False`).
- Nunca diagnostica ni prescribe recuperación (`is_clinical_diagnosis=False`, `prescribes_recovery=False`).
- Resuelve de forma determinista a partir de:
  (1) severidad de anomalía, (2) calidad de medición y (3) contexto de actividad.
- Tabla de política explícita:
  - clean / sin anomalía -> ``unchanged``
  - señal incierta -> ``remeasure``
  - desviación informativa sostenida -> ``lighten_demo_mission``
  - síntoma urgente -> ``stop_and_contact_medical``
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.safety import is_emergency
from app.vitals_engine import (
    ActivityContext,
    SignalQuality,
    VitalEvaluationResult,
    VitalEvaluationStatus,
)

PolicyAction = Literal[
    "unchanged",
    "remeasure",
    "lighten_demo_mission",
    "stop_and_contact_medical",
]

AnomalySeverity = Literal[
    "none",
    "informational_transient",
    "informational_sustained",
    "uncertain_signal",
    "urgent_symptom",
]

MeasurementQualityState = Literal["clean", "uncertain"]

MEDICAL_CONTACT_NOTICE_ES = (
    "Síntoma urgente reportado: detén la actividad de demostración y contacta "
    "de inmediato al equipo médico de la misión. No es un diagnóstico ni una "
    "prescripción de recuperación."
)


class PolicyTableRow(BaseModel):
    """Fila explícita de la tabla de políticas deterministas."""

    policy_id: str
    priority: int
    anomaly_severity: AnomalySeverity | Literal["any"]
    measurement_quality: MeasurementQualityState | Literal["any"]
    context: ActivityContext | Literal["any"]
    policy_action: PolicyAction
    rule_applied: str
    description: str
    stop_activity: bool = False
    contact_medical_team: bool = False
    requires_confirmation: Literal[True] = True
    mutates_real_vitals: Literal[False] = False
    prescribes_recovery: Literal[False] = False
    is_clinical_diagnosis: Literal[False] = False


EXPLICIT_POLICY_TABLE: tuple[PolicyTableRow, ...] = (
    PolicyTableRow(
        policy_id="P1_URGENT_SYMPTOM_STOP_AND_CONTACT_MEDICAL",
        priority=1,
        anomaly_severity="urgent_symptom",
        measurement_quality="any",
        context="any",
        policy_action="stop_and_contact_medical",
        rule_applied="urgent_symptom_stop_and_contact_medical",
        description=(
            "Ante síntoma urgente activo (independiente de calidad o contexto), "
            "detener actividad demo y contactar al equipo médico de la misión."
        ),
        stop_activity=True,
        contact_medical_team=True,
    ),
    PolicyTableRow(
        policy_id="P2_UNCERTAIN_SIGNAL_REMEASURE",
        priority=2,
        anomaly_severity="any",
        measurement_quality="uncertain",
        context="any",
        policy_action="remeasure",
        rule_applied="suspect_quality_request_remeasurement",
        description=(
            "Ante señal incierta o no confirmada (sin síntoma urgente), "
            "solicitar remedición sin degradar las misiones demo."
        ),
    ),
    PolicyTableRow(
        policy_id="P2B_UNCERTAIN_ANOMALY_REMEASURE",
        priority=3,
        anomaly_severity="uncertain_signal",
        measurement_quality="any",
        context="any",
        policy_action="remeasure",
        rule_applied="suspect_quality_request_remeasurement",
        description=(
            "Ante estado de calidad insuficiente o datos faltantes, "
            "solicitar remedición antes de ajustar misiones demo."
        ),
    ),
    PolicyTableRow(
        policy_id="P3_SUSTAINED_INFO_LIGHTEN_DEMO_MISSION",
        priority=4,
        anomaly_severity="informational_sustained",
        measurement_quality="clean",
        context="any",
        policy_action="lighten_demo_mission",
        rule_applied="sustained_deviation_reduce_intensity",
        description=(
            "Ante desviación informativa sostenida con señal limpia y sin síntomas urgentes, "
            "aligerar intensidad/duración de misiones demo sujeto a confirmación humana."
        ),
    ),
    PolicyTableRow(
        policy_id="P4A_TRANSIENT_INFO_UNCHANGED",
        priority=5,
        anomaly_severity="informational_transient",
        measurement_quality="clean",
        context="any",
        policy_action="unchanged",
        rule_applied="transient_spike_recheck_only",
        description=(
            "Ante pico transitorio con señal limpia y sin síntomas urgentes, "
            "mantener misiones demo sin cambios."
        ),
    ),
    PolicyTableRow(
        policy_id="P4B_CLEAN_NO_ANOMALY_UNCHANGED",
        priority=6,
        anomaly_severity="none",
        measurement_quality="clean",
        context="any",
        policy_action="unchanged",
        rule_applied="nominal_keep_plan",
        description=(
            "Con señal limpia y sin anomalía ni síntomas urgentes, "
            "mantener misiones demo sin cambios."
        ),
    ),
)

# Fila de respaldo (fuera de la tabla principal para no alterar la matriz por
# defecto): se usa solo si la remedición fue desactivada por configuración y los
# datos siguen siendo inciertos. Mantiene el plan y se abstiene de ajustar.
UNCERTAIN_DATA_ABSTAIN_ROW = PolicyTableRow(
    policy_id="P2C_UNCERTAIN_DATA_ABSTAIN_UNCHANGED",
    priority=99,
    anomaly_severity="uncertain_signal",
    measurement_quality="uncertain",
    context="any",
    policy_action="unchanged",
    rule_applied="uncertain_data_abstain",
    description=(
        "Datos faltantes o de baja calidad con remedición desactivada: abstenerse "
        "de cualquier ajuste y mantener misiones demo sin cambios."
    ),
)


class MissionChangeAudit(BaseModel):
    """Registro de cambio por misión para trazabilidad determinista."""

    mission_id: str
    before_intensity: Literal["paused", "low", "moderate", "high"]
    after_intensity: Literal["paused", "low", "moderate", "high"]
    before_duration_min: int
    after_duration_min: int
    status: Literal[
        "unchanged", "intensity_reduced", "paused", "remeasurement_added",
        "context_review_added",
    ]
    reason: str | None = None


class MissionPolicyAuditEntry(BaseModel):
    """Entrada inmutable de auditoría para decisiones de ajuste de misión."""

    audit_id: str
    timestamp_utc: str
    profile_id: str
    namespace: Literal["simulation_synthetic"] = "simulation_synthetic"
    anomaly_severity: AnomalySeverity
    evaluation_status: VitalEvaluationStatus
    measurement_quality: MeasurementQualityState
    latest_quality: SignalQuality | None = None
    latest_signal_quality_score: float | None = None
    latest_measurement_confirmed: bool | None = None
    context: ActivityContext
    has_active_symptoms: bool
    active_symptoms: list[str] = Field(default_factory=list)
    matched_policy_id: str
    policy_action: PolicyAction
    rule_applied: str
    stop_activity: bool = False
    contact_medical_team: bool = False
    medical_contact_notice: str | None = None
    mission_changes: list[MissionChangeAudit] = Field(default_factory=list)
    real_vitals_mutated: Literal[False] = False
    is_clinical_diagnosis: Literal[False] = False
    prescribes_recovery: Literal[False] = False
    requires_human_confirmation: Literal[True] = True
    summary: str


def classify_policy_inputs(
    evaluation: VitalEvaluationResult,
    suspect_quality: bool,
    latest_measurement_confirmed: bool | None,
    symptom_text: str | None = None,
) -> tuple[AnomalySeverity, MeasurementQualityState, ActivityContext]:
    """Clasifica determinísticamente severidad, calidad de medición y contexto."""
    # A detected symptom is user-reported context; only the separate, deterministic
    # red-flag classifier may elevate it to the urgent policy row.
    symptom_source = symptom_text or evaluation.symptom_context.raw_text or ""
    has_urgent = is_emergency(symptom_source)
    uncertain = (
        suspect_quality
        or evaluation.status in ("low_quality", "missing_data")
        or latest_measurement_confirmed is False
    )
    measurement_quality: MeasurementQualityState = "uncertain" if uncertain else "clean"

    if has_urgent:
        anomaly_severity: AnomalySeverity = "urgent_symptom"
    elif uncertain:
        anomaly_severity = "uncertain_signal"
    elif evaluation.status == "sustained_deviation":
        anomaly_severity = "informational_sustained"
    elif evaluation.status == "transient_spike":
        anomaly_severity = "informational_transient"
    else:
        # nominal o insufficient_baseline con señal limpia -> sin anomalía confirmada
        anomaly_severity = "none"

    return anomaly_severity, measurement_quality, evaluation.context


def resolve_policy_row(
    anomaly_severity: AnomalySeverity,
    measurement_quality: MeasurementQualityState,
    context: ActivityContext,
    *,
    allow_adaptive_adjustment: bool = True,
    hold_unchanged_on_suspect_quality: bool = True,
    hold_unchanged_on_transient_spike: bool = True,
    reduce_intensity_on_sustained_deviation: bool = True,
) -> PolicyTableRow:
    """Resuelve una fila exacta de ``EXPLICIT_POLICY_TABLE`` de forma determinista."""
    # La guarda de síntoma urgente nunca puede desactivarse por configuración demo.
    if anomaly_severity == "urgent_symptom":
        return EXPLICIT_POLICY_TABLE[0]

    if not allow_adaptive_adjustment:
        return PolicyTableRow(
            policy_id="P0_ADAPTIVE_DISABLED_UNCHANGED",
            priority=0,
            anomaly_severity=anomaly_severity,
            measurement_quality=measurement_quality,
            context=context,
            policy_action="unchanged",
            rule_applied="adaptive_adjustment_disabled",
            description="Ajuste adaptativo deshabilitado por configuración; misiones demo sin cambios.",
        )

    for row in sorted(EXPLICIT_POLICY_TABLE, key=lambda r: r.priority):
        sev_match = row.anomaly_severity in ("any", anomaly_severity)
        qual_match = row.measurement_quality in ("any", measurement_quality)
        ctx_match = row.context in ("any", context)
        if not (sev_match and qual_match and ctx_match):
            continue

        if row.policy_action == "remeasure" and not hold_unchanged_on_suspect_quality:
            continue
        if (
            row.policy_action == "lighten_demo_mission"
            and not reduce_intensity_on_sustained_deviation
        ):
            continue
        if (
            row.rule_applied == "transient_spike_recheck_only"
            and not hold_unchanged_on_transient_spike
        ):
            continue
        return row

    if measurement_quality == "uncertain" or anomaly_severity == "uncertain_signal":
        # Abstención explícita: con datos faltantes o de baja calidad nunca se
        # reporta la fila "señal limpia sin anomalía" ni se habilitan ajustes
        # contextuales que dependan de ``nominal_keep_plan``.
        return UNCERTAIN_DATA_ABSTAIN_ROW
    return EXPLICIT_POLICY_TABLE[-1]


def build_audit_entry(
    *,
    profile_id: str,
    evaluation: VitalEvaluationResult,
    anomaly_severity: AnomalySeverity,
    measurement_quality: MeasurementQualityState,
    latest_quality: SignalQuality | None,
    latest_signal_quality_score: float | None,
    latest_measurement_confirmed: bool | None,
    policy_row: PolicyTableRow,
    mission_changes: list[MissionChangeAudit],
    summary: str,
    has_active_symptoms: bool | None = None,
) -> MissionPolicyAuditEntry:
    """Construye una entrada estructurada de auditoría para la decisión aplicada."""
    return MissionPolicyAuditEntry(
        audit_id=f"audit-{uuid.uuid4().hex[:12]}",
        timestamp_utc=datetime.now(timezone.utc).isoformat(),
        profile_id=profile_id,
        anomaly_severity=anomaly_severity,
        evaluation_status=evaluation.status,
        measurement_quality=measurement_quality,
        latest_quality=latest_quality,
        latest_signal_quality_score=latest_signal_quality_score,
        latest_measurement_confirmed=latest_measurement_confirmed,
        context=evaluation.context,
        has_active_symptoms=(
            evaluation.symptom_context.has_active_symptoms
            or anomaly_severity == "urgent_symptom"
            if has_active_symptoms is None
            else has_active_symptoms
        ),
        active_symptoms=list(evaluation.symptom_context.active_symptoms),
        matched_policy_id=policy_row.policy_id,
        policy_action=policy_row.policy_action,
        rule_applied=policy_row.rule_applied,
        stop_activity=policy_row.stop_activity,
        contact_medical_team=policy_row.contact_medical_team,
        medical_contact_notice=(
            MEDICAL_CONTACT_NOTICE_ES if policy_row.contact_medical_team else None
        ),
        mission_changes=mission_changes,
        summary=summary,
    )


def build_policy_matrix_snapshot() -> list[dict[str, Any]]:
    """Genera la matriz determinista completa (severidad x calidad x contexto)."""
    severities: tuple[AnomalySeverity, ...] = (
        "none",
        "informational_transient",
        "informational_sustained",
        "uncertain_signal",
        "urgent_symptom",
    )
    qualities: tuple[MeasurementQualityState, ...] = ("clean", "uncertain")
    contexts: tuple[ActivityContext, ...] = (
        ActivityContext.REST,
        ActivityContext.ACTIVITY,
        ActivityContext.SLEEP,
    )
    matrix: list[dict[str, Any]] = []
    for sev in severities:
        for qual in qualities:
            for ctx in contexts:
                row = resolve_policy_row(sev, qual, ctx)
                matrix.append(
                    {
                        "anomaly_severity": sev,
                        "measurement_quality": qual,
                        "context": ctx.value,
                        "matched_policy_id": row.policy_id,
                        "policy_action": row.policy_action,
                        "rule_applied": row.rule_applied,
                        "stop_activity": row.stop_activity,
                        "contact_medical_team": row.contact_medical_team,
                        "mutates_real_vitals": row.mutates_real_vitals,
                        "prescribes_recovery": row.prescribes_recovery,
                        "is_clinical_diagnosis": row.is_clinical_diagnosis,
                    }
                )
    return matrix
