"""Motor transparente y no clínico de línea base personal y anomalías para signos vitales.

Diseñado para prototipo educativo/operativo AstroTwin:
- Separa estrictamente contextos de actividad (`rest`, `activity`, `sleep`).
- Exige calidad de señal y confirmación de medición antes de actualizar línea base o evaluar.
- Solo establece línea base personalizada tras alcanzar un mínimo de muestras válidas.
- Distingue picos aislados (`transient_spike`) de desviaciones sostenidas en ventana (`sustained_deviation`).
- Usa umbrales configurables etiquetados explícitamente como ilustrativos de demostración
  y rangos de referencia citados únicamente como contexto educativo (no diagnóstico).
"""

from __future__ import annotations

import math
import re
import statistics
import unicodedata
from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ActivityContext(str, Enum):
    """Contexto fisiológico/operativo de la medición."""

    REST = "rest"
    ACTIVITY = "activity"
    SLEEP = "sleep"


class SignalQuality(str, Enum):
    """Calidad de señal reportada por el sensor o entrada simulada."""

    GOOD = "good"
    NOISY = "noisy"
    POOR = "poor"
    MISSING = "missing"


VitalEvaluationStatus = Literal[
    "nominal",
    "transient_spike",
    "sustained_deviation",
    "insufficient_baseline",
    "low_quality",
    "missing_data",
]


NON_CLINICAL_DISCLAIMER_ES = (
    "Motor operativo no clínico. No emite diagnósticos médicos, no calcula riesgo "
    "clínico ni sustituye valoración médica; los umbrales por defecto son ilustrativos."
)

# Rangos de referencia publicados: SOLO contexto educativo, nunca disparan alarmas.
REFERENCE_RANGES_CONTEXT: dict[str, dict[str, Any]] = {
    "heart_rate_bpm": {
        "rest": {
            "range_bpm": [60, 100],
            "population": "Adultos en reposo (referencia general)",
            "citation": (
                "American Heart Association (AHA), Target Heart Rates / Resting Heart Rate "
                "(60-100 bpm adultos en reposo; solo contexto educativo, no umbral diagnóstico)."
            ),
            "context_only": True,
            "used_for_alarm": False,
        },
        "activity": {
            "range_bpm": None,
            "population": "Variable según intensidad de esfuerzo y condición individual",
            "citation": (
                "AHA Target Heart Rates: durante actividad física la frecuencia esperada "
                "depende de la intensidad y línea base individual (solo contexto)."
            ),
            "context_only": True,
            "used_for_alarm": False,
        },
        "sleep": {
            "range_bpm": None,
            "population": "Habitualmente inferior al reposo diurno; alta variabilidad individual",
            "citation": (
                "Referencia fisiológica general: durante el sueño la frecuencia suele descender "
                "respecto al reposo en vigilia; se evalúa contra línea base personal de sueño."
            ),
            "context_only": True,
            "used_for_alarm": False,
        },
    }
}


class VitalsEngineConfig(BaseModel):
    """Configuración del motor con umbrales de demostración explícitamente ilustrativos."""

    thresholds_label: Literal["ILLUSTRATIVE_DEMO_ONLY_NON_CLINICAL"] = (
        "ILLUSTRATIVE_DEMO_ONLY_NON_CLINICAL"
    )
    illustrative_demo_only: Literal[True] = True
    min_valid_samples_for_baseline: int = Field(default=5, ge=2, le=100)
    rolling_window_size: int = Field(default=12, ge=3, le=200)
    sustained_window_size: int = Field(default=3, ge=1, le=20)
    sustained_min_deviating_samples: int = Field(default=3, ge=1, le=20)
    min_delta_bpm_illustrative: float = Field(default=12.0, ge=1.0, le=80.0)
    z_score_multiplier_illustrative: float = Field(default=2.0, ge=0.5, le=6.0)
    min_signal_quality_score: float = Field(default=0.6, ge=0.0, le=1.0)
    require_measurement_confirmation: bool = True
    baseline_statistic: Literal["median", "mean"] = "median"


class HeartRateSample(BaseModel):
    """Muestra individual de frecuencia cardíaca con contexto, calidad y confirmación."""

    value_bpm: float | None = Field(default=None, ge=0.0, le=300.0)
    context: ActivityContext
    quality: SignalQuality = SignalQuality.GOOD
    signal_quality_score: float | None = Field(default=None, ge=0.0, le=1.0)
    measurement_confirmed: bool = True
    timestamp: datetime | None = None
    source: str = Field(default="simulated_sensor", min_length=1, max_length=64)


