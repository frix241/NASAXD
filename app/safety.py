"""Guardas deterministas de seguridad para la salida del LLM local.

El modelo no es una fuente de verdad clínica. Estas funciones no intentan
mejorar al modelo: lo rodean con reglas que pueden probarse sin depender de
que un modelo concreto obedezca.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from typing import Any

from app.contracts import ALLOWED_ACTIONS, LLMOutputPayload

EMERGENCY_BYPASS_REASON = (
    "Bypass determinista de emergencia: el modelo local no fue consultado."
)

EMERGENCY_ANSWER_ES = (
    "Esto puede ser una emergencia médica. Detén la actividad, avisa de inmediato "
    "al equipo médico y al control de misión, y sigue el protocolo de emergencia "
    "aprobado de la tripulación. No estoy diagnosticando ni puedo indicar "
    "medicamentos o dosis."
)
EMERGENCY_ANSWER_EN = (
    "This may be a medical emergency. Stop activity, contact the mission medical "
    "team and mission control now, and follow the crew's approved emergency "
    "protocol. I cannot diagnose or recommend medication or doses."
)

EMERGENCY_SAFETY_NOTE = (
    "Respuesta determinista de seguridad en el contexto de la misión. No "
    "sustituye la valoración del equipo médico ni del control de misión; no se "
    "sugieren destinos, números de teléfono, diagnósticos, tratamientos ni dosis."
)

_UNCONDITIONAL_EMERGENCY_PATTERNS = (
    r"\bno\s+(?:puedo|puede)\s+respirar\b",
    r"\b(?:me\s+)?qued[ao]\w*\s+sin\s+aire\b",
    r"\bno\s+(?:me|le|nos)\s+entra\s+(?:el\s+)?aire\b",
    r"\bcan'?t\s+breathe\b",
    r"\bcannot\s+breathe\b",
    r"\bme\s+quiero\s+matar\b",
    r"\bquiero\s+morir\b",
    r"\bsuicid(?:a|io|a)\b",
    r"\bautolesion\b",
    r"\bsuicidal\b",
    r"\bme\s+voy\s+a\s+desmayar\b",
)

_NEGATABLE_STRONG_EMERGENCY_PATTERNS = (
    r"\bdifficulty\s+breathing\b",
    r"\bperdida\s+de\s+(?:conocimiento|consciencia)\b",
    r"\binconsciente\b",
    r"\bunconscious\b",
    r"\bconvulsi(?:on|ones)\b",
    r"\bseizure\b",
    r"\bderrame\s+cerebral\b",
    r"\bictus\b",
    r"\bstroke\b",
    r"\bhemorragia\b",
    r"\bsangrado\s+(?:abundante|intenso|que\s+no\s+para)\b",
    r"\bsevere\s+bleeding\b",
    r"\banafilaxia\b",
    r"\breaccion\s+alergica\s+grave\b",
    r"\bhinchazon\s+de\s+(?:la\s+)?garganta\b",
    r"\bsevere\s+chest\s+pain\b",
    r"\bvomit(?:o|ando)\s+(?:con\s+)?sangre\b",
)

_RESPIRATORY_EMERGENCY_PATTERNS = (
    r"\bdificultad\s+(?:para|al)\s+respirar\b",
    r"\b(?:(?:me|le|nos|te)\s+)?cuesta\s+(?:mucho\s+)?respirar\b",
    r"\bfalta(?:\s+(?:de|el))?\s+aire\b(?!\s+acondicionado\b)",
    r"\bfaltando\s+(?:el\s+)?aire\b",
    r"\bsin\s+aliento\b",
    r"\b(?:ahog(?:o|ando|andome)|asfixia|disnea)\b",
)

_EMERGENCY_NEGATION_PREFIX = re.compile(
    r"\b(?:no|sin|niego|niega|ausencia\s+de|ni|ningun|ninguna|tampoco|"
    r"without|denies|no\s+sign\s+of|not)\b[^.,;]{0,40}$",
    re.IGNORECASE,
)

_CHEST_PATTERN = re.compile(
    r"\b(?:dolor|duele|duelen|presion|opresion|molestia|aprieta|ardor|punzada)\b[^.,;]{0,60}\b(?:pecho|toracic[oa])\b"
    r"|\bchest\s+(?:pain|pressure|tightness|discomfort)\b",
    re.IGNORECASE,
)
_MILD_PATTERN = re.compile(
    r"\b(?:leve|muy\s+leve|molestia\s+menor|sin\s+importancia|mild|minor)\b", re.IGNORECASE
)

_NEGATION_PATTERN = re.compile(
    r"\b(?:no|sin|ni|niego|ausencia\s+de|no\s+se\s+puede|no\s+puedo|no\s+debe)\b",
    re.IGNORECASE,
)

_UNSAFE_REASSURANCE_PATTERNS = (
    re.compile(r"\bno\s+hay\s+signos\s+de\s+(?:lesion|enfermedad)\b", re.IGNORECASE),
    re.compile(
        r"\b(?:temperatura|pulso|presion|frecuencia\s+cardiaca)\s+(?:corporal\s+)?(?:es|esta|resulta)\s+normal\b",
        re.IGNORECASE,
    ),
    re.compile(r"\brango\s+normal\b|\bnormal\s+range\b", re.IGNORECASE),
)
_PULSE_DECREASE_PATTERN = re.compile(
    r"\b(?:pulso|ritmo\s+cardiaco|frecuencia\s+cardiaca|heart\s+rate)\b[^.!?]{0,70}"
    r"\b(?:disminu\w*|baj\w*|descend\w*|cay[oó]|reduc\w*|decreas\w*|fell|dropped)\b"
    r"|\b(?:disminu\w*|baj\w*|descend\w*|cay[oó]|reduc\w*|decreas\w*|fell|dropped)\b"
    r"[^.!?]{0,70}\b(?:pulso|ritmo\s+cardiaco|frecuencia\s+cardiaca|heart\s+rate)\b",
    re.IGNORECASE,
)
_PULSE_INCREASE_PATTERN = re.compile(
    r"\b(?:pulso|ritmo\s+cardiaco|frecuencia\s+cardiaca|heart\s+rate)\b[^.!?]{0,70}"
    r"\b(?:aument\w*|sub\w*|elev\w*|increment\w*|increas\w*|rose|risen)\b"
    r"|\b(?:aument\w*|sub\w*|elev\w*|increment\w*|increas\w*|rose|risen)\b"
    r"[^.!?]{0,70}\b(?:pulso|ritmo\s+cardiaco|frecuencia\s+cardiaca|heart\s+rate)\b",
    re.IGNORECASE,
)
_WITHIN_THRESHOLD_CLAIM = re.compile(
    r"\b(?:dentro\s+(?:del|de\s+el)\s+(?:umbral|limite)|"
    r"dentro\s+de\s+(?:un\s+)?(?:umbral|limite)|"
    r"within\s+(?:the\s+)?(?:threshold|limit))\b",
    re.IGNORECASE,
)
_EXCEEDS_THRESHOLD_CLAIM = re.compile(
    r"\b(?:supera|excede|rebasa|exceeds?|is\s+above|por\s+encima\s+de)\b"
    r"[^.!?]{0,50}\b(?:umbral|limite|threshold|limit)\b",
    re.IGNORECASE,
)
_UNSUPPORTED_MISSING_DATA_CAUSE = re.compile(
    r"\b(?:remoci[oó]n|extracci[oó]n|pipeline|sensor|dispositivo|hardware|software|"
    r"aver[ií]a|fallo|falla|error|tarea)\b",
    re.IGNORECASE,
)
_UNSUPPORTED_ORGAN_FUNCTION_INFERENCE = re.compile(
    r"\b(?:eficiencia|funcionamiento|rendimiento)\s+(?:del|de\s+la)\s+"
    r"(?:sistema\s+)?(?:cardiovascular|card[ií]aco|renal|inmunol[oó]gico|musculoesquel[eé]tico)\b",
    re.IGNORECASE,
)
_MISSING_DATA_ANOMALY_CLAIM = re.compile(
    r"\b(?:anomal[ií]a|desviaci[oó]n|alteraci[oó]n|falla|fallo|problema)\b",
    re.IGNORECASE,
)

_DIAGNOSIS_PATTERNS = (
    re.compile(
        r"\b(?:tienes|tiene|padeces|padece|sufres|sufre|presentas|presenta|tengo|padezco|sufro)\b[^.]{0,50}"
        r"\b(?:lesion|infarto|enfermedad|arritmia|derrame|insuficiencia)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:es|se\s+trata\s+de)\s+(?:un|una)\s+"
        r"(?:infarto|lesion|arritmia|derrame|enfermedad)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:el\s+pulso|la\s+temperatura|los\s+sintomas|la\s+presion|analisis|laboratorio|inspiration4|nasa)\b[^.]{0,45}"
        r"\b(?:prueba|prueban|confirma|confirman|demuestra|demuestran|indica|indican)\b[^.]{0,35}"
        r"\b(?:lesion|infarto|enfermedad|arritmia)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:probabilidad|riesgo)\b[^.]{0,35}\b(?:infarto|lesion|muerte)\b"
        r"[^.]{0,25}\d+(?:[.,]\d+)?\s*%",
        re.IGNORECASE,
    ),
    re.compile(
        r"\d+(?:[.,]\d+)?\s*%[^.]{0,30}\b(?:probabilidad|riesgo)\b[^.]{0,35}"
        r"\b(?:infarto|lesion|muerte)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bdeshidratacion\b", re.IGNORECASE),
)

_MEDICATION_PATTERN = re.compile(
    r"\b(?:ibuprofeno|paracetamol|aspirina|amoxicilina|omeprazol|morfina|"
    r"tramadol|insulina|antibiotico|anticoagulante)\b",
    re.IGNORECASE,
)
_PRESCRIPTIVE_VERB_PATTERN = re.compile(
    r"\b(?:toma|tomar|tomate|administra|administrar|tome|ingiere|usa)\b",
    re.IGNORECASE,
)
_DOSE_PATTERN = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|ui|iu)\b", re.IGNORECASE
)
_NUMBER_WITH_UNIT_PATTERN = re.compile(
    r"(?<![\w.])(\d+(?:[.,]\d+)?)\s*"
    r"(bpm|lpm|mmhg|horas?|hrs?|h|minutos?|min|ml|°c|%)(?![a-z])",
    re.IGNORECASE,
)
_LOCAL_NEGATION_PREFIX = re.compile(
    r"\b(?:no|sin(?!\s+duda\b)|ni|niego|ausencia\s+de|no\s+se\s+puede|no\s+puedo|no\s+debe|evita|nunca)\b[^.,;]{0,45}$",
    re.IGNORECASE,
)
_PROMPT_LEAK_PATTERNS = (
    re.compile(r"\breglas\s+estrictas(?:\s+de\s+seguridad)?\b", re.IGNORECASE),
    re.compile(r"\besquema\s+de\s+salida(?:\s+json)?\b", re.IGNORECASE),
    re.compile(r"\bsafety_note\b", re.IGNORECASE),
    re.compile(r"\b(?:allowed_actions|allowed_citations|prescribe_drug|request_drug)\b", re.IGNORECASE),
    re.compile(r"\b(?:" + "|".join(re.escape(a) for a in ALLOWED_ACTIONS) + r")\b", re.IGNORECASE),
    re.compile(r"string\s*\(\s*explicacion|maximo\s+400\s+caracteres", re.IGNORECASE),
)
_ENGLISH_ONLY_MARKERS = re.compile(
    r"\b(?:the|is|are|your|heart\s+rate|sleep\s+is|hours|cannot|please\s+seek|medical\s+attention)\b",
    re.IGNORECASE,
)
_SPANISH_MARKERS = re.compile(
    r"\b(?:el|la|los|las|de|del|en|es|son|por|para|con|sin|no|pulso|sueno|sueño|estado|operativo|perfil|simulado|hidratacion|medico|mision)\b",
    re.IGNORECASE,
)


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def _is_negated_before(text: str, start: int) -> bool:
    prefix = text[max(0, start - 40) : start]
    return bool(_EMERGENCY_NEGATION_PREFIX.search(prefix))


def _clause_bounds(text: str, start: int, end: int) -> str:
    left = max(text.rfind(".", 0, start), text.rfind(",", 0, start), text.rfind(";", 0, start))
    c_start = left + 1 if left >= 0 else 0
    candidates = [idx for idx in (text.find(".", end), text.find(",", end), text.find(";", end)) if idx >= 0]
    c_end = min(candidates) if candidates else len(text)
    return text[c_start:c_end]


def is_emergency(message: str) -> bool:
    """Bandera roja explícita: se resuelve sin consultar al modelo."""
    text = " ".join(_fold(message).split())
    if not text:
        return False
    if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in _UNCONDITIONAL_EMERGENCY_PATTERNS):
        return True
    for pattern in _NEGATABLE_STRONG_EMERGENCY_PATTERNS + _RESPIRATORY_EMERGENCY_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            if not _is_negated_before(text, match.start()):
                return True
    for chest in _CHEST_PATTERN.finditer(text):
        if _is_negated_before(text, chest.start()):
            continue
        clause = _clause_bounds(text, chest.start(), chest.end())
        if not _MILD_PATTERN.search(clause):
            return True
    return False


def emergency_output(language: str = "es") -> LLMOutputPayload:
    return LLMOutputPayload(
        answer=EMERGENCY_ANSWER_EN if language == "en" else EMERGENCY_ANSWER_ES,
        citations=[],
        proposed_actions=[],
        safety_note=EMERGENCY_SAFETY_NOTE,
    )


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


def _canonical_measure_unit(unit: str) -> str:
    folded = _fold(unit).replace("°", "")
    if folded in {"bpm", "lpm"}:
        return "bpm"
    if folded == "mmhg":
        return "mmhg"
    if folded in {"h", "hr", "hrs", "hora", "horas"}:
        return "hour"
    if folded in {"min", "minuto", "minutos"}:
        return "minute"
    if folded == "ml":
        return "ml"
    if folded in {"c", "celsius"}:
        return "celsius"
    if folded == "%":
        return "percent"
    return folded


def _unit_for_structured_key(key: str) -> str | None:
    folded = key.lower()
    if folded.endswith(("_bpm", "_lpm")):
        return "bpm"
    if folded.endswith("_mmhg"):
        return "mmhg"
    if folded in {
        "spo2_pct",
        "spo2_percent",
        "oxygen_saturation_pct",
        "oxygen_saturation_percent",
    }:
        return "percent"
    if folded in {"temperature_c", "temperature_celsius", "temp_celsius"}:
        return "celsius"
    if folded in {"duration_hours", "sleep_duration_hours", "sleep_hours"}:
        return "hour"
    if folded.endswith(("_duration_min", "_minutes", "_min")):
        return "minute"
    return None


def _allowed_measurement_pairs(context_payload: dict[str, Any]) -> set[tuple[float, str]]:
    """Return exact number/unit pairs present in trusted typed context fields."""
    pairs: set[tuple[float, str]] = set()

    def visit(value: Any, key: str = "") -> None:
        if isinstance(value, dict):
            for child_key, child_value in value.items():
                child_key_text = str(child_key)
                unit = _unit_for_structured_key(child_key_text)
                if (
                    unit is not None
                    and isinstance(child_value, (int, float))
                    and not isinstance(child_value, bool)
                    and math.isfinite(float(child_value))
                ):
                    pairs.add((float(child_value), unit))
                visit(child_value, child_key_text)
        elif isinstance(value, list):
            for item in value:
                visit(item, key)
        elif isinstance(value, str):
            for match in _NUMBER_WITH_UNIT_PATTERN.finditer(value):
                number = float(match.group(1).replace(",", "."))
                unit = _canonical_measure_unit(match.group(2))
                if math.isfinite(number):
                    pairs.add((number, unit))

    visit(context_payload)
    return pairs


def _is_locally_negated(folded: str, match_start: int) -> bool:
    prefix = folded[max(0, match_start - 50) : match_start]
    return bool(_LOCAL_NEGATION_PREFIX.search(prefix))


def audit_answer(answer: str, context_payload: dict[str, Any]) -> list[str]:
    """Devuelve motivos de rechazo; lista vacía significa que la guarda pasó."""
    reasons: list[str] = []
    allowed_measurements = _allowed_measurement_pairs(context_payload)
    folded_all = _fold(answer)

    if any(pattern.search(folded_all) for pattern in _PROMPT_LEAK_PATTERNS):
        reasons.append("La respuesta filtra instrucciones internas o esquema del prompt.")
        return reasons

    if len(_ENGLISH_ONLY_MARKERS.findall(folded_all)) >= 1 and not _SPANISH_MARKERS.search(folded_all):
        reasons.append("La respuesta no cumple el contrato de idioma español.")
        return reasons

    for sentence in _sentences(answer):
        folded = _fold(sentence)
        if any(pattern.search(folded) for pattern in _UNSAFE_REASSURANCE_PATTERNS):
            reasons.append("La respuesta emite un descarte clínico o signo vital normal no sustentado.")
            break

        for dose_match in _DOSE_PATTERN.finditer(folded):
            if not _is_locally_negated(folded, dose_match.start()):
                reasons.append("La respuesta incluye una dosis de medicamento.")
                break
        if reasons:
            break

        med_match = _MEDICATION_PATTERN.search(folded)
        if med_match and not _is_locally_negated(folded, med_match.start()):
            if _PRESCRIPTIVE_VERB_PATTERN.search(folded) and not _is_locally_negated(
                folded, _PRESCRIPTIVE_VERB_PATTERN.search(folded).start()  # type: ignore[union-attr]
            ):
                reasons.append("La respuesta sugiere o prescribe un medicamento.")
                break

        diag_hit = False
        for pattern in _DIAGNOSIS_PATTERNS:
            for m in pattern.finditer(folded):
                if not _is_locally_negated(folded, m.start()):
                    reasons.append("La respuesta afirma un diagnóstico o descarte clínico no sustentado.")
                    diag_hit = True
                    break
            if diag_hit:
                break
        if diag_hit:
            break

    for match in _NUMBER_WITH_UNIT_PATTERN.finditer(answer):
        value = float(match.group(1).replace(",", "."))
        unit = _canonical_measure_unit(match.group(2))
        if (value, unit) not in allowed_measurements:
            reasons.append(
                f"La medida '{match.group(0)}' no aparece con esa unidad en el contexto aislado."
            )
            break

    vital_summary = context_payload.get("vital_summary")
    if isinstance(vital_summary, dict):
        direction = vital_summary.get("trend_direction")
        if direction == "rising" and _PULSE_DECREASE_PATTERN.search(folded_all):
            reasons.append("La dirección descrita del pulso contradice el delta observado.")
        elif direction == "falling" and _PULSE_INCREASE_PATTERN.search(folded_all):
            reasons.append("La dirección descrita del pulso contradice el delta observado.")
        elif direction == "stable" and (
            _PULSE_DECREASE_PATTERN.search(folded_all)
            or _PULSE_INCREASE_PATTERN.search(folded_all)
        ):
            reasons.append("La respuesta atribuye una dirección de cambio que no muestra el delta.")

        delta = vital_summary.get("delta_from_baseline_bpm")
        threshold = vital_summary.get("illustrative_delta_threshold_bpm")
        if (
            isinstance(delta, (int, float))
            and not isinstance(delta, bool)
            and math.isfinite(float(delta))
            and isinstance(threshold, (int, float))
            and not isinstance(threshold, bool)
            and math.isfinite(float(threshold))
            and float(threshold) >= 0
        ):
            abs_delta = abs(float(delta))
            limit = float(threshold)
            if abs_delta > limit and _WITHIN_THRESHOLD_CLAIM.search(folded_all):
                reasons.append(
                    "La respuesta afirma que el delta está dentro del umbral cuando lo supera."
                )
            elif abs_delta <= limit and _EXCEEDS_THRESHOLD_CLAIM.search(folded_all):
                reasons.append(
                    "La respuesta afirma que el delta supera el umbral cuando no lo hace."
                )

    if context_payload.get("status") == "missing_data":
        context_text = _fold(json.dumps(context_payload, ensure_ascii=False, default=str))
        for match in _MISSING_DATA_ANOMALY_CLAIM.finditer(folded_all):
            if (
                not re.search(rf"\b{re.escape(_fold(match.group(0)))}\b", context_text)
                and not _is_locally_negated(folded_all, match.start())
            ):
                reasons.append("La ausencia de datos se presenta como anomalía sin mediciones que la sustenten.")
                break
        for match in _UNSUPPORTED_MISSING_DATA_CAUSE.finditer(folded_all):
            if not re.search(rf"\b{re.escape(match.group(0))}\b", context_text):
                reasons.append("La respuesta atribuye una causa técnica no presente en el contexto.")
                break

    context_text = _fold(json.dumps(context_payload, ensure_ascii=False, default=str))
    for match in _UNSUPPORTED_ORGAN_FUNCTION_INFERENCE.finditer(folded_all):
        if not re.search(rf"\b{re.escape(_fold(match.group(0)))}\b", context_text):
            reasons.append("La respuesta infiere funcionamiento de un sistema corporal sin evidencia explícita.")
            break

    return reasons
