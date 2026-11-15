"""Aislamiento de contextos (simulación, laboratorios reales, LLM) y motor determinista."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.contracts import (
    Integration3DEvent,
    InterviewRequest,
    MissionProposal,
    ProposedAction,
)
from app.mission_policy import MEDICAL_CONTACT_NOTICE_ES
from app.safety import is_emergency

# Umbral ilustrativo (0-10) de dolor subjetivo que obliga a escalar al equipo médico.
SEVERE_PAIN_ESCALATION_THRESHOLD = 8

DISCLAIMER_ES = (
    "Prototipo educativo y operativo. No diagnostica enfermedades ni calcula "
    "probabilidades clínicas; los cambios de pulso simulado no prueban lesión de corazón."
)
DISCLAIMER_EN = (
    "Educational and operational prototype. It does not diagnose disease or calculate "
    "clinical probabilities; simulated pulse changes do not prove heart injury."
)

SYNTHETIC_PROFILES: dict[str, dict[str, Any]] = {
    "C001-sim": {
        "profile_id": "C001-sim",
        "alias": "Alex (Simulado)",
        "namespace": "simulation_synthetic",
        "origin": "synthetic",
        "signals": {
            "heart_rate_bpm": {"value": 88, "baseline": 74, "unit": "bpm", "persistence_samples": 3},
            "spo2_pct": {"value": 97, "baseline": 98, "unit": "%", "persistence_samples": 1},
            "sleep_hours": {"value": 6.1, "baseline": 7.2, "unit": "h", "persistence_samples": 2},
            "hydration_ml": {"value": 1100, "baseline": 1800, "unit": "mL", "persistence_samples": 1},
        },
        "source_id": "sim-profile-C001",
    },
    "C002-sim": {
        "profile_id": "C002-sim",
        "alias": "Mika (Simulado)",
        "namespace": "simulation_synthetic",
        "origin": "synthetic",
        "signals": {
            "heart_rate_bpm": {"value": 68, "baseline": 67, "unit": "bpm", "persistence_samples": 1},
            "spo2_pct": {"value": 98, "baseline": 98, "unit": "%", "persistence_samples": 1},
            "sleep_hours": {"value": 7.4, "baseline": 7.3, "unit": "h", "persistence_samples": 1},
            "hydration_ml": {"value": 1750, "baseline": 1800, "unit": "mL", "persistence_samples": 1},
        },
        "source_id": "sim-profile-C002",
    },
    "C003-sim": {
        "profile_id": "C003-sim",
        "alias": "Sam (Simulado)",
        "namespace": "simulation_synthetic",
        "origin": "synthetic",
        "signals": {
            "heart_rate_bpm": {"value": 79, "baseline": 72, "unit": "bpm", "persistence_samples": 2},
            "spo2_pct": {"value": 96, "baseline": 97, "unit": "%", "persistence_samples": 1},
            "sleep_hours": {"value": 5.4, "baseline": 7.0, "unit": "h", "persistence_samples": 3},
            "hydration_ml": {"value": 950, "baseline": 1800, "unit": "mL", "persistence_samples": 2},
        },
        "source_id": "sim-profile-C003",
    },
    "C004-sim": {
        "profile_id": "C004-sim",
        "alias": "Noor (Simulado)",
        "namespace": "simulation_synthetic",
        "origin": "synthetic",
        "signals": {
            "heart_rate_bpm": {"value": 71, "baseline": 70, "unit": "bpm", "persistence_samples": 1},
            "spo2_pct": {"value": 99, "baseline": 98, "unit": "%", "persistence_samples": 1},
            "sleep_hours": {"value": 7.8, "baseline": 7.5, "unit": "h", "persistence_samples": 1},
            "hydration_ml": {"value": 1900, "baseline": 1850, "unit": "mL", "persistence_samples": 1},
        },
        "source_id": "sim-profile-C004",
    },
}

SYSTEM_TO_ZONE = {
    "cardiovascular": "thorax",
    "neurovestibular": "head",
    "musculoskeletal": "musculoskeletal",
    "metabolic": "abdomen",
    "sleep_circadian": "head",
}


def resolve_synthetic_profile(profile_id: str) -> dict[str, Any]:
    """Devuelve el perfil sintético aislado; nunca mezcla datos entre tripulantes."""
    if profile_id in SYNTHETIC_PROFILES:
        return SYNTHETIC_PROFILES[profile_id]
    return {
        "profile_id": profile_id,
        "alias": f"{profile_id} (No registrado)",
        "namespace": "simulation_synthetic",
        "origin": "synthetic",
        "signals": {},
        "source_id": "sim-profile-unknown",
    }


def evaluate_rules_and_3d(
    profile_id: str,
    selected_system: str,
    real_labs_summary: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[Integration3DEvent], list[ProposedAction], list[str]]:
    """Motor determinista independiente del LLM.

    Produce evaluación operativa, eventos 3D validados y acciones propuestas con confirmación.
    """
    profile = resolve_synthetic_profile(profile_id)
    signals = profile.get("signals", {})
    zone = SYSTEM_TO_ZONE.get(selected_system, "systemic")

    if not signals:
        event = Integration3DEvent(
            zone="none",
            severity="insufficient_data",
            reason="Perfil sintético sin señales disponibles; no se infiere estado.",
            source="rules_engine",
            allowed_actions=["record_observation", "request_recheck"],
        )
        assessment = {
            "method": "deterministic-rules-v1",
            "status": "insufficient_data",
            "profile_id": profile_id,
            "namespace": "simulation_synthetic",
            "observations": ["No hay señales sintéticas registradas para este identificador."],
            "pulse_disclaimer": "Cambios de pulso no prueban lesión de corazón.",
        }
        actions = [
            ProposedAction(
                action="request_recheck",
                label="Solicitar nueva lectura simulada",
                requires_confirmation=True,
                target_zone="none",
            )
        ]
        return assessment, [event], actions, [profile["source_id"]]

    hr = signals["heart_rate_bpm"]
    sleep = signals["sleep_hours"]
    hydration = signals["hydration_ml"]
    hr_delta = hr["value"] - hr["baseline"]
    sleep_delta = sleep["value"] - sleep["baseline"]
    hydration_ratio = hydration["value"] / hydration["baseline"] if hydration["baseline"] else 1.0

    observations: list[str] = []
    severity: str = "nominal"
    allowed_actions: list[str] = ["record_observation", "open_system_view"]

    if hr_delta >= 10 and hr["persistence_samples"] >= 3:
        severity = "attention"
        observations.append(
            f"Pulso simulado +{hr_delta} bpm sobre línea base ({hr['value']} vs {hr['baseline']} bpm, "
            f"{hr['persistence_samples']} muestras). Esto es una variación operativa y NO prueba lesión de corazón."
        )
        allowed_actions = [
            "reduce_mission_intensity",
            "request_recheck",
            "record_observation",
        ]
    elif sleep_delta <= -1.2 and sleep["persistence_samples"] >= 2:
        severity = "attention"
        observations.append(
            f"Sueño simulado por debajo de línea base ({sleep['value']}h vs {sleep['baseline']}h). "
            "Se recomienda revisar carga operativa sin emitir diagnóstico."
        )
        allowed_actions = [
            "reduce_mission_intensity",
            "record_observation",
            "open_system_view",
        ]
    else:
        observations.append(
            f"Señales simuladas dentro de margen operativo respecto a línea base "
            f"(pulso {hr['value']} bpm, sueño {sleep['value']}h)."
        )

    if hydration_ratio < 0.7:
        observations.append(
            f"Hidratación simulada registrada en {hydration['value']} mL (<70% de referencia {hydration['baseline']} mL)."
        )
        if "log_hydration" not in allowed_actions:
            allowed_actions.append("log_hydration")

    events = [
        Integration3DEvent(
            zone=zone if severity != "nominal" else "none",
            severity=severity,  # type: ignore[arg-type]
            reason=observations[0][:300],
            source="simulated",
            allowed_actions=allowed_actions,  # type: ignore[arg-type]
        )
    ]

    proposed_actions: list[ProposedAction] = []
    if severity == "attention":
        proposed_actions.append(
            ProposedAction(
                action="reduce_mission_intensity",
                label="Reducir intensidad de la misión activa (requiere confirmación)",
                requires_confirmation=True,
                target_zone=zone,
            )
        )
        proposed_actions.append(
            ProposedAction(
                action="request_recheck",
                label="Programar nueva medición de control",
                requires_confirmation=True,
                target_zone=zone,
            )
        )
    else:
        proposed_actions.append(
            ProposedAction(
                action="record_observation",
                label="Registrar observación operativa del turno",
                requires_confirmation=True,
                target_zone=zone,
            )
        )

    citations = [profile["source_id"], "rules-baseline-v1"]
    if real_labs_summary and real_labs_summary.get("ok_count", 0) > 0:
        citations.append("nasa-osdr-inspiration4-tidy")

    assessment = {
        "method": "deterministic-rules-v1",
        "status": severity,
        "profile_id": profile_id,
        "alias": profile["alias"],
        "namespace": "simulation_synthetic",
        "selected_system": selected_system,
        "signals": signals,
        "observations": observations,
        "pulse_disclaimer": "Cambios de pulso no prueban lesión de corazón.",
        "real_lab_context_isolated": True,
        "real_lab_summary": (
            {
                "namespace": "real_lab_nasa_osdr",
                "ok_count": real_labs_summary.get("ok_count"),
                "excluded_count": real_labs_summary.get("excluded_count"),
                "note": "Solo referencia poblacional Inspiration4; no asignada al perfil simulado.",
            }
            if real_labs_summary
            else None
        ),
    }

    return assessment, events, proposed_actions, citations


def interview_requires_medical_escalation(req: InterviewRequest) -> bool:
    """Guarda determinista: notas con señal de alarma o dolor subjetivo severo.

    No es diagnóstico: solo decide que el plan no debe proponer carga y que hay
    que contactar al equipo médico de la misión. El umbral es ilustrativo y debe
    ser validado por el equipo clínico.
    """
    if is_emergency(req.notes or ""):
        return True
    return bool(req.pain.present and req.pain.intensity >= SEVERE_PAIN_ESCALATION_THRESHOLD)


def build_interview_missions(req: InterviewRequest) -> tuple[str, list[MissionProposal], list[Integration3DEvent]]:
    """Genera propuestas de misiones operativas deterministas sujetas a confirmación."""
    interview_id = f"int-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    missions: list[MissionProposal] = []
    events: list[Integration3DEvent] = []

    if interview_requires_medical_escalation(req):
        # En escalamiento no se proponen misiones que compitan con el contacto médico.
        zone = (
            req.pain.zone
            if req.pain.present and req.pain.zone in ("thorax", "head", "abdomen", "musculoskeletal", "systemic")
            else "systemic"
        )
        events.append(
            Integration3DEvent(
                zone=zone,  # type: ignore[arg-type]
                severity="priority",
                reason=(
                    "Señal de alarma o molestia severa autodeclarada: detener actividad y "
                    "contactar al equipo médico. No es diagnóstico."
                ),
                source="manual",
                allowed_actions=["pause_exertion", "record_observation"],
            )
        )
        missions.append(
            MissionProposal(
                mission_id="stop_and_contact_medical",
                title="Detener actividad y contactar al equipo médico de la misión",
                duration_min=1,
                intensity="paused",
                reason=MEDICAL_CONTACT_NOTICE_ES,
                requires_confirmation=True,
                confirmed=False,
            )
        )
        return interview_id, missions, events

    if not req.hydration_completed:
        missions.append(
            MissionProposal(
                mission_id="hydration_check",
                title="Registrar hidratación matutina (250-500 mL)",
                duration_min=3,
                intensity="low",
                reason="Hidratación matutina marcada como pendiente en la entrevista.",
                requires_confirmation=True,
                confirmed=False,
            )
        )

    if req.pain.present:
        zone = req.pain.zone if req.pain.zone in ("thorax", "head", "abdomen", "musculoskeletal", "systemic") else "systemic"
        severity = "priority" if req.pain.intensity >= 6 else "attention"
        events.append(
            Integration3DEvent(
                zone=zone,  # type: ignore[arg-type]
                severity=severity,  # type: ignore[arg-type]
                reason=f"Molestia subjetiva reportada (intensidad {req.pain.intensity}/10). No es diagnóstico.",
                source="manual",
                allowed_actions=["pause_exertion", "record_observation", "request_recheck"],
            )
        )
        missions.append(
            MissionProposal(
                mission_id="mobility_paused_check",
                title="Pausar ejercicio exigente y registrar seguimiento subjetivo",
                duration_min=5,
                intensity="paused",
                reason="Molestia subjetiva reportada; se evita carga física hasta confirmación.",
                requires_confirmation=True,
                confirmed=False,
            )
        )
    elif req.sleep_quality <= 2 or req.energy <= 2:
        events.append(
            Integration3DEvent(
                zone="head",
                severity="attention",
                reason="Sueño o energía bajos en entrevista matutina; propuesta de rutina ligera.",
                source="manual",
                allowed_actions=["reduce_mission_intensity", "record_observation"],
            )
        )
        missions.append(
            MissionProposal(
                mission_id="mobility_light",
                title="Movilidad ligera adaptada",
                duration_min=8,
                intensity="low",
                reason="Sueño o energía bajos reportados (<=2/5); intensidad reducida.",
                requires_confirmation=True,
                confirmed=False,
            )
        )
    else:
        events.append(
            Integration3DEvent(
                zone="none",
                severity="nominal",
                reason="Entrevista matutina dentro de parámetros operativos nominales.",
                source="manual",
                allowed_actions=["record_observation", "open_system_view"],
            )
        )
        missions.append(
            MissionProposal(
                mission_id="mobility_standard",
                title="Rutina de movilidad programada",
                duration_min=15,
                intensity="moderate",
                reason="Sueño, energía y estado subjetivo nominales.",
                requires_confirmation=True,
                confirmed=False,
            )
        )

    return interview_id, missions, events