class BaselineSummary(BaseModel):
    """Resumen transparente de la línea base personalizada en un contexto."""

    established: bool
    context: ActivityContext
    valid_sample_count: int
    min_required_samples: int
    baseline_center_bpm: float | None = None
    mean_bpm: float | None = None
    median_bpm: float | None = None
    std_bpm: float | None = None
    mad_bpm: float | None = None
    effective_delta_threshold_bpm: float | None = None


class WindowSummary(BaseModel):
    """Resumen de la ventana reciente para distinguir picos aislados vs cambio sostenido."""

    window_size: int
    valid_samples_in_window: int
    deviating_samples_in_window: int
    sustained_required: int
    latest_bpm: float | None = None
    delta_from_baseline_bpm: float | None = None
    quality_counts: dict[str, int] = Field(default_factory=dict)
    rejected_latest_reason: str | None = None


class SymptomContextSummary(BaseModel):
    """Análisis determinista de síntomas reportados con soporte de negación."""

    raw_text: str | None = None
    active_symptoms: list[str] = Field(default_factory=list)
    negated_symptoms: list[str] = Field(default_factory=list)
    has_active_symptoms: bool = False


class VitalEvaluationResult(BaseModel):
    """Resultado completo y explicable de la evaluación de signos vitales."""

    vital_type: Literal["heart_rate_bpm"] = "heart_rate_bpm"
    context: ActivityContext
    status: VitalEvaluationStatus
    is_clinical_diagnosis: Literal[False] = False
    disclaimer: str = NON_CLINICAL_DISCLAIMER_ES
    thresholds_metadata: dict[str, Any]
    reference_range_context: dict[str, Any]
    baseline: BaselineSummary
    window_summary: WindowSummary
    symptom_context: SymptomContextSummary
    explanation: str
    recommended_operational_actions: list[str] = Field(default_factory=list)


_SYMPTOM_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "chest_discomfort",
        re.compile(
            r"\b(?:dolor|presion|opresion|molestia)\s+(?:en\s+el\s+)?(?:pecho|torax|toracic[oa])\b"
            r"|\bchest\s+pain\b",
            re.IGNORECASE,
        ),
    ),
    (
        "shortness_of_breath",
        re.compile(
            r"\b(?:falta\s+de\s+aire|dificultad\s+(?:para|al)\s+respirar|disnea|ahogo)\b"
            r"|\bshortness\s+of\s+breath\b",
            re.IGNORECASE,
        ),
    ),
    (
        "dizziness",
        re.compile(r"\b(?:mareo|mareos|vertigo|aturdimiento)\b|\bdizziness\b", re.IGNORECASE),
    ),
    (
        "palpitations",
        re.compile(r"\b(?:palpitaciones|taquicardia\s+subjetiva)\b|\bpalpitations\b", re.IGNORECASE),
    ),
    (
        "fainting_feeling",
        re.compile(r"\b(?:desmayo|sincope|lipotimia)\b|\bfainting\b", re.IGNORECASE),
    ),
)

_NEGATION_PREFIX = re.compile(
    r"\b(?:no|sin|ni|niego|niega|ausencia\s+de|ningun|ninguna|no\s+tengo|no\s+siento|"
    r"no\s+presenta|without|denies|no\s+sign\s+of|not)\b[^.,;]{0,35}$",
    re.IGNORECASE,
)


