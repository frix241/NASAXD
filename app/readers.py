"""Lectores defensivos de artefactos ML (results/) y laboratorios reales (solo lectura)."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


def _safe_float(value: Any) -> float | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num != num:  # NaN
        return None
    return num


def _safe_int(value: Any) -> int | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def read_summary_json(results_dir: Path) -> dict[str, Any]:
    """Lee results/summary.json con esquema defensivo y sin inventar métricas."""
    path = results_dir / "summary.json"
    if not path.exists():
        return {
            "state": "empty",
            "path": str(path),
            "message": "Aún no existe results/summary.json. El flujo ML no ha publicado resumen.",
            "summary": None,
            "limitations": [
                "Sin resultados ML publicados todavía; no se muestran métricas simuladas."
            ],
        }

    try:
        raw_text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return {
            "state": "error",
            "path": str(path),
            "message": f"No se pudo leer summary.json: {exc}",
            "summary": None,
            "limitations": ["Error de lectura en results/summary.json."],
        }

    if not raw_text.strip():
        return {
            "state": "empty",
            "path": str(path),
            "message": "results/summary.json está vacío.",
            "summary": None,
            "limitations": ["Archivo summary.json vacío."],
        }

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        return {
            "state": "error",
            "path": str(path),
            "message": f"JSON inválido en summary.json: {exc}",
            "summary": None,
            "limitations": ["El archivo summary.json contiene JSON mal formado."],
        }

    if not isinstance(data, dict):
        return {
            "state": "error",
            "path": str(path),
            "message": "summary.json debe ser un objeto JSON.",
            "summary": None,
            "limitations": ["Estructura inesperada en summary.json."],
        }

    metrics = data.get("metrics") if isinstance(data.get("metrics"), dict) else {}
    pooled = (
        metrics.get("holdout_pooled")
        if isinstance(metrics.get("holdout_pooled"), dict)
        else (
            metrics.get("validation_pooled")
            if isinstance(metrics.get("validation_pooled"), dict)
            else {}
        )
    )

    macro_f1 = _safe_float(metrics.get("macro_f1"))
    if macro_f1 is None:
        macro_f1 = _safe_float(pooled.get("macro_f1"))

    accuracy = _safe_float(metrics.get("accuracy"))
    if accuracy is None:
        accuracy = _safe_float(pooled.get("accuracy"))

    confusion = (
        metrics.get("confusion_matrix")
        if metrics.get("confusion_matrix") is not None
        else (
            pooled.get("confusion_matrix")
            if pooled.get("confusion_matrix") is not None
            else data.get("confusion_matrix")
        )
    )
    if isinstance(confusion, dict) and isinstance(confusion.get("matrix"), list):
        confusion = confusion.get("matrix")

    ci95 = metrics.get("ci95") if metrics.get("ci95") is not None else data.get("ci95")
    if ci95 is None and isinstance(metrics.get("uncertainty"), dict):
        unc = metrics["uncertainty"]
        holdout_unc = unc.get("holdout") if isinstance(unc.get("holdout"), dict) else unc.get("validation")
        if isinstance(holdout_unc, dict):
            primary_key = holdout_unc.get("primary") or "series_cluster_bootstrap"
            if isinstance(holdout_unc.get(primary_key), dict):
                ci95 = holdout_unc[primary_key]

    limitations_raw = data.get("limitations")
    limitations = (
        [str(item) for item in limitations_raw if item]
        if isinstance(limitations_raw, list)
        else []
    )
    if not limitations:
        limitations.append(
            "Sin limitaciones explícitas en summary.json; revisar procedencia del benchmark antes de interpretar."
        )

    score = _safe_float(data.get("score"))
    status = str(data.get("status") or ("ok" if score is not None or metrics else "partial"))
    benchmark_raw = data.get("benchmark")
    benchmark_name = (
        benchmark_raw.get("name")
        if isinstance(benchmark_raw, dict)
        else benchmark_raw
    )

    normalized_metrics = dict(metrics)
    if macro_f1 is not None:
        normalized_metrics.setdefault("macro_f1", round(macro_f1, 4))
    if accuracy is not None:
        normalized_metrics.setdefault("accuracy", round(accuracy, 4))

    normalized = {
        "status": status,
        "benchmark": benchmark_name,
        "score": score,
        "score_scale": data.get("score_scale") or "0-100",
        "metrics": normalized_metrics,
        "confusion_matrix": confusion,
        "ci95": ci95,
        "artifacts": data.get("artifacts") if isinstance(data.get("artifacts"), dict) else {},
        "raw": data,
    }

    return {
        "state": "ok" if (score is not None or metrics) else "partial",
        "path": str(path),
        "message": "Resumen ML cargado correctamente.",
        "summary": normalized,
        "limitations": limitations,
    }


def read_metrics_history_csv(results_dir: Path, limit: int = 200) -> dict[str, Any]:
    """Lee results/metrics_history.csv de forma defensiva."""
    path = results_dir / "metrics_history.csv"
    if not path.exists():
        return {
            "state": "empty",
            "path": str(path),
            "message": "Aún no existe results/metrics_history.csv.",
            "columns": [],
            "rows": [],
            "total_rows": 0,
        }

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                return {
                    "state": "empty",
                    "path": str(path),
                    "message": "metrics_history.csv no contiene encabezados.",
                    "columns": [],
                    "rows": [],
                    "total_rows": 0,
                }
            columns = [c.strip() for c in reader.fieldnames if c is not None]
            rows: list[dict[str, Any]] = []
            for idx, raw_row in enumerate(reader):
                if idx >= limit:
                    break
                cleaned: dict[str, Any] = {}
                for col in columns:
                    val = raw_row.get(col)
                    if val is None:
                        cleaned[col] = None
                    else:
                        stripped = val.strip()
                        num = _safe_float(stripped)
                        cleaned[col] = num if num is not None and stripped != "" else stripped
                rows.append(cleaned)
    except (OSError, csv.Error) as exc:
        return {
            "state": "error",
            "path": str(path),
            "message": f"Error al leer metrics_history.csv: {exc}",
            "columns": [],
            "rows": [],
            "total_rows": 0,
        }

    if not rows:
        return {
            "state": "empty",
            "path": str(path),
            "message": "metrics_history.csv no contiene filas de entrenamiento.",
            "columns": columns,
            "rows": [],
            "total_rows": 0,
        }

    return {
        "state": "ok",
        "path": str(path),
        "message": f"{len(rows)} registros históricos cargados.",
        "columns": columns,
        "rows": rows,
        "total_rows": len(rows),
    }


def read_parameter_catalog_json(
    results_dir: Path,
    search: str | None = None,
    sheet: str | None = None,
) -> dict[str, Any]:
    """Lee results/parameter_catalog.json generado desde el Excel de NASA por el worker ML."""
    path = results_dir / "parameter_catalog.json"
    if not path.exists():
        return {
            "state": "empty",
            "path": str(path),
            "message": "Aún no existe results/parameter_catalog.json (generado desde Excel por el módulo ML).",
            "items": [],
            "sheets": [],
            "total": 0,
            "metadata": {},
        }

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "state": "error",
            "path": str(path),
            "message": f"No se pudo leer parameter_catalog.json: {exc}",
            "items": [],
            "sheets": [],
            "total": 0,
            "metadata": {},
        }

    metadata: dict[str, Any] = {}
    raw_items: list[dict[str, Any]] = []
    if isinstance(data, list):
        raw_items = [x for x in data if isinstance(x, dict)]
    elif isinstance(data, dict):
        metadata = {
            k: v
            for k, v in data.items()
            if k not in ("items", "parameters", "rows", "records", "catalog", "risk_entries", "sheets")
        }
        for key in ("items", "parameters", "rows", "records", "catalog", "risk_entries"):
            candidate = data.get(key)
            if isinstance(candidate, list):
                for row in candidate:
                    if isinstance(row, dict):
                        item = dict(row)
                        if key == "risk_entries":
                            item.setdefault("sheet", "Riesgos")
                        raw_items.append(item)
                break
        if not raw_items and "sheets" in data:
            if isinstance(data["sheets"], dict):
                for sheet_name, sheet_rows in data["sheets"].items():
                    if isinstance(sheet_rows, list):
                        for row in sheet_rows:
                            if isinstance(row, dict):
                                item = dict(row)
                                item.setdefault("sheet", sheet_name)
                                raw_items.append(item)
            elif isinstance(data["sheets"], list):
                for sheet_obj in data["sheets"]:
                    if isinstance(sheet_obj, dict) and isinstance(sheet_obj.get("rows"), list):
                        sheet_name = str(sheet_obj.get("name") or "General")
                        for row in sheet_obj["rows"]:
                            if isinstance(row, dict):
                                item = dict(row)
                                item.setdefault("sheet", sheet_name)
                                raw_items.append(item)
    else:
        return {
            "state": "error",
            "path": str(path),
            "message": "Formato inesperado en parameter_catalog.json.",
            "items": [],
            "sheets": [],
            "total": 0,
            "metadata": {},
        }

    sheets = sorted(
        {
            str(item.get("sheet") or item.get("hoja") or "General")
            for item in raw_items
        }
    )

    filtered = raw_items
    if sheet:
        sheet_lower = sheet.strip().lower()
        filtered = [
            item
            for item in filtered
            if str(item.get("sheet") or item.get("hoja") or "General").lower() == sheet_lower
        ]
    if search:
        q = search.strip().lower()
        filtered = [
            item
            for item in filtered
            if q in json.dumps(item, ensure_ascii=False).lower()
        ]

    return {
        "state": "ok" if raw_items else "empty",
        "path": str(path),
        "message": (
            f"{len(filtered)} parámetros mostrados (de {len(raw_items)} totales)."
            if raw_items
            else "El catálogo está vacío."
        ),
        "items": filtered,
        "sheets": sheets,
        "total": len(raw_items),
        "filtered_total": len(filtered),
        "metadata": metadata,
    }


def read_real_labs_tidy(data_root: Path, limit: int = 120) -> dict[str, Any]:
    """Lee datos_reales/inspiration4_laboratorios_tidy.csv en modo solo lectura.

    Filtra estrictamente calidad == 'ok' y reporta las filas excluidas (ej. C003 L-92).
    """
    path = data_root / "datos_reales" / "inspiration4_laboratorios_tidy.csv"
    if not path.exists():
        return {
            "state": "empty",
            "namespace": "real_lab_nasa_osdr",
            "path": str(path),
            "message": "No se encontró el archivo de laboratorios reales Inspiration4.",
            "records": [],
            "ok_count": 0,
            "excluded_count": 0,
            "subjects": [],
            "sources": [],
        }

    ok_records: list[dict[str, Any]] = []
    excluded_rows: list[dict[str, Any]] = []
    subjects: set[str] = set()
    sources: set[str] = set()

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                quality = str(row.get("calidad") or "").strip().lower()
                if quality != "ok":
                    excluded_rows.append(
                        {
                            "sujeto": row.get("sujeto"),
                            "momento": row.get("momento"),
                            "analito": row.get("analito"),
                            "calidad": row.get("calidad"),
                        }
                    )
                    continue
                sujeto = str(row.get("sujeto") or "").strip()
                fuente = str(row.get("fuente") or "").strip()
                if sujeto:
                    subjects.add(sujeto)
                if fuente:
                    sources.add(fuente)
                if len(ok_records) < limit:
                    ok_records.append(
                        {
                            "namespace": "real_lab_nasa_osdr",
                            "fuente": fuente,
                            "analito": row.get("analito"),
                            "valor": _safe_float(row.get("valor"))
                            if _safe_float(row.get("valor")) is not None
                            else row.get("valor"),
                            "unidad": row.get("unidad"),
                            "sujeto": sujeto,
                            "momento": row.get("momento"),
                            "fase": row.get("fase"),
                            "bandera": row.get("bandera"),
                            "calidad": row.get("calidad"),
                        }
                    )
    except (OSError, csv.Error) as exc:
        return {
            "state": "error",
            "namespace": "real_lab_nasa_osdr",
            "path": str(path),
            "message": f"Error leyendo laboratorios reales: {exc}",
            "records": [],
            "ok_count": 0,
            "excluded_count": 0,
            "subjects": [],
            "sources": [],
        }

    total_ok = len(ok_records) if len(ok_records) < limit else None
    # Count total ok accurately without storing all in memory
    if total_ok is None:
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                total_ok = sum(
                    1
                    for r in csv.DictReader(handle)
                    if str(r.get("calidad") or "").strip().lower() == "ok"
                )
        except OSError:
            total_ok = len(ok_records)

    return {
        "state": "ok" if ok_records else "empty",
        "namespace": "real_lab_nasa_osdr",
        "path": str(path),
        "message": (
            f"{total_ok} mediciones con calidad='ok' (muestra de {len(ok_records)}); "
            f"{len(excluded_rows)} filas excluidas por calidad != 'ok'."
        ),
        "records": ok_records,
        "ok_count": total_ok,
        "excluded_count": len(excluded_rows),
        "excluded_sample": excluded_rows[:5],
        "subjects": sorted(subjects),
        "sources": sorted(sources),
        "limitations": [
            "Datos reales NASA OSDR (OSD-569/OSD-575, 4 tripulantes). "
            "No equivalen a los perfiles sintéticos (C001-sim..C004-sim) ni validan diagnóstico clínico."
        ],
    }
