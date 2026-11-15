"""Contexto diario estructurado por voz/texto con consentimiento, TTL real y aislamiento.

Reglas estrictas:
- Solo almacena contexto confirmado explícitamente por el usuario (`transcript_confirmed_by_user=True`).
- Nunca persiste audio crudo (`audio_persisted=False`).
- No persiste transcripciones textuales salvo consentimiento explícito (`persist_confirmed_transcripts=True`).
- `declared_condition` (condición/medicación autodeclarada) solo se almacena en memoria con
  consentimiento explícito (`declared_condition_consent=True`), TTL acotado y revocación
  inmediata, y NUNCA se envía al LLM ni a modelos ML.
- Skips y ambigüedad son seguros: nunca bloquean ni asumen estado "nominal" o "patológico".
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.safety import is_emergency
from app.vitals_engine import analyze_symptom_context

AnswerStatus = Literal["answered", "skipped", "ambiguous"]
SleepValue = Literal["good", "fair", "poor"]
RecentActivityValue = Literal["rest", "activity", "sleep_recovery"]
RoutineChangeValue = Literal["none", "minor_change", "major_change"]
CaptureMode = Literal["voice_ptt_confirmed", "text_fallback", "mixed", "manual_form"]


class DailyContextConsent(BaseModel):
    """Consentimiento granular de sesión para contexto diario."""

    model_config = ConfigDict(extra="forbid")

    session_context_consent: bool = False
    declared_condition_consent: bool = False
    persist_confirmed_transcripts: bool = False
    revocable: Literal[True] = True


class SleepRestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: AnswerStatus = "skipped"
    value: SleepValue | None = None
    hours: float | None = Field(default=None, ge=0.0, le=24.0)
    confirmed_text: str | None = Field(default=None, max_length=400)


class RecentActivityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: AnswerStatus = "skipped"
    value: RecentActivityValue | None = None
    confirmed_text: str | None = Field(default=None, max_length=400)


class SymptomsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: AnswerStatus = "skipped"
    reported_none: bool = False
    zone: Literal["thorax", "head", "abdomen", "musculoskeletal", "systemic", "none"] = "none"
    confirmed_text: str | None = Field(default=None, max_length=500)


class RoutineChangeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: AnswerStatus = "skipped"
    value: RoutineChangeValue | None = None
    confirmed_text: str | None = Field(default=None, max_length=400)


class DeclaredConditionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["answered", "skipped"] = "skipped"
    note: str | None = Field(default=None, max_length=300)
    medication_note: str | None = Field(default=None, max_length=200)


class DailyContextSubmission(BaseModel):
    """Entrada confirmada por el usuario para la entrevista diaria breve (máx 5 preguntas)."""

    model_config = ConfigDict(extra="forbid")

    profile_id: str = Field(
        default="C001-sim",
        min_length=2,
        max_length=40,
        pattern=r"^[A-Za-z0-9_-]{2,40}$",
    )
    capture_mode: CaptureMode = "manual_form"
    transcript_confirmed_by_user: bool = False
    transcript_edited_by_user: bool = False
    consent: DailyContextConsent
    sleep_rest: SleepRestInput = Field(default_factory=SleepRestInput)
    recent_activity: RecentActivityInput = Field(default_factory=RecentActivityInput)
    symptoms: SymptomsInput = Field(default_factory=SymptomsInput)
    routine_change: RoutineChangeInput = Field(default_factory=RoutineChangeInput)
    declared_condition: DeclaredConditionInput = Field(default_factory=DeclaredConditionInput)
    ttl_seconds: int = Field(default=86400, ge=1, le=86400)
    activity_ttl_seconds: int = Field(default=7200, ge=1, le=7200)


class StoredSymptomsState(BaseModel):
    status: AnswerStatus
    reported_none: bool = False
    has_active_symptoms: bool = False
    urgent_red_flag: bool = False
    active_symptoms: list[str] = Field(default_factory=list)
    negated_symptoms: list[str] = Field(default_factory=list)
    zone: Literal["thorax", "head", "abdomen", "musculoskeletal", "systemic", "none"] = "none"
    confirmed_text: str | None = None


class StoredDeclaredConditionState(BaseModel):
    status: Literal["answered", "skipped"] = "skipped"
    consent_granted: bool = False
    self_reported_non_diagnostic: Literal[True] = True
    isolated_from_llm_and_ml: Literal[True] = True
    note: str | None = None
    medication_note: str | None = None


class DailyContextRecord(BaseModel):
    """Registro en memoria de contexto diario con TTL real y garantías de privacidad."""

    context_id: str
    profile_id: str
    namespace: Literal["simulation_synthetic"] = "simulation_synthetic"
    is_clinical_diagnosis: Literal[False] = False
    prescribes_recovery: Literal[False] = False
    audio_persisted: Literal[False] = False
    transcripts_persisted: bool
    capture_mode: CaptureMode
    transcript_confirmed_by_user: Literal[True] = True
    transcript_edited_by_user: bool = False
    consent: DailyContextConsent
    recorded_at_utc: str
    expires_at_utc: str
    recent_activity_expires_at_utc: str
    sleep_rest: SleepRestInput
    recent_activity: RecentActivityInput
    symptoms: StoredSymptomsState
    routine_change: RoutineChangeInput
    declared_condition: StoredDeclaredConditionState

    def to_redacted_api_dict(self) -> dict[str, Any]:
        """Vista de API que nunca expone texto de condición o medicación declarada."""
        data = self.model_dump()
        has_note = bool(
            self.declared_condition.note or self.declared_condition.medication_note
        )
        data["declared_condition"] = {
            "status": self.declared_condition.status,
            "consent_granted": self.declared_condition.consent_granted,
            "self_reported_non_diagnostic": True,
            "isolated_from_llm_and_ml": True,
            "redacted": has_note,
            "note": None,
            "medication_note": None,
        }
        return data

    def to_llm_safe_dict(self, now: datetime | None = None) -> dict[str, Any]:
        """Vista segura para LLM/ML: excluye por completo condición/medicación declarada."""
        recent_activity_status: str = self.recent_activity.status
        recent_activity_value: RecentActivityValue | None = self.recent_activity.value
        if now is not None:
            current = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
            if current >= _parse_iso(self.recent_activity_expires_at_utc):
                recent_activity_status = "expired"
                recent_activity_value = None

        return {
            "context_id": self.context_id,
            "profile_id": self.profile_id,
            "namespace": self.namespace,
            "sleep_rest": {
                "status": self.sleep_rest.status,
                "value": self.sleep_rest.value,
                "hours": self.sleep_rest.hours,
            },
            "recent_activity": {
                "status": recent_activity_status,
                "value": recent_activity_value,
            },
            "symptoms": {
                "status": self.symptoms.status,
                "has_active_symptoms": self.symptoms.has_active_symptoms,
                "urgent_red_flag": self.symptoms.urgent_red_flag,
                "active_symptoms": list(self.symptoms.active_symptoms),
                "negated_symptoms": list(self.symptoms.negated_symptoms),
            },
            "routine_change": {
                "status": self.routine_change.status,
                "value": self.routine_change.value,
            },
        }


class DailyContextVitalsView(BaseModel):
    """Proyección determinista del contexto diario hacia el motor de vitales y política."""

    context_id: str
    profile_id: str
    recent_activity_status: Literal["answered", "skipped", "ambiguous", "expired"]
    recent_activity_value: RecentActivityValue | None = None
    recent_activity_expired: bool = False
    sleep_rest_status: AnswerStatus
    sleep_rest_value: SleepValue | None = None
    routine_change_status: AnswerStatus
    routine_change_value: RoutineChangeValue | None = None
    urgent_red_flag: bool = False
    has_active_symptoms: bool = False
    active_symptoms: list[str] = Field(default_factory=list)
    negated_symptoms: list[str] = Field(default_factory=list)
    context_mismatch: bool = False
    context_uncertain: bool = False
    context_note: str | None = None


def _parse_iso(ts: str) -> datetime:
    parsed = datetime.fromisoformat(ts)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _normalize_sleep(inp: SleepRestInput) -> SleepRestInput:
    if inp.status == "skipped":
        return SleepRestInput(status="skipped", value=None, hours=None, confirmed_text=None)
    if inp.status == "ambiguous":
        return SleepRestInput(
            status="ambiguous",
            value=inp.value,
            hours=inp.hours,
            confirmed_text=inp.confirmed_text,
        )
    return inp


def _normalize_activity(inp: RecentActivityInput) -> RecentActivityInput:
    if inp.status == "skipped":
        return RecentActivityInput(status="skipped", value=None, confirmed_text=None)
    return inp


def _normalize_routine(inp: RoutineChangeInput) -> RoutineChangeInput:
    if inp.status == "skipped":
        return RoutineChangeInput(status="skipped", value=None, confirmed_text=None)
    return inp


def _evaluate_symptoms(inp: SymptomsInput, persist_transcripts: bool) -> StoredSymptomsState:
    text = (inp.confirmed_text or "").strip()
    if inp.status == "skipped" and not text:
        return StoredSymptomsState(status="skipped", reported_none=False, zone="none")

    urgent = is_emergency(text) if text else False
    symptom_ctx = analyze_symptom_context(text if text else None)

    # Regla de seguridad ante contradicción: si reportó "none" en UI pero el texto
    # confirmado contiene síntomas activos o bandera roja, prevalece el texto.
    has_active = symptom_ctx.has_active_symptoms or urgent
    effective_status: AnswerStatus = inp.status
    if effective_status == "skipped" and text:
        effective_status = "answered"

    return StoredSymptomsState(
        status=effective_status,
        reported_none=inp.reported_none and not has_active,
        has_active_symptoms=has_active,
        urgent_red_flag=urgent,
        active_symptoms=list(symptom_ctx.active_symptoms),
        negated_symptoms=list(symptom_ctx.negated_symptoms),
        zone=inp.zone,
        confirmed_text=text if (persist_transcripts and text) else None,
    )


class DailyContextStore:
    """Almacén en memoria con TTL real y borrado/revocación inmediata."""

    def __init__(
        self,
        now_fn: Callable[[], datetime] | None = None,
        max_records: int = 200,
    ) -> None:
        self._records: dict[str, DailyContextRecord] = {}
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self._max_records = max(1, max_records)

    def _now(self) -> datetime:
        current = self._now_fn()
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        return current

    def purge_expired(self) -> int:
        now = self._now()
        expired_keys = [
            pid
            for pid, rec in self._records.items()
            if now >= _parse_iso(rec.expires_at_utc)
        ]
        for pid in expired_keys:
            del self._records[pid]
        return len(expired_keys)

    def store(self, submission: DailyContextSubmission) -> DailyContextRecord:
        if not submission.transcript_confirmed_by_user:
            raise ValueError("El contexto diario requiere confirmación explícita del usuario.")
        if not submission.consent.session_context_consent:
            raise ValueError("El almacenamiento de contexto requiere consentimiento de sesión.")

        self.purge_expired()
        now = self._now()
        expires_at = now + timedelta(seconds=submission.ttl_seconds)
        activity_expires_at = now + timedelta(
            seconds=min(submission.activity_ttl_seconds, submission.ttl_seconds)
        )
        keep_text = submission.consent.persist_confirmed_transcripts

        sleep = _normalize_sleep(submission.sleep_rest)
        if not keep_text:
            sleep = sleep.model_copy(update={"confirmed_text": None})

        activity = _normalize_activity(submission.recent_activity)
        if not keep_text:
            activity = activity.model_copy(update={"confirmed_text": None})

        routine = _normalize_routine(submission.routine_change)
        if not keep_text:
            routine = routine.model_copy(update={"confirmed_text": None})

        symptoms = _evaluate_symptoms(submission.symptoms, persist_transcripts=keep_text)

        if (
            submission.consent.declared_condition_consent
            and submission.declared_condition.status == "answered"
            and (
                (submission.declared_condition.note or "").strip()
                or (submission.declared_condition.medication_note or "").strip()
            )
        ):
            declared = StoredDeclaredConditionState(
                status="answered",
                consent_granted=True,
                note=(submission.declared_condition.note or "").strip() or None,
                medication_note=(submission.declared_condition.medication_note or "").strip() or None,
            )
        else:
            declared = StoredDeclaredConditionState(
                status="skipped",
                consent_granted=bool(submission.consent.declared_condition_consent),
                note=None,
                medication_note=None,
            )

        record = DailyContextRecord(
            context_id=f"dctx-{uuid.uuid4().hex[:8]}",
            profile_id=submission.profile_id,
            transcripts_persisted=keep_text,
            capture_mode=submission.capture_mode,
            transcript_confirmed_by_user=True,
            transcript_edited_by_user=submission.transcript_edited_by_user,
            consent=submission.consent,
            recorded_at_utc=now.isoformat(),
            expires_at_utc=expires_at.isoformat(),
            recent_activity_expires_at_utc=activity_expires_at.isoformat(),
            sleep_rest=sleep,
            recent_activity=activity,
            symptoms=symptoms,
            routine_change=routine,
            declared_condition=declared,
        )
        if (
            submission.profile_id not in self._records
            and len(self._records) >= self._max_records
        ):
            oldest_key = next(iter(self._records))
            del self._records[oldest_key]
        self._records[submission.profile_id] = record
        return record

    def get(self, profile_id: str) -> DailyContextRecord | None:
        self.purge_expired()
        return self._records.get(profile_id)

    def get_vitals_view(self, profile_id: str) -> DailyContextVitalsView | None:
        record = self.get(profile_id)
        if record is None:
            return None
        now = self._now()
        activity_expired = now >= _parse_iso(record.recent_activity_expires_at_utc)
        if activity_expired:
            act_status: Literal["answered", "skipped", "ambiguous", "expired"] = "expired"
            act_value: RecentActivityValue | None = None
        else:
            act_status = record.recent_activity.status
            act_value = record.recent_activity.value

        return DailyContextVitalsView(
            context_id=record.context_id,
            profile_id=record.profile_id,
            recent_activity_status=act_status,
            recent_activity_value=act_value,
            recent_activity_expired=activity_expired,
            sleep_rest_status=record.sleep_rest.status,
            sleep_rest_value=record.sleep_rest.value,
            routine_change_status=record.routine_change.status,
            routine_change_value=record.routine_change.value,
            urgent_red_flag=record.symptoms.urgent_red_flag,
            has_active_symptoms=record.symptoms.has_active_symptoms,
            active_symptoms=list(record.symptoms.active_symptoms),
            negated_symptoms=list(record.symptoms.negated_symptoms),
        )

    def confirm_rest_for_remeasure(self, profile_id: str, activity_ttl_seconds: int = 7200) -> None:
        record = self.get(profile_id)
        if record is None:
            return
        now = self._now()
        new_act_exp = min(
            now + timedelta(seconds=activity_ttl_seconds),
            _parse_iso(record.expires_at_utc),
        )
        updated = record.model_copy(
            update={
                "recent_activity": RecentActivityInput(
                    status="answered",
                    value="rest",
                    confirmed_text=None,
                ),
                "recent_activity_expires_at_utc": new_act_exp.isoformat(),
            }
        )
        self._records[profile_id] = updated

    def revoke(self, profile_id: str, context_id: str | None = None) -> bool:
        self.purge_expired()
        existing = self._records.get(profile_id)
        if existing is None:
            return False
        if context_id is not None and existing.context_id != context_id:
            return False
        del self._records[profile_id]
        return True


DAILY_CONTEXT_STORE = DailyContextStore()
