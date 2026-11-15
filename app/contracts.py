"""Contratos Pydantic v2 para API, integración 3D, LLM, entrevista y voz."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


ALLOWED_ZONES = (
    "thorax",
    "head",
    "abdomen",
    "musculoskeletal",
    "systemic",
    "none",
)

ALLOWED_SEVERITIES = ("nominal", "attention", "priority", "insufficient_data")

ALLOWED_SOURCES = ("simulated", "real_lab", "manual", "rules_engine")

ALLOWED_ACTIONS = (
    "reduce_mission_intensity",
    "request_recheck",
    "record_observation",
    "log_hydration",
    "pause_exertion",
    "inspect_catalog_parameter",
    "open_system_view",
)


class Integration3DEvent(BaseModel):
    """Contrato estricto para señalización en el gemelo digital 3D."""

    zone: Literal["thorax", "head", "abdomen", "musculoskeletal", "systemic", "none"]
    severity: Literal["nominal", "attention", "priority", "insufficient_data"]
    reason: str = Field(..., min_length=3, max_length=320)
    source: Literal["simulated", "real_lab", "manual", "rules_engine"]
    allowed_actions: list[
        Literal[
            "reduce_mission_intensity",
            "request_recheck",
            "record_observation",
            "log_hydration",
            "pause_exertion",
            "inspect_catalog_parameter",
            "open_system_view",
        ]
    ] = Field(default_factory=list)


class ProposedAction(BaseModel):
    """Acción propuesta por el motor o LLM; siempre requiere confirmación humana."""

    action: Literal[
        "reduce_mission_intensity",
        "request_recheck",
        "record_observation",
        "log_hydration",
        "pause_exertion",
        "inspect_catalog_parameter",
        "open_system_view",
    ]
    label: str = Field(..., min_length=2, max_length=160)
    requires_confirmation: Literal[True] = True
    target_zone: str | None = None


class LLMOutputPayload(BaseModel):
    """Esquema JSON validado que debe devolver el LLM local."""

    answer: str = Field(..., min_length=1, max_length=600)
    citations: list[str] = Field(default_factory=list)
    proposed_actions: list[ProposedAction] = Field(default_factory=list)
    safety_note: str = Field(
        default="Prototipo educativo y operativo. No emite diagnósticos médicos."
    )


class ChatRequest(BaseModel):
    """Entrada del endpoint POST /api/chat."""

    profile_id: str = Field(default="C001-sim", min_length=2, max_length=40)
    message: str = Field(..., min_length=1, max_length=1000)
    language: Literal["es", "en"] = "es"
    selected_system: str = Field(default="cardiovascular", max_length=64)
    include_real_lab_reference: bool = Field(default=False)
    use_llm: bool = Field(default=True)

    @field_validator("message")
    @classmethod
    def strip_message(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("El mensaje no puede estar vacío.")
        return cleaned


class ProvenanceInfo(BaseModel):
    """Procedencia explícita de la respuesta y aislamiento de espacios de nombres."""

    provider: str
    model: str
    llm_available: bool
    mode: Literal["llm", "unavailable", "rules_only"]
    prompt_version: str
    namespaces_isolated: bool = True
    simulation_namespace: str = "simulation_synthetic"
    real_lab_namespace: str = "real_lab_nasa_osdr"
    unavailable_reason: str | None = None
    safety_audit: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    """Salida estructurada del copiloto az³tro."""

    profile_id: str
    origin: Literal["synthetic"] = "synthetic"
    disclaimer: str
    provenance: ProvenanceInfo
    rules_assessment: dict[str, Any]
    llm_output: LLMOutputPayload | None = None
    integration_3d: list[Integration3DEvent]
    limitations: list[str]


class PainInput(BaseModel):
    present: bool = False
    zone: str | None = None
    intensity: int = Field(default=0, ge=0, le=10)


class InterviewRequest(BaseModel):
    """Entrada estructurada de entrevista matutina."""

    profile_id: str = Field(default="C001-sim", min_length=2, max_length=40)
    sleep_quality: int = Field(..., ge=1, le=5)
    energy: int = Field(..., ge=1, le=5)
    pain: PainInput = Field(default_factory=PainInput)
    mood: int = Field(..., ge=1, le=5)
    hydration_completed: bool = True
    notes: str = Field(default="", max_length=500)


class MissionProposal(BaseModel):
    """Misión operativa propuesta para confirmación explícita."""

    mission_id: str
    title: str
    duration_min: int = Field(..., ge=1, le=120)
    intensity: Literal["low", "moderate", "paused"]
    reason: str
    requires_confirmation: Literal[True] = True
    confirmed: bool = False


class InterviewResponse(BaseModel):
    """Salida de POST /api/interview."""

    interview_id: str
    profile_id: str
    namespace: Literal["simulation_synthetic"] = "simulation_synthetic"
    subjective_record: dict[str, Any]
    proposed_missions: list[MissionProposal]
    integration_3d: list[Integration3DEvent]
    disclaimer: str
    llm_summary: str | None = None
    llm_available: bool = False
    # Escalamiento determinista (no diagnóstico); nunca requiere confirmación para mostrarse.
    policy_action: Literal["stop_and_contact_medical"] | None = None
    contact_medical_team: bool = False
    medical_contact_notice: str | None = None


class ConfirmMissionRequest(BaseModel):
    """Confirmación explícita de misiones propuestas."""

    interview_id: str = Field(..., min_length=3, max_length=80)
    mission_ids: list[str] = Field(..., min_length=1)
    confirmed: bool = True


class ConfirmMissionResponse(BaseModel):
    interview_id: str
    confirmed_missions: list[MissionProposal]
    status: Literal["confirmed", "rejected"]
    recorded_at: str


class VoiceServiceContract(BaseModel):
    """Contrato descriptivo para servicios locales opcionales de voz."""

    service: Literal["stt", "tts"]
    engine: str
    endpoint: str
    transport: str
    docker_image: str
    implemented_bridge: bool = False
    tested_in_runtime: bool
    available_now: bool
    status_detail: str
    contract_request: dict[str, Any]
    contract_response: dict[str, Any]
