"""Simple rule-based multi-vital demo using published adult resting references.

This is a screening-style demonstration, not a diagnostic or medical device.
The conversational model is not used to classify readings or set escalation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.contracts import Integration3DEvent
from app.daily_context import DAILY_CONTEXT_STORE, DailyContextVitalsView
from app.safety import is_emergency
from app.vitals_engine import analyze_symptom_context

router = APIRouter(prefix="/api/vitals", tags=["multi-vital-demo"])

MEDLINE_VITALS_URL = "https://medlineplus.gov/ency/article/002341.htm"
MEDLINE_OXIMETRY_URL = "https://medlineplus.gov/lab-tests/pulse-oximetry/"
AHA_BLOOD_PRESSURE_URL = (
    "https://www.heart.org/en/health-topics/high-blood-pressure/"
    "understanding-blood-pressure-readings"
)
MEDLINE_FEVER_URL = "https://medlineplus.gov/ency/article/003090.htm"
CDC_HYPOTHERMIA_URL = "https://www.cdc.gov/winter-weather/prevention/index.html"
NASA_STANDARD_MEASURES_URL = "https://www.nasa.gov/reference/standard-measures/"
NASA_BONE_MINERAL_URL = "https://www.nasa.gov/directorates/esdmd/hhp/bone-and-mineral-evaluation-and-analysis/"
NASA_HUMAN_PERFORMANCE_URL = "https://www.nasa.gov/reference/4-0-human-performance/"
NASA_RADIATION_STANDARD_URL = "https://www.nasa.gov/wp-content/uploads/2025/05/nasa-std-3001-vol-2.pdf"


class MultiVitalsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: str = Field(default="C001-sim", min_length=2, max_length=40)
    language: Literal["es", "en"] = "es"
    heart_rate_bpm: float | None = Field(default=None, ge=20, le=250)
    respiratory_rate_per_min: float | None = Field(default=None, ge=1, le=80)
    systolic_mmhg: float | None = Field(default=None, ge=50, le=280)
    diastolic_mmhg: float | None = Field(default=None, ge=20, le=200)
    spo2_percent: float | None = Field(default=None, ge=50, le=100)
    temperature_celsius: float | None = Field(default=None, ge=25, le=45)
    hydration_intake_ml: float | None = Field(default=None, ge=0, le=20000)
    muscle_strength_percent_baseline: float | None = Field(default=None, ge=0, le=200)
    bone_density_percent_baseline: float | None = Field(default=None, ge=0, le=200)
    bone_site: Literal["hip_spine", "femoral_neck"] | None = None
    radiation_dose_msv: float | None = Field(default=None, ge=0, le=10000)
    radiation_limit_msv: float | None = Field(default=None, gt=0, le=10000)
    symptom_text: str | None = Field(default=None, max_length=500)
    use_stored_daily_context: bool = True

    @model_validator(mode="after")
    def validate_readings(self) -> "MultiVitalsRequest":
        readings = (
            self.heart_rate_bpm,
            self.respiratory_rate_per_min,
            self.systolic_mmhg,
            self.diastolic_mmhg,
            self.spo2_percent,
            self.temperature_celsius,
            self.hydration_intake_ml,
            self.muscle_strength_percent_baseline,
            self.bone_density_percent_baseline,
            self.radiation_dose_msv,
        )
        if all(value is None for value in readings):
            raise ValueError("Ingresa al menos un signo vital para evaluar.")
        if (self.systolic_mmhg is None) != (self.diastolic_mmhg is None):
            raise ValueError("La presión arterial requiere sistólica y diastólica.")
        if (
            self.systolic_mmhg is not None
            and self.diastolic_mmhg is not None
            and self.diastolic_mmhg >= self.systolic_mmhg
        ):
            raise ValueError("La presión diastólica debe ser menor que la sistólica.")
        if self.bone_density_percent_baseline is not None and self.bone_site is None:
            raise ValueError("La medición ósea requiere indicar el sitio DXA.")
        return self


class VitalObservation(BaseModel):
    vital: Literal[
        "heart_rate",
        "respiratory_rate",
        "blood_pressure",
        "oxygen_saturation",
        "temperature",
    ]
    label: str
    value: str
    reference: str
    state: Literal["within_reference", "outside_reference", "urgent"]
    message: str
    zone: Literal["thorax", "systemic"]
    source_ids: list[str]


class MissionMetric(BaseModel):
    key: Literal["hydration_intake", "muscle_strength", "bone_density", "radiation_dose"]
    label: str
    value: str
    status: Literal[
        "logged_only", "meeting_mission_reference", "below_mission_reference",
        "within_limit", "limit_reached", "unassessed",
    ]
    message: str
    zone: Literal["musculoskeletal", "systemic", "none"]
    source_ids: list[str]


class MultiVitalsResponse(BaseModel):
    timestamp_utc: str
    profile_id: str
    namespace: Literal["simulation_synthetic"] = "simulation_synthetic"
    origin: Literal["manual_demo"] = "manual_demo"
    simulated_only: Literal[True] = True
    overall_state: Literal["within_reference", "outside_reference", "urgent"]
    zone_highlight: Literal["thorax", "systemic", "musculoskeletal", "none"]
    observations: list[VitalObservation]
    mission_metrics: list[MissionMetric] = Field(default_factory=list)
    mission_review_required: bool = False
    integration_3d: Integration3DEvent
    recommendations: list[str]
    copilot_message: str
    suggested_actions: list[
        Literal["rest", "hydrate_if_not_restricted", "remeasure", "contact_medical_team"]
    ]
    contact_medical_team: bool = False
    emergency_bypass: bool = False
    context_used: dict[str, Any] = Field(default_factory=dict)
    llm_used: Literal[False] = False
    is_clinical_diagnosis: Literal[False] = False
    sources: list[dict[str, str]] = Field(default_factory=list)


def _observe(
    vital: str,
    label: str,
    value: str,
    reference: str,
    in_range: bool,
    message: str,
    zone: Literal["thorax", "systemic"],
    source_ids: list[str],
) -> VitalObservation:
    return VitalObservation(
        vital=vital,  # type: ignore[arg-type]
        label=label,
        value=value,
        reference=reference,
        state="within_reference" if in_range else "outside_reference",
        message=message,
        zone=zone,
        source_ids=source_ids,
    )


def _context_symptom_text(view: DailyContextVitalsView | None) -> str:
    if view is None:
        return ""
    parts = list(view.active_symptoms)
    if view.urgent_red_flag:
        parts.append("síntoma de alarma confirmado en entrevista")
    return " ".join(parts)


def evaluate_multi_vitals(
    req: MultiVitalsRequest,
    daily_context: DailyContextVitalsView | None = None,
) -> MultiVitalsResponse:
    """Compare entered readings with broad adult references and suggest next steps."""
    en = req.language == "en"
    merged_symptoms = " ".join(
        text for text in (req.symptom_text or "", _context_symptom_text(daily_context)) if text
    )
    symptom_emergency = bool(
        (daily_context and daily_context.urgent_red_flag)
        or is_emergency(merged_symptoms)
    )
    observations: list[VitalObservation] = []
    mission_metrics: list[MissionMetric] = []
    source_ids: set[str] = set()

    if req.heart_rate_bpm is not None:
        source_ids.add("medlineplus-vital-signs")
        observations.append(
            _observe(
                "heart_rate",
                "Heart rate" if en else "Frecuencia cardíaca",
                f"{req.heart_rate_bpm:g} bpm",
                "60–100 bpm for a resting adult" if en else "60–100 bpm en adulto en reposo",
                60 <= req.heart_rate_bpm <= 100,
                ("Within the general reference." if en else "Dentro de la referencia general.") if 60 <= req.heart_rate_bpm <= 100 else ("Outside the general resting reference." if en else "Fuera de la referencia general de reposo."),
                "thorax",
                ["medlineplus-vital-signs"],
            )
        )

    if req.respiratory_rate_per_min is not None:
        source_ids.add("medlineplus-vital-signs")
        observations.append(
            _observe(
                "respiratory_rate",
                "Respiratory rate" if en else "Frecuencia respiratoria",
                f"{req.respiratory_rate_per_min:g} respiraciones/min",
                "12–18 breaths/min for a resting adult" if en else "12–18 respiraciones/min en adulto en reposo",
                12 <= req.respiratory_rate_per_min <= 18,
                ("Within the general reference." if en else "Dentro de la referencia general.") if 12 <= req.respiratory_rate_per_min <= 18 else ("Outside the general resting reference." if en else "Fuera de la referencia general de reposo."),
                "thorax",
                ["medlineplus-vital-signs"],
            )
        )

    if req.systolic_mmhg is not None and req.diastolic_mmhg is not None:
        source_ids.update(("medlineplus-vital-signs", "aha-blood-pressure"))
        bp_urgent = req.systolic_mmhg >= 180 or req.diastolic_mmhg >= 120
        bp_in_reference = (
            90 <= req.systolic_mmhg < 120 and 60 <= req.diastolic_mmhg < 80
        )
        observations.append(
            VitalObservation(
                vital="blood_pressure",
                label="Blood pressure" if en else "Presión arterial",
                value=f"{req.systolic_mmhg:g}/{req.diastolic_mmhg:g} mmHg",
                reference="General reference 90/60–<120/80 mmHg; AHA classifies normal as <120/<80" if en else "Referencia general 90/60–<120/80 mmHg; AHA clasifica normal <120/<80",
                state="urgent" if bp_urgent else "within_reference" if bp_in_reference else "outside_reference",
                message=(
                    ("Very high reading: wait at least 1 minute and repeat; contact a health professional. With red-flag symptoms, seek emergency care." if en else "Lectura en rango severamente alto: repite en 1 minuto y contacta al equipo médico; con síntomas de alarma, busca atención de emergencia.")
                    if bp_urgent
                    else ("Within the general reference." if en else "Dentro de la referencia general.") if bp_in_reference else ("Outside the general reference; repeat at rest and check whether it persists." if en else "Fuera de la referencia general; repite en reposo y revisa si persiste.")
                ),
                zone="thorax",
                source_ids=["medlineplus-vital-signs", "aha-blood-pressure"],
            )
        )

    spo2_urgent = False
    if req.spo2_percent is not None:
        source_ids.add("medlineplus-pulse-oximetry")
        spo2_urgent = req.spo2_percent <= 92
        observations.append(
            VitalObservation(
                vital="oxygen_saturation",
                label="Oxygen saturation (SpO₂)" if en else "Oxigenación (SpO₂)",
                value=f"{req.spo2_percent:g}%",
                reference="95–100% for most adults; altitude and individual conditions can affect it" if en else "95–100% para la mayoría de adultos; puede variar por altitud o condición individual",
                state="urgent" if spo2_urgent else "within_reference" if req.spo2_percent >= 95 else "outside_reference",
                message=(
                    ("Low reading: contact a health professional now; at 88% or lower, seek immediate medical attention." if en else "Lectura baja: contacta ahora a un profesional de salud; si marca 88% o menos, busca atención médica inmediata.")
                    if spo2_urgent
                    else ("Within the general reference." if en else "Dentro de la referencia general.") if req.spo2_percent >= 95 else ("Below the general reference; warm your hand, stay still, and repeat the reading." if en else "Por debajo de la referencia general; calienta la mano, permanece quieto y repite la medición.")
                ),
                zone="thorax",
                source_ids=["medlineplus-pulse-oximetry"],
            )
        )

    temperature_urgent = False
    if req.temperature_celsius is not None:
        source_ids.add("medlineplus-vital-signs")
        temperature_urgent = req.temperature_celsius < 35 or req.temperature_celsius >= 40.6
        temperature_source_ids = ["medlineplus-vital-signs"]
        if req.temperature_celsius < 35:
            temp_message = "Below 35 °C: seek immediate medical attention." if en else "Por debajo de 35 °C: busca atención médica inmediata."
            temperature_source_ids.append("cdc-hypothermia")
            source_ids.add("cdc-hypothermia")
        elif req.temperature_celsius >= 40.6:
            temp_message = "Very high temperature: contact a health professional immediately." if en else "Temperatura muy alta: contacta de inmediato a un profesional de salud."
            temperature_source_ids.append("medlineplus-fever")
            source_ids.add("medlineplus-fever")
        elif 36.5 <= req.temperature_celsius <= 37.3:
            temp_message = "Within the general reference." if en else "Dentro de la referencia general."
        else:
            temp_message = ("Outside the general reference; repeat the reading. If a fever stays at 39.4 °C or higher, contact a health professional." if en else "Fuera de la referencia general; repite la medición. Si una fiebre permanece en 39.4 °C o más, contacta a un profesional.")
            if req.temperature_celsius >= 39.4:
                temperature_source_ids.append("medlineplus-fever")
                source_ids.add("medlineplus-fever")
        observations.append(
            VitalObservation(
                vital="temperature",
                label="Temperature" if en else "Temperatura",
                value=f"{req.temperature_celsius:g} °C",
                reference="36.5–37.3 °C for a healthy resting adult" if en else "36.5–37.3 °C en adulto sano en reposo",
                state="urgent" if temperature_urgent else "within_reference" if 36.5 <= req.temperature_celsius <= 37.3 else "outside_reference",
                message=temp_message,
                zone="systemic",
                source_ids=temperature_source_ids,
            )
        )

    if req.hydration_intake_ml is not None:
        source_ids.add("nasa-standard-measures")
        mission_metrics.append(
            MissionMetric(
                key="hydration_intake",
                label="Reported fluid intake" if en else "Ingesta de líquidos registrada",
                value=f"{req.hydration_intake_ml:g} mL",
                status="logged_only",
                message=(
                    "This is a self-reported intake record; it does not measure body hydration. Compare it with the crew's assigned fluid plan."
                    if en else
                    "Es un registro autodeclarado de ingesta, no una medición de hidratación corporal. Compáralo con el plan de líquidos asignado a la tripulación."
                ),
                zone="systemic",
                source_ids=["nasa-standard-measures"],
            )
        )

    if req.muscle_strength_percent_baseline is not None:
        source_ids.add("nasa-human-performance")
        muscle_below = req.muscle_strength_percent_baseline < 80
        mission_metrics.append(
            MissionMetric(
                key="muscle_strength",
                label="Muscle strength vs baseline" if en else "Fuerza muscular vs. línea base",
                value=f"{req.muscle_strength_percent_baseline:g}%",
                status="below_mission_reference" if muscle_below else "meeting_mission_reference",
                message=(
                    ("Below the NASA in-mission strength reference of 80% of baseline. Confirm this came from the same standardized strength test and review it with the mission team; this is not a diagnosis." if en else "Por debajo de la referencia NASA de fuerza intramisión (80% de la línea base). Confirma que provenga de la misma prueba estandarizada y revísalo con el equipo de misión; no es un diagnóstico.")
                    if muscle_below else
                    ("At or above the NASA in-mission strength reference of 80% of baseline; compare only standardized repeated tests." if en else "En o sobre la referencia NASA de fuerza intramisión (80% de la línea base); compara solo pruebas repetidas estandarizadas.")
                ),
                zone="musculoskeletal",
                source_ids=["nasa-human-performance"],
            )
        )

    if req.bone_density_percent_baseline is not None and req.bone_site is not None:
        source_ids.add("nasa-bone-mineral")
        bone_threshold = 90 if req.bone_site == "femoral_neck" else 95
        bone_below = req.bone_density_percent_baseline < bone_threshold
        site_label = "femoral neck" if req.bone_site == "femoral_neck" else "hip/spine"
        mission_metrics.append(
            MissionMetric(
                key="bone_density",
                label=f"Bone density ({site_label}) vs baseline" if en else f"Densidad ósea ({site_label}) vs. línea base",
                value=f"{req.bone_density_percent_baseline:g}%",
                status="below_mission_reference" if bone_below else "meeting_mission_reference",
                message=(
                    (f"Below the NASA in-mission {site_label} reference ({bone_threshold}% of pre-mission value). This requires a qualified, comparable DXA measurement and mission-team review; it is not a daily vital or diagnosis." if en else f"Por debajo de la referencia NASA intramisión para {site_label} ({bone_threshold}% del valor premisión). Requiere una medición DXA comparable y revisión del equipo de misión; no es un signo diario ni un diagnóstico.")
                    if bone_below else
                    (f"At or above the NASA in-mission {site_label} reference ({bone_threshold}% of pre-mission value). This is a periodic DXA metric, not a daily reading." if en else f"En o sobre la referencia NASA intramisión para {site_label} ({bone_threshold}% del valor premisión). Es una métrica DXA periódica, no una lectura diaria.")
                ),
                zone="musculoskeletal",
                source_ids=["nasa-bone-mineral"],
            )
        )

    if req.radiation_dose_msv is not None:
        source_ids.add("nasa-radiation-standard")
        has_mission_limit = req.radiation_limit_msv is not None
        dose_exceeded = bool(has_mission_limit and req.radiation_dose_msv >= req.radiation_limit_msv)
        mission_metrics.append(
            MissionMetric(
                key="radiation_dose",
                label="Personal radiation dose" if en else "Dosis personal de radiación",
                value=f"{req.radiation_dose_msv:g} mSv",
                status=("limit_reached" if dose_exceeded else "within_limit") if has_mission_limit else "unassessed",
                message=(
                    ("The entered value meets or exceeds the mission-specific review limit. Verify the personal dosimeter and contact the mission radiation/medical team; this value alone is not a diagnosis." if en else "El valor ingresado alcanza o supera el límite de revisión específico de la misión. Verifica el dosímetro personal y contacta al equipo de radiación/médico de la misión; este dato por sí solo no es un diagnóstico.")
                    if dose_exceeded else
                    ("Below the entered mission-specific review limit. Verify the dosimeter and mission protocol." if en else "Por debajo del límite de revisión específico de misión ingresado. Verifica el dosímetro y el protocolo de misión.")
                    if has_mission_limit else
                    ("Unassessed: NASA exposure review depends on a personal dosimeter and mission-specific exposure limits. No generic threshold is applied." if en else "Sin evaluar: la revisión NASA de exposición requiere un dosímetro personal y límites específicos de misión. No se aplica un umbral genérico.")
                ),
                zone="none",
                source_ids=["nasa-radiation-standard"],
            )
        )

    severe_reading = spo2_urgent or temperature_urgent or any(
        item.vital == "blood_pressure" and item.state == "urgent"
        for item in observations
    )
    emergency = symptom_emergency or (req.spo2_percent is not None and req.spo2_percent <= 88) or (
        req.temperature_celsius is not None and req.temperature_celsius < 35
    )
    outside = any(item.state == "outside_reference" for item in observations)
    urgent = severe_reading or emergency or any(item.state == "urgent" for item in observations)

    if emergency:
        overall_state: Literal["within_reference", "outside_reference", "urgent"] = "urgent"
        recommendations = ([
            "Stop activity and contact the mission medical team or local emergency services now.",
            "Do not wait to repeat the reading if you have chest pain, trouble breathing, fainting, or confusion.",
        ] if en else [
            "Detén la actividad y contacta de inmediato al equipo médico o al servicio de emergencia local.",
            "No esperes a repetir la medición si tienes dolor de pecho, dificultad para respirar, desmayo o confusión.",
        ])
        suggested_actions = ["contact_medical_team"]
        copilot_message = ("A red-flag symptom or extreme reading was reported. Stop activity and contact the medical team now." if en else "Hay un síntoma de alarma o una lectura extrema. Detén la actividad y contacta de inmediato al equipo médico.")
    elif urgent:
        overall_state = "urgent"
        recommendations = ([
            "Repeat the reading as directed and contact a health professional now.",
            "If chest pain, trouble breathing, fainting, confusion, or worsening symptoms occur, seek emergency care.",
        ] if en else [
            "Repite la lectura según la indicación mostrada y contacta ahora a un profesional de salud o al equipo médico.",
            "Si aparece dolor de pecho, dificultad para respirar, desmayo, confusión o empeoras, busca atención de emergencia.",
        ])
        suggested_actions = ["remeasure", "contact_medical_team"]
        copilot_message = ("A reading needs prompt medical review. Repeat it as directed and contact the medical team." if en else "Una lectura requiere revisión médica pronta. Repite la medición como se indica y contacta al equipo médico.")
    elif outside:
        activity = daily_context.recent_activity_value if daily_context else None
        rest_message = (
            ("You reported recent activity: rest for 5 minutes before repeating the reading at rest." if en else "Reportaste actividad reciente: descansa 5 minutos antes de repetir para comparar en reposo.")
            if activity == "activity"
            else ("Rest for 5 minutes and repeat the reading to confirm the result." if en else "Descansa 5 minutos y repite la medición para confirmar el resultado.")
        )
        recommendations = [rest_message]
        recommendations.append("Drink water if you have no fluid restriction." if en else "Hidrátate con agua si no tienes una restricción de líquidos.")
        recommendations.append("If the reading stays outside the reference or symptoms appear, contact the medical team." if en else "Si la lectura sigue fuera de rango o aparecen molestias, contacta al equipo médico.")
        suggested_actions = ["rest", "hydrate_if_not_restricted", "remeasure"]
        copilot_message = ("One or more readings are outside the general reference. Rest, drink water if appropriate, and measure again." if en else "Una o más lecturas están fuera de la referencia general. Descansa, hidrátate si puedes y vuelve a medir.")
        overall_state = "outside_reference"
    else:
        recommendations = ["Continue your usual routine and recheck if you notice symptoms." if en else "Continúa con tu rutina habitual y vuelve a medir si notas molestias."]
        suggested_actions = []
        copilot_message = ("The entered readings are within general adult resting references." if en else "Las lecturas ingresadas están dentro de las referencias generales para adultos en reposo.")
        overall_state = "within_reference"

    mission_review_required = any(
        item.status == "below_mission_reference" for item in mission_metrics
    )
    zones = {item.zone for item in observations if item.state != "within_reference"}
    zone_highlight: Literal["thorax", "systemic", "musculoskeletal", "none"] = (
        "thorax" if "thorax" in zones
        else "systemic" if "systemic" in zones
        else "musculoskeletal" if mission_review_required
        else "none"
    )
    if mission_review_required:
        recommendations.append(
            "Review the comparable strength or DXA result with the mission team; it is a periodic mission metric, not a daily vital."
            if en else
            "Revisa la medición comparable de fuerza o DXA con el equipo de misión; es una métrica periódica, no un signo vital diario."
        )
    if emergency and "thorax" in zones:
        zone_highlight = "thorax"

    context_used = {
        "daily_context_found": daily_context is not None,
        "recent_activity": daily_context.recent_activity_value if daily_context else None,
        "symptoms_confirmed": bool(
            (daily_context and (daily_context.has_active_symptoms or daily_context.urgent_red_flag))
            or analyze_symptom_context(req.symptom_text).has_active_symptoms
            or is_emergency(req.symptom_text or "")
        ),
        "symptom_source": "confirmed_daily_context_or_current_input",
    }
    sources_by_id = {
        "medlineplus-vital-signs": {"title": "MedlinePlus: Vital signs", "url": MEDLINE_VITALS_URL},
        "medlineplus-pulse-oximetry": {"title": "MedlinePlus: Pulse oximetry", "url": MEDLINE_OXIMETRY_URL},
        "aha-blood-pressure": {"title": "American Heart Association: Blood pressure readings", "url": AHA_BLOOD_PRESSURE_URL},
        "medlineplus-fever": {"title": "MedlinePlus: Fever", "url": MEDLINE_FEVER_URL},
        "cdc-hypothermia": {"title": "CDC: Hypothermia prevention", "url": CDC_HYPOTHERMIA_URL},
        "nasa-standard-measures": {"title": "NASA: Standard Measures", "url": NASA_STANDARD_MEASURES_URL},
        "nasa-human-performance": {"title": "NASA: Human Performance standard", "url": NASA_HUMAN_PERFORMANCE_URL},
        "nasa-bone-mineral": {"title": "NASA: Bone and Mineral Evaluation", "url": NASA_BONE_MINERAL_URL},
        "nasa-radiation-standard": {"title": "NASA-STD-3001, Volume 2", "url": NASA_RADIATION_STANDARD_URL},
    }
    return MultiVitalsResponse(
        timestamp_utc=datetime.now(timezone.utc).isoformat(),
        profile_id=req.profile_id,
        overall_state=overall_state,
        zone_highlight=zone_highlight,
        observations=observations,
        mission_metrics=mission_metrics,
        mission_review_required=mission_review_required,
        integration_3d=Integration3DEvent(
            zone=(
                "thorax" if zone_highlight == "thorax"
                else "systemic" if zone_highlight == "systemic"
                else "musculoskeletal" if zone_highlight == "musculoskeletal"
                else "none"
            ),
            severity=(
                "priority" if overall_state == "urgent"
                else "attention" if overall_state == "outside_reference" or mission_review_required
                else "nominal"
            ),
            reason=(
                "Reading(s) outside general reference; demo guidance only."
                if en and (overall_state != "within_reference" or mission_review_required)
                else "Readings within general references; no demo alert."
                if en
                else
                "Lectura(s) fuera de referencia general; indicación operativa de demostración."
                if overall_state != "within_reference" or mission_review_required
                else "Lecturas dentro de la referencia general; sin alerta en la demo."
            ),
            source="manual",
            allowed_actions=(
                ["pause_exertion", "request_recheck", "open_system_view"]
                if overall_state == "urgent"
                else ["pause_exertion", "request_recheck", "log_hydration"]
                if overall_state == "outside_reference"
                else []
            ),
        ),
        recommendations=recommendations,
        copilot_message=copilot_message,
        suggested_actions=suggested_actions,
        contact_medical_team=bool(urgent),
        emergency_bypass=emergency,
        context_used=context_used,
        sources=[
            {
                **sources_by_id[source],
                "title": {
                    "medlineplus-vital-signs": "MedlinePlus: Vital signs",
                    "medlineplus-pulse-oximetry": "MedlinePlus: Pulse oximetry",
                    "aha-blood-pressure": "American Heart Association: Blood pressure readings",
                    "medlineplus-fever": "MedlinePlus: Fever",
                    "cdc-hypothermia": "CDC: Hypothermia prevention",
                "nasa-standard-measures": "NASA: Standard Measures",
                "nasa-human-performance": "NASA: Human Performance standard",
                "nasa-bone-mineral": "NASA: Bone and Mineral Evaluation",
                "nasa-radiation-standard": "NASA-STD-3001, Volume 2",
                }.get(source, sources_by_id[source]["title"]) if en else sources_by_id[source]["title"],
            }
            for source in sorted(source_ids)
        ],
    )


@router.post("/multi-check", response_model=MultiVitalsResponse)
def post_multi_vitals(req: MultiVitalsRequest) -> MultiVitalsResponse:
    daily_context = (
        DAILY_CONTEXT_STORE.get_vitals_view(req.profile_id)
        if req.use_stored_daily_context
        else None
    )
    return evaluate_multi_vitals(req, daily_context)
