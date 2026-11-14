# Contrato de integración — Iteración 1

Proyecto: `/home/bunuelo/astrotwin-3d`. React 19, Vite, TS, R3F y Drei. npm.

## Propiedad de archivos

- Coordinador: App.tsx, CSS, configuración, componentes shadcn, integración y QA.
- Antigravity: src/scene/**, scripts/blender/**, public/models/**, docs/MODEL.md. No editar App ni contracts.ts.
- OpenCode: src/engine/**, docs/ENGINE.md, pruebas del motor. No editar App, escena ni contracts.ts.

Contrato tipado en src/contracts.ts. Antigravity exporta `default function TwinScene(props:TwinSceneProps)` desde src/scene/TwinScene.tsx: incluye Canvas, OrbitControls, luces, modelo con 5 capas, plataforma, marcadores de alerta, manejo WebGL error/fallback. Root de anatomía en metros, Y arriba, frente mirando +Z, pies y=0. Cámara frontal [0,1.1,3.8], objetivo [0,.95,0]. Nombre de capas glTF: layer_skeleton, layer_organs, layer_muscle, layer_skin, layer_suit. Órganos heart, lungs, brain, digestive; marcador suit. GLB comprimido local con decoder local o Meshopt importado del paquete, nunca CDN. Disparar onSelectOrgan al click. Informar FPS medidos mediante callback máximo una vez por segundo. Pausa y reducedMotion deben detener movimiento decorativo y animación biomecánica sin detener OrbitControls. Evitar setState/useFrame y crear geometrías en cada frame.

OpenCode exporta desde src/engine/index.ts: `getSimulationFrame(scenario:ScenarioId,elapsedSeconds:number):SimulationFrame`, `getBiomechanics(vitals:Vitals,elapsedSeconds:number):{breath:number;heartbeat:number;sway:number}`, `DiagnosticEngineStub` (async evaluate, responde explícitamente sin modelo clínico; no red). Reexportar tipos si conviene, pero contratos viven en contracts.ts. Funciones puras, reproducibles, sin Date.now/Math.random interno, sin timers. Sin valores no finitos; unidad radiación = µSv/h, exposición ambiental ficticia, no dosis personal. Reglas/umbrales de demo documentados sin llamarlos clínicamente validados. Añadir pruebas Vitest para escenarios, pausa temporal, límites, sin mutación, stub desacoplado. La escena puede importar getBiomechanics; si el motor aún no existe usar dinámica local temporal y sustituir tras integración.

## Rúbrica

25 anatomía/capas + 25 biomecánica/alertas + 25 diseño/shadcn + 25 rendimiento/seguridad. Aprobación >=95 con evidencia. No atribuir puntuaciones verificadas a cosas no medidas. 60 FPS objetivo de dispositivo, registrar hardware y medición real.

## Dirección de arte

Gemelo humano de calidad como protagonista 3D. No muñeco de cilindros. Silueta suave, manos con dedos, pies, rostro simplificado y anatomía proporcionada. 5 capas alineadas visualmente. Órganos dentro del cuerpo, huesos con costillas/pelvis/columna, músculos con grupos distinguibles. Skin cian translúcido moderado, órganos vivos cian/violeta/coral; rojo reservado para alertas. Traje blanco perlado y grafito, visor azul. Plataforma orbital fina y ambiente navy #070b14. HUD silencioso, 260px lados, center libre. Modelo anatómico estilizado educativo; no diagnóstico ni anatomía validada. Assets y modelos externos requieren origen/licencia verificables en MODEL.md; procedural original es aceptable. No pago por APIs.