def _fold_text(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def analyze_symptom_context(symptom_text: str | None) -> SymptomContextSummary:
    """Extrae síntomas reportados distinguiendo menciones negadas de activas."""
    if not symptom_text or not symptom_text.strip():
        return SymptomContextSummary(raw_text=symptom_text)

    folded = _fold_text(symptom_text)
    active: list[str] = []
    negated: list[str] = []

    for label, pattern in _SYMPTOM_PATTERNS:
        for match in pattern.finditer(folded):
            prefix = folded[max(0, match.start() - 40) : match.start()]
            if _NEGATION_PREFIX.search(prefix):
                if label not in negated:
                    negated.append(label)
            else:
                if label not in active:
                    active.append(label)

    # Si un síntoma aparece negado y también activo en la misma frase, prevalece activo;
    # si solo fue negado, queda únicamente en negated_symptoms.
    negated = [label for label in negated if label not in active]
    return SymptomContextSummary(
        raw_text=symptom_text,
        active_symptoms=active,
        negated_symptoms=negated,
        has_active_symptoms=bool(active),
    )


def validate_sample(
    sample: HeartRateSample, config: VitalsEngineConfig
) -> tuple[bool, str | None]:
    """Valida si una muestra es apta para línea base y evaluación."""
    if sample.value_bpm is None or sample.quality == SignalQuality.MISSING:
        return False, "missing_data"
    if sample.quality in (SignalQuality.NOISY, SignalQuality.POOR):
        return False, "low_quality_flag"
    if (
        sample.signal_quality_score is not None
        and sample.signal_quality_score < config.min_signal_quality_score
    ):
        return False, "low_quality_score"
    if config.require_measurement_confirmation and not sample.measurement_confirmed:
        return False, "unconfirmed_measurement"
    return True, None


def _compute_mad(values: list[float], median_val: float) -> float:
    deviations = [abs(v - median_val) for v in values]
    return round(statistics.median(deviations), 3)


def _compute_std(values: list[float], mean_val: float) -> float:
    if len(values) < 2:
        return 0.0
    variance = sum((v - mean_val) ** 2 for v in values) / len(values)
    return round(math.sqrt(variance), 3)


def evaluate_heart_rate_series(
    samples: list[HeartRateSample],
    target_context: ActivityContext,
    config: VitalsEngineConfig | None = None,
    symptom_text: str | None = None,
) -> VitalEvaluationResult:
    """Evalúa una serie cronológica de frecuencia cardíaca en un contexto específico."""
    cfg = config or VitalsEngineConfig()
    symptom_summary = analyze_symptom_context(symptom_text)
    ref_context = REFERENCE_RANGES_CONTEXT["heart_rate_bpm"][target_context.value]
    thresholds_meta = {
        "illustrative_demo_only": cfg.illustrative_demo_only,
        "label": cfg.thresholds_label,
        "min_valid_samples_for_baseline": cfg.min_valid_samples_for_baseline,
        "rolling_window_size": cfg.rolling_window_size,
        "sustained_window_size": cfg.sustained_window_size,
        "sustained_min_deviating_samples": cfg.sustained_min_deviating_samples,
        "min_delta_bpm_illustrative": cfg.min_delta_bpm_illustrative,
        "z_score_multiplier_illustrative": cfg.z_score_multiplier_illustrative,
        "min_signal_quality_score": cfg.min_signal_quality_score,
        "require_measurement_confirmation": cfg.require_measurement_confirmation,
    }

    context_samples = [s for s in samples if s.context == target_context]
    quality_counts: dict[str, int] = {
        "valid_confirmed": 0,
        "missing": 0,
        "low_quality": 0,
        "unconfirmed": 0,
    }
    valid_samples: list[HeartRateSample] = []

    for sample in context_samples:
        is_valid, reason = validate_sample(sample, cfg)
        if is_valid:
            quality_counts["valid_confirmed"] += 1
            valid_samples.append(sample)
        elif reason == "missing_data":
            quality_counts["missing"] += 1
        elif reason == "unconfirmed_measurement":
            quality_counts["unconfirmed"] += 1
        else:
            quality_counts["low_quality"] += 1

    # 1. Estado de dato faltante o baja calidad en la última muestra del contexto
    if not context_samples:
        return VitalEvaluationResult(
            context=target_context,
            status="missing_data",
            thresholds_metadata=thresholds_meta,
            reference_range_context=ref_context,
            baseline=BaselineSummary(
                established=False,
                context=target_context,
                valid_sample_count=0,
                min_required_samples=cfg.min_valid_samples_for_baseline,
            ),
            window_summary=WindowSummary(
                window_size=cfg.sustained_window_size,
                valid_samples_in_window=0,
                deviating_samples_in_window=0,
                sustained_required=cfg.sustained_min_deviating_samples,
                quality_counts=quality_counts,
                rejected_latest_reason="missing_data",
            ),
            symptom_context=symptom_summary,
            explanation=(
                f"No hay muestras disponibles para el contexto '{target_context.value}'. "
                "No se establece línea base ni se infiere anomalía."
            ),
            recommended_operational_actions=["request_recheck", "record_observation"],
        )

    latest_sample = context_samples[-1]
    latest_valid, latest_reject_reason = validate_sample(latest_sample, cfg)
    if not latest_valid:
        status: VitalEvaluationStatus = (
            "missing_data" if latest_reject_reason == "missing_data" else "low_quality"
        )
        reason_desc = (
            "dato faltante"
            if status == "missing_data"
            else f"calidad insuficiente o medición no confirmada ({latest_reject_reason})"
        )
        return VitalEvaluationResult(
            context=target_context,
            status=status,
            thresholds_metadata=thresholds_meta,
            reference_range_context=ref_context,
            baseline=BaselineSummary(
                established=len(valid_samples) >= cfg.min_valid_samples_for_baseline,
                context=target_context,
                valid_sample_count=len(valid_samples),
                min_required_samples=cfg.min_valid_samples_for_baseline,
            ),
            window_summary=WindowSummary(
                window_size=cfg.sustained_window_size,
                valid_samples_in_window=0,
                deviating_samples_in_window=0,
                sustained_required=cfg.sustained_min_deviating_samples,
                latest_bpm=latest_sample.value_bpm,
                quality_counts=quality_counts,
                rejected_latest_reason=latest_reject_reason,
            ),
            symptom_context=symptom_summary,
            explanation=(
                f"La última lectura en contexto '{target_context.value}' fue descartada por "
                f"{reason_desc}. No se utiliza para línea base ni dispara alerta."
            ),
            recommended_operational_actions=["request_recheck"],
        )

    # 2. Verificar mínimo de muestras válidas para línea base personalizada
    if len(valid_samples) < cfg.min_valid_samples_for_baseline:
        return VitalEvaluationResult(
            context=target_context,
            status="insufficient_baseline",
            thresholds_metadata=thresholds_meta,
            reference_range_context=ref_context,
            baseline=BaselineSummary(
                established=False,
                context=target_context,
                valid_sample_count=len(valid_samples),
                min_required_samples=cfg.min_valid_samples_for_baseline,
            ),
            window_summary=WindowSummary(
                window_size=cfg.sustained_window_size,
                valid_samples_in_window=min(len(valid_samples), cfg.sustained_window_size),
                deviating_samples_in_window=0,
                sustained_required=cfg.sustained_min_deviating_samples,
                latest_bpm=latest_sample.value_bpm,
                quality_counts=quality_counts,
            ),
            symptom_context=symptom_summary,
            explanation=(
                f"Línea base insuficiente en contexto '{target_context.value}': "
                f"{len(valid_samples)}/{cfg.min_valid_samples_for_baseline} muestras válidas confirmadas. "
                "Se continúa recopilando antes de evaluar desviaciones personales."
            ),
            recommended_operational_actions=["record_observation"],
        )

    # 3. Calcular línea base móvil excluyendo la ventana candidata cuando hay historial suficiente
    candidate_window = valid_samples[-cfg.sustained_window_size :]
    tail_excluded = min(
        len(candidate_window), len(valid_samples) - cfg.min_valid_samples_for_baseline
    )
    baseline_end = len(valid_samples) - tail_excluded
    baseline_start = max(0, baseline_end - cfg.rolling_window_size)
    baseline_slice = valid_samples[baseline_start:baseline_end]
    baseline_values = [float(s.value_bpm) for s in baseline_slice if s.value_bpm is not None]

    mean_bpm = round(statistics.mean(baseline_values), 2)
    median_bpm = round(statistics.median(baseline_values), 2)
    std_bpm = _compute_std(baseline_values, mean_bpm)
    mad_bpm = _compute_mad(baseline_values, median_bpm)

    center_bpm = median_bpm if cfg.baseline_statistic == "median" else mean_bpm
    # Para MAD normalizado usamos factor ~1.4826 si MAD > 0, o std si se usa media.
    spread_bpm = (
        round(mad_bpm * 1.4826, 2) if cfg.baseline_statistic == "median" else std_bpm
    )
    effective_delta = round(
        max(
            cfg.min_delta_bpm_illustrative,
            cfg.z_score_multiplier_illustrative * spread_bpm,
        ),
        2,
    )

    deviating_count = sum(
        1
        for s in candidate_window
        if s.value_bpm is not None and abs(s.value_bpm - center_bpm) >= effective_delta
    )
    latest_bpm = float(latest_sample.value_bpm)  # validado arriba
    latest_delta = round(latest_bpm - center_bpm, 2)
    latest_is_deviating = abs(latest_delta) >= effective_delta

    if deviating_count >= cfg.sustained_min_deviating_samples:
        final_status: VitalEvaluationStatus = "sustained_deviation"
        explanation = (
            f"Desviación sostenida en contexto '{target_context.value}': "
            f"{deviating_count}/{len(candidate_window)} lecturas válidas recientes superan "
            f"el umbral ilustrativo de ±{effective_delta} bpm respecto a la línea base personal "
            f"({center_bpm} bpm; última lectura {latest_bpm} bpm, delta {latest_delta:+.1f} bpm)."
        )
        actions = ["reduce_mission_intensity", "request_recheck", "record_observation"]
    elif deviating_count > 0 and latest_is_deviating:
        final_status = "transient_spike"
        explanation = (
            f"Variación aislada en contexto '{target_context.value}': última lectura {latest_bpm} bpm "
            f"(delta {latest_delta:+.1f} bpm vs línea base personal {center_bpm} bpm), pero solo "
            f"{deviating_count}/{cfg.sustained_min_deviating_samples} muestras requeridas en ventana "
            "superan el umbral ilustrativo. Se sugiere reconfirmar antes de escalar."
        )
        actions = ["request_recheck", "record_observation"]
    elif deviating_count > 0 and not latest_is_deviating:
        final_status = "nominal"
        explanation = (
            f"Lectura actual nominal en contexto '{target_context.value}': {latest_bpm} bpm "
            f"(delta {latest_delta:+.1f} bpm vs línea base personal {center_bpm} bpm). "
            f"Hubo {deviating_count} pico(s) previo(s) en ventana que no se sostuvieron."
        )
        actions = ["record_observation"]
    else:
        final_status = "nominal"
        explanation = (
            f"Lectura nominal en contexto '{target_context.value}': {latest_bpm} bpm "
            f"dentro de ±{effective_delta} bpm de la línea base personal ({center_bpm} bpm, "
            f"{len(baseline_values)} muestras válidas)."
        )
        actions = ["record_observation"]

    if symptom_summary.has_active_symptoms:
        explanation += (
            f" Síntomas reportados activos: {', '.join(symptom_summary.active_symptoms)}."
        )
    elif symptom_summary.negated_symptoms:
        explanation += (
            f" Síntomas explícitamente negados (sin escalamiento): "
            f"{', '.join(symptom_summary.negated_symptoms)}."
        )

    return VitalEvaluationResult(
        context=target_context,
        status=final_status,
        thresholds_metadata=thresholds_meta,
        reference_range_context=ref_context,
        baseline=BaselineSummary(
            established=True,
            context=target_context,
            valid_sample_count=len(baseline_values),
            min_required_samples=cfg.min_valid_samples_for_baseline,
            baseline_center_bpm=center_bpm,
            mean_bpm=mean_bpm,
            median_bpm=median_bpm,
            std_bpm=std_bpm,
            mad_bpm=mad_bpm,
            effective_delta_threshold_bpm=effective_delta,
        ),
        window_summary=WindowSummary(
            window_size=cfg.sustained_window_size,
            valid_samples_in_window=len(candidate_window),
            deviating_samples_in_window=deviating_count,
            sustained_required=cfg.sustained_min_deviating_samples,
            latest_bpm=latest_bpm,
            delta_from_baseline_bpm=latest_delta,
            quality_counts=quality_counts,
        ),
        symptom_context=symptom_summary,
        explanation=explanation,
        recommended_operational_actions=actions,
    )


class PersonalVitalsEngine:
    """Motor con estado en memoria por (profile_id, context) para ingestión y evaluación."""

    def __init__(self, config: VitalsEngineConfig | None = None) -> None:
        self.config = config or VitalsEngineConfig()
        self._series: dict[tuple[str, ActivityContext], list[HeartRateSample]] = {}

    def ingest(self, profile_id: str, sample: HeartRateSample) -> None:
        key = (profile_id, sample.context)
        self._series.setdefault(key, []).append(sample)

    def evaluate(
        self,
        profile_id: str,
        context: ActivityContext,
        symptom_text: str | None = None,
    ) -> VitalEvaluationResult:
        samples = self._series.get((profile_id, context), [])
        return evaluate_heart_rate_series(
            samples=samples,
            target_context=context,
            config=self.config,
            symptom_text=symptom_text,
        )
