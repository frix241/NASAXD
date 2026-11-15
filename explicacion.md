# AstroTwin — flujo de salud diaria

Este paquete reúne el código del flujo que pregunta contexto diario, recibe signos vitales, aplica reglas de anomalías y devuelve una recomendación breve. El LLM es opcional y no determina el estado clínico ni modifica la misión.

## Qué ocurre en una interacción

1. `web/daily_voice_guide.js` pregunta por sueño, actividad, molestias, cambios de rutina y condición declarada. La UI pide consentimiento, muestra la transcripción y exige confirmación antes de guardar.
2. `app/daily_context.py` valida y almacena temporalmente el contexto confirmado; expone una vista segura para la evaluación y admite revocación/expiración.
3. `app/multi_vitals.py` evalúa las mediciones recibidas contra referencias y límites configurados. Devuelve estado, zona del gemelo, observaciones, mensajes y acciones permitidas. Para 80 BPM en reposo, por ejemplo, informa que está dentro de la referencia general. Si una lectura queda fuera de rango, puede sugerir reposar y repetirla; las señales de emergencia se escalan mediante reglas. El endpoint declara `llm_used: false`.
4. `app/mission_policy.py`, `app/daily_workflow.py` y `app/vitals_engine.py` combinan contexto, baseline y política de misión. Las acciones se proponen para confirmación humana; las reglas críticas no dependen del modelo.
5. `app/safety.py` detecta señales que requieren bypass. El bypass genera la respuesta de emergencia directamente y evita consultar el LLM.
6. `app/llm_adapter.py` sirve solamente al chat opcional: recibe el mensaje y el contexto ya calculado, valida el JSON, limita citas/acciones a allowlists y falla de forma segura. No calcula umbrales ni es un detector aprobado. La evaluación del modelo local no autorizó su uso para decidir anomalías o recomendaciones médicas.
7. `app/voice_pipeline.py`, `app/voice_bridge.py` y `app/voice_contracts.py` conectan PTT con STT/TTS locales. El texto se revisa antes de aceptarse; los puentes solo usan loopback y procesan audio en memoria.
8. `web/multi_vitals_panel.js`, `web/app.js` y `web/index.html` presentan el formulario, estado, recomendaciones, zona 3D y entrevista. `web/language.js` gestiona español/inglés.

## Módulos incluidos

- `app/`: implementación de API y dependencias internas del flujo, incluidos contratos, aislamiento de contexto, reglas, adaptador LLM y puentes de voz. Se conserva el `main.py` del proyecto para mantener sus endpoints reales y su configuración compartida.
- `web/`: shell de la aplicación y módulos frontend que consumen esos endpoints.
- `prompts/az3tro_chat_v1.json`: único prompt versionado que el adaptador de chat carga por contrato; no hay prompts de agentes o de entrenamiento.
- `deploy/voice/`: scripts del sidecar local STT/TTS y servidor TTS.
- `tests_app/`: pruebas unitarias y E2E relacionadas con contexto, anomalías, voz y seguridad.
- `requirements-app.txt` y `requirements-voice.txt`: dependencias Python del API y del sidecar sherpa-onnx.

No se incluyen datasets, pesos/binaries de Whisper, archivos de modelo de TTS, modelos Ollama ni artefactos de entrenamiento. Son dependencias grandes/externas y deben descargarse según sus manifests/licencias en el host de despliegue. Los datos de laboratorio y de ML no son necesarios para este flujo diario y no se mezclan con perfiles simulados.

## Integración en una web existente

1. Copia `app/` al backend Python o incorpora sus módulos manteniendo el paquete `app`. Instala `requirements-app.txt`.
2. En la aplicación FastAPI, monta `multi_vitals_router`, `vitals_router` y el router creado por `create_daily_workflow_router(settings)`. Conserva de `main.py` los endpoints de contexto diario/revocación y los puentes `POST /api/voice/stt`, `POST /api/voice/tts` y `/api/voice/pipeline`; comparten el singleton `DAILY_CONTEXT_STORE`. No crees una segunda instancia del store.
3. Sirve `web/` bajo el mismo origen que la API. Mantén los IDs del formulario usados por `web/app.js`, el evento `astrotwin:daily-context-updated` y `astrotwin:integration-3d`; el panel 3D escucha ese contrato para resaltar la zona. En una web propia, reproduce esas llamadas/eventos y conserva la confirmación explícita de transcripción y de cambios de misión.
4. Configura `ASTROTWIN_ROOT` al directorio del paquete y deja `prompts/` en esa raíz. Configura `ASTROTWIN_LLM_PROVIDER=ollama`, `ASTROTWIN_LLM_BASE_URL` y `ASTROTWIN_LLM_MODEL` solo si vas a habilitar el chat experimental. Para el flujo de vitales no hace falta el LLM.
5. Para audio, instala los pesos/binarios compatibles en `voice_models/` y `voice_build/`, valida sus hashes con los manifests originales, inicia los sidecars con `deploy/voice/start_voice_sidecars.sh` y activa `ASTROTWIN_VOICE_ENABLED=1`, `ASTROTWIN_STT_ENABLED=1`, `ASTROTWIN_VAD_ENABLED=1`, `ASTROTWIN_TTS_ENABLED=1`. Los sidecars deben seguir en `127.0.0.1`; no expongas sus puertos.
6. El backend puede atender en una interfaz apropiada para el despliegue; los puentes de voz se mantienen loopback. No publiques datos de salud sin autenticación, autorización y almacenamiento protegido.

### Endpoints principales

- `POST /api/interview/daily-context` — guarda contexto confirmado con consentimiento.
- `DELETE /api/interview/context/{profile_id}` — revoca/borra contexto.
- `POST /api/vitals/multi-check` — evalúa signos y métricas de misión; reglas, no LLM.
- `POST /api/chat` — explicación conversacional opcional; requiere `use_llm` y puede fallar/rechazarse.
- `POST /api/voice/stt?language=auto|es|en` — transcribe localmente y devuelve borrador para revisión.
- `POST /api/voice/tts` — sintetiza respuesta local del copiloto.

### Ejecución local

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-app.txt
ASTROTWIN_ROOT="$PWD" uvicorn app.main:app --host 127.0.0.1 --port 8000
```

El modo voz requiere los sidecars y pesos indicados arriba. Las pruebas de Python se ejecutan con `PYTHONPATH=. pytest tests_app -q`; las de navegador requieren Node, Playwright y Chromium configurados en el host.

## Límites y seguridad

Esto es un prototipo de demostración, no un dispositivo médico ni validación clínica. Los signos cargados manualmente se comparan con referencias generales de adulto en reposo; los límites no sustituyen el plan médico de misión. Ingesta de líquidos es un registro, no hidratación corporal; hueso/fuerza son mediciones periódicas; radiación requiere dosímetro personal y límite específico. No conviertas correlaciones en causas. No permitas que el LLM diagnostique, prescriba, emita una puntuación de riesgo inventada o ejecute cambios de misión sin confirmación humana.
