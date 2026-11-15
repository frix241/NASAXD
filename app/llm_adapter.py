"""Adaptador local configurable para Ollama o llama.cpp con salida JSON validada."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from app.config import AppSettings
from app.contracts import ALLOWED_ACTIONS, ALLOWED_ZONES, LLMOutputPayload
from app.safety import (
    EMERGENCY_BYPASS_REASON,
    audit_answer,
    emergency_output,
    is_emergency,
)


_ACTION_LABELS_ES: dict[str, str] = {
    "reduce_mission_intensity": "Reducir intensidad de la misión activa (requiere confirmación)",
    "request_recheck": "Solicitar nueva medición de control (requiere confirmación)",
    "record_observation": "Registrar observación operativa (requiere confirmación)",
    "log_hydration": "Registrar ingesta de hidratación (requiere confirmación)",
    "pause_exertion": "Pausar esfuerzo físico de demostración (requiere confirmación)",
    "inspect_catalog_parameter": "Inspeccionar parámetro en el catálogo (requiere confirmación)",
    "open_system_view": "Abrir vista del sistema seleccionado (requiere confirmación)",
}


def load_versioned_prompt(prompts_dir: Path, prompt_name: str = "az3tro_chat_v1.json") -> dict[str, Any]:
    """Carga un prompt versionado desde prompts/."""
    path = prompts_dir / prompt_name
    if not path.exists():
        return {
            "version": "fallback-0.0.0",
            "id": prompt_name,
            "system_prompt": (
                "Responde en español en JSON válido con claves: "
                "answer, citations, proposed_actions, safety_note. Sin diagnósticos."
            ),
        }
    return json.loads(path.read_text(encoding="utf-8"))


class LocalLLMAdapter:
    """Adaptador para Ollama (/api/chat) o llama.cpp (/v1/chat/completions)."""

    def __init__(self, settings: AppSettings, client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._client = client
        self.last_safety_audit: dict[str, Any] = {}

    def check_availability(self) -> dict[str, Any]:
        """Inspección read-only de disponibilidad sin cargar modelos en memoria.

        Distingue entre servidor accesible, modelo listado en tags e inferencia comprobada.
        """
        provider = self.settings.llm_provider
        base_url = self.settings.llm_base_url
        endpoint = f"{base_url}/api/tags" if provider == "ollama" else f"{base_url}/health"

        try:
            client = self._client or httpx.Client(timeout=1.5)
            should_close = self._client is None
            try:
                resp = client.get(endpoint)
            finally:
                if should_close:
                    client.close()
            if resp.status_code != 200:
                return {
                    "available": False,
                    "server_reachable": False,
                    "model_installed": False,
                    "inference_verified": False,
                    "provider": provider,
                    "model": self.settings.llm_model,
                    "endpoint": endpoint,
                    "models_listed": [],
                    "reason": f"HTTP {resp.status_code} en {endpoint}",
                }
            models_listed: list[str] = []
            model_installed: bool | None = None
            if provider == "ollama":
                payload = resp.json()
                models_listed = [
                    str(m.get("name"))
                    for m in payload.get("models", [])
                    if isinstance(m, dict) and m.get("name")
                ]
                model_installed = self.settings.llm_model in models_listed
                available = bool(model_installed)
                reason = (
                    "Servidor y modelo listados (inspección read-only; inferencia no ejecutada)."
                    if available
                    else f"Servidor Ollama accesible, pero el modelo '{self.settings.llm_model}' no figura en /api/tags."
                )
            else:
                available = True
                reason = "Servidor llama.cpp accesible (/health 200; inferencia no ejecutada)."
            return {
                "available": available,
                "server_reachable": True,
                "model_installed": model_installed,
                "inference_verified": False,
                "provider": provider,
                "model": self.settings.llm_model,
                "endpoint": endpoint,
                "models_listed": models_listed,
                "reason": reason,
            }
        except (httpx.HTTPError, ValueError) as exc:
            return {
                "available": False,
                "server_reachable": False,
                "model_installed": False,
                "inference_verified": False,
                "provider": provider,
                "model": self.settings.llm_model,
                "endpoint": endpoint,
                "models_listed": [],
                "reason": f"No disponible ({type(exc).__name__})",
            }

    def generate_structured(
        self,
        user_message: str,
        context_payload: dict[str, Any],
        allowed_actions: list[str],
        allowed_citations: list[str],
        language: str = "es",
    ) -> tuple[LLMOutputPayload | None, bool, str | None, str]:
        """Llama al LLM local y valida estrictamente el JSON devuelto.

        Devuelve (payload_validado, llm_available, unavailable_reason, prompt_version).
        Nunca finge que las reglas son salida del LLM.
        """
        prompt_doc = load_versioned_prompt(self.settings.prompts_dir, "az3tro_chat_v1.json")
        prompt_version = str(prompt_doc.get("version", "unknown"))
        system_prompt = str(prompt_doc.get("system_prompt", ""))
        if language == "en":
            system_prompt += "\nReply in clear English. Keep the same non-diagnostic safety rules."

        self.last_safety_audit = {
            "emergency_bypass": False,
            "model_consulted": False,
            "dropped_citations": [],
            "dropped_actions": [],
            "normalized_action_labels": [],
            "normalized_action_formats": [],
            "ignored_model_safety_note": False,
            "rejected_reason": None,
        }
        projected_daily_context = _project_daily_context(context_payload.get("daily_context"))
        daily_urgent_red_flag = bool(
            isinstance(projected_daily_context, dict)
            and isinstance(projected_daily_context.get("symptoms"), dict)
            and projected_daily_context["symptoms"].get("urgent_red_flag") is True
        )
        if is_emergency(user_message) or daily_urgent_red_flag:
            self.last_safety_audit["emergency_bypass"] = True
            return emergency_output(language), False, EMERGENCY_BYPASS_REASON, prompt_version

        bounded_context: dict[str, Any] = {
            "profile_id": context_payload.get("profile_id"),
            "namespace": context_payload.get("namespace"),
            "status": context_payload.get("status"),
            "policy_action": context_payload.get("policy_action"),
            "matched_policy_id": context_payload.get("matched_policy_id"),
            "abstained": context_payload.get("abstained"),
            "observations": context_payload.get("observations", []),
            "pulse_disclaimer": context_payload.get("pulse_disclaimer"),
            "allowed_actions": [a for a in allowed_actions if a in ALLOWED_ACTIONS],
            "allowed_citations": allowed_citations,
        }
        for key in ("baseline", "vital_summary", "affected_zone", "mission_plan"):
            value = context_payload.get(key)
            if isinstance(value, dict):
                bounded_context[key] = value
        if projected_daily_context is not None:
            bounded_context["daily_context"] = projected_daily_context
        user_prompt = (
            f"Contexto aislado:\n{json.dumps(bounded_context, ensure_ascii=False)}\n\n"
            f"Pregunta del usuario:\n{user_message}"
        )

        raw_content: str | None = None
        self.last_safety_audit["model_consulted"] = True
        try:
            client = self._client or httpx.Client(timeout=self.settings.llm_timeout_seconds)
            should_close = self._client is None
            try:
                if self.settings.llm_provider == "ollama":
                    resp = client.post(
                        f"{self.settings.llm_base_url}/api/chat",
                        json={
                            "model": self.settings.llm_model,
                            "stream": False,
                            "format": "json",
                            "options": {"temperature": 0.1},
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt},
                            ],
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    raw_content = (
                        data.get("message", {}).get("content")
                        if isinstance(data.get("message"), dict)
                        else None
                    )
                else:
                    resp = client.post(
                        f"{self.settings.llm_base_url}/v1/chat/completions",
                        json={
                            "model": self.settings.llm_model,
                            "temperature": 0.1,
                            "response_format": {"type": "json_object"},
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt},
                            ],
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    choices = data.get("choices") or []
                    if choices and isinstance(choices[0], dict):
                        raw_content = choices[0].get("message", {}).get("content")
            finally:
                if should_close:
                    client.close()
        except (httpx.HTTPError, ValueError) as exc:
            reason = f"Modelo local no disponible ({type(exc).__name__}). Se muestra evaluación determinista."
            self.last_safety_audit["rejected_reason"] = reason
            return None, False, reason, prompt_version

        if not raw_content or not isinstance(raw_content, str):
            reason = "El modelo local devolvió una respuesta vacía."
            self.last_safety_audit["rejected_reason"] = reason
            return None, False, reason, prompt_version

        parsed = _extract_json_object(raw_content)
        if parsed is None:
            reason = "La salida del modelo local no fue JSON válido."
            self.last_safety_audit["rejected_reason"] = reason
            return None, False, reason, prompt_version

        # The scope disclaimer is a fixed server-owned contract. A small local
        # model must not be able to replace it with an unsupported reassurance.
        if "safety_note" in parsed:
            self.last_safety_audit["ignored_model_safety_note"] = True
            parsed.pop("safety_note", None)

        # Filtrado estricto de citas y acciones permitidas. Las violaciones se
        # registran en la auditoría, no se ocultan.
        if isinstance(parsed.get("citations"), list):
            raw_citations = [str(c) for c in parsed["citations"]]
            self.last_safety_audit["dropped_citations"] = [
                c for c in raw_citations if c not in allowed_citations
            ]
            parsed["citations"] = [c for c in raw_citations if c in allowed_citations]
        if isinstance(parsed.get("proposed_actions"), list):
            valid_actions = []
            for item in parsed["proposed_actions"]:
                if isinstance(item, str):
                    action_id = item
                    if (
                        action_id in allowed_actions
                        and action_id in _ACTION_LABELS_ES
                    ):
                        valid_actions.append(
                            {
                                "action": action_id,
                                "label": _ACTION_LABELS_ES[action_id],
                                "requires_confirmation": True,
                                "target_zone": None,
                            }
                        )
                        self.last_safety_audit["normalized_action_formats"].append(
                            action_id
                        )
                    else:
                        self.last_safety_audit["dropped_actions"].append(action_id)
                    continue
                if (
                    isinstance(item, dict)
                    and item.get("action") in allowed_actions
                    and item.get("action") in _ACTION_LABELS_ES
                ):
                    action_id = str(item["action"])
                    trusted_label = _ACTION_LABELS_ES[action_id]
                    raw_label = str(item.get("label") or "").strip()
                    if raw_label != trusted_label:
                        self.last_safety_audit["normalized_action_labels"].append(action_id)
                    sanitized_item: dict[str, Any] = {
                        "action": action_id,
                        "label": trusted_label,
                        "requires_confirmation": True,
                        "target_zone": (
                            item.get("target_zone")
                            if item.get("target_zone") in ALLOWED_ZONES
                            else None
                        ),
                    }
                    valid_actions.append(sanitized_item)
                else:
                    action = item.get("action") if isinstance(item, dict) else None
                    self.last_safety_audit["dropped_actions"].append(str(action))
            parsed["proposed_actions"] = valid_actions

        if isinstance(parsed.get("safety_note"), str) and not parsed["safety_note"].strip():
            parsed.pop("safety_note")

        if self.last_safety_audit["dropped_citations"] or self.last_safety_audit["dropped_actions"]:
            reason = "Salida rechazada por citas o acciones fuera de la lista permitida."
            self.last_safety_audit["rejected_reason"] = reason
            return None, False, reason, prompt_version

        try:
            validated = LLMOutputPayload.model_validate(parsed)
        except ValidationError as exc:
            reason = f"La salida JSON del modelo no cumplió el contrato ({exc.error_count()} errores)."
            self.last_safety_audit["rejected_reason"] = reason
            return None, False, reason, prompt_version

        safety_reasons = [
            f"answer: {reason}"
            for reason in audit_answer(validated.answer, context_payload)
        ]
        safety_reasons.extend(
            f"safety_note: {reason}"
            for reason in audit_answer(validated.safety_note, context_payload)
        )
        if safety_reasons:
            reason = "Salida rechazada por el filtro de seguridad: " + "; ".join(safety_reasons)
            self.last_safety_audit["rejected_reason"] = reason
            return None, False, reason, prompt_version

        return validated, True, None, prompt_version


def _project_daily_context(raw: Any) -> dict[str, Any] | None:
    """Proyección mínima y acotada del contexto diario confirmado hacia el LLM.

    Nunca incluye audio crudo, transcripciones textuales ni condición/medicación declarada.
    """
    if not isinstance(raw, dict):
        return None

    sleep_raw = raw.get("sleep_rest") if isinstance(raw.get("sleep_rest"), dict) else {}
    activity_raw = (
        raw.get("recent_activity") if isinstance(raw.get("recent_activity"), dict) else {}
    )
    symptoms_raw = raw.get("symptoms") if isinstance(raw.get("symptoms"), dict) else {}
    routine_raw = (
        raw.get("routine_change") if isinstance(raw.get("routine_change"), dict) else {}
    )

    return {
        "context_id": raw.get("context_id"),
        "sleep_rest": {
            "status": sleep_raw.get("status"),
            "value": sleep_raw.get("value"),
            "hours": sleep_raw.get("hours"),
        },
        "recent_activity": {
            "status": activity_raw.get("status"),
            "value": activity_raw.get("value"),
        },
        "symptoms": {
            "status": symptoms_raw.get("status"),
            "has_active_symptoms": bool(symptoms_raw.get("has_active_symptoms", False)),
            "urgent_red_flag": bool(symptoms_raw.get("urgent_red_flag", False)),
            "active_symptoms": [
                str(s) for s in (symptoms_raw.get("active_symptoms") or []) if isinstance(s, str)
            ],
            "negated_symptoms": [
                str(s) for s in (symptoms_raw.get("negated_symptoms") or []) if isinstance(s, str)
            ],
        },
        "routine_change": {
            "status": routine_raw.get("status"),
            "value": routine_raw.get("value"),
        },
    }


def _extract_json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        obj = json.loads(stripped)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", stripped, flags=re.DOTALL)
        if not match:
            return None
        try:
            obj = json.loads(match.group(0))
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
