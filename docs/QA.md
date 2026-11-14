# QA AstroTwin — MVP revisado

Rúbrica: anatomía/capas 25; biomecánica/alertas 25; estética/HUD shadcn 25; WebGL/rendimiento/seguridad 25. Umbral de aprobación: 95/100. Evaluación final del coordinador: **95/100 para el MVP educativo**, según los criterios y límites documentados aquí. Es juicio de ingeniería y diseño, no validación médica ni certificación de anatomía o seguridad.

## Iteración 1

Skills consultadas: frontend-design, shadcn, vercel-react-best-practices, review-animations, orchestration, orca-cli. Las 4 primeras gobiernan diseño/verificación; las 2 últimas coordinación y browser. No existe threejs-skills instalada en el catálogo auditado.

Motor: OpenCode DeepSeek entregó 36/36 tests. Revisión del coordinador detectó asociación térmica incorrecta con brain; se corrigió a suit (temperatura corporal, sin inferir lesión cerebral). Todas las señales son simuladas.

UI: se consultaron get_add_command_for_items y view_items_in_registries del MCP shadcn, y CLI docs. Dos instalaciones CLI fallaron (timeout), incluida versión 4.22.0; get_item_examples del MCP también falló. Se aisló un fallo DNS: la misma URL respondió 200 por HTTPS resolviendo explícitamente ui.shadcn.com a 76.76.21.61. Se aplicó ese lookup sólo al proceso CLI con NODE_OPTIONS y se instalaron los componentes oficiales Button, Slider, ToggleGroup y Toggle, reemplazando los provisionales escritos por el coordinador. Sin cambios de DNS del sistema. Revisión de archivos: imports cn corregidos a @/lib/utils y transition-all reemplazado por transición de color 150ms. Slider conserva teclado/foco ARIA de Radix.

Modelo: Antigravity arrancó con solicitud Sonnet 5.5 pero su runtime mostró Opus 5.5; se pidió verificar y corregir selección efectiva. El recibo de Orca no demuestra el modelo efectivo.

## Iteraciones y puntuación

| Iteración | Anatomía/capas | Biomecánica/alertas | Diseño/shadcn | Rendimiento/seguridad | Total | Decisión |
|---|---:|---:|---:|---:|---:|---|
| 1, primera integración | 19 | 21 | 23 | 19 | 82 | Corregir contención, sobre-dibujo y pruebas incompletas |
| 2, pruebas integrales | 23 | 23 | 24 | 20 | 90 | Bloqueado por etiquetas DOM y recarga offline |
| 3, correcciones verificadas | 23 | 24 | 24 | 24 | 95 | Aprobado como MVP educativo |

Las notas intermedias registran el juicio del coordinador al revisar esos resultados, no puntuaciones obtenidas automáticamente de las pruebas. No se cambiaron los cuatro pesos de 25 puntos.

## Evidencia final

- `npm run build`: TypeScript y Vite completados. Permanece aviso de bundle 3D mayor de 500 KB; motor 3D empaquetado localmente y caché offline. No es error de ejecución.
- `npm test`: **36/36**, 3 archivos del motor. Repetido tras integración.
- `artifacts/browser-qa.json`: **14 comprobaciones aprobadas**, errores de consola/ejecución vacíos.
- `artifacts/state-qa.json`: **4 regresiones adicionales aprobadas** en el build final: coherencia de preset persistido, órganos después de recargar, selección del traje y nueva recarga offline. Total: **18 comprobaciones de navegador** entre ambos scripts.
- Cinco capas y disecciones; selector de órgano; cámara frontal/posterior/reset; cuatro escenarios con anillo; pausa; reporte JSON; restauración sin alerta; recarga offline; móvil 390 px sin desbordamiento; preferencia de movimiento reducido.
- Auditoría Blender: 49 mallas, 260.886 triángulos sumando todas las capas, cero vértices no finitos, normales inválidas o triángulos degenerados. Las mallas internas quedan contenidas en la piel según SDF después de corrección. JSON fuente en `public/models/mesh-audit.json` y `.stats.json`.
- GLB Draco: 683.724 bytes, contra 4.736.368 sin comprimir (~85,6 % menos). Decoder local.
- Auditoría npm de dependencias de producción: **0 vulnerabilidades conocidas** en la ejecución registrada. Esto no garantiza inexistencia de vulnerabilidades.

### FPS, hardware y memoria

Chromium 159 controlado con Playwright, viewport 1440×1000, DPR 1. GPU reportada por WebGL: `ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2), OpenGL ES 3.2)`.

| Preset | FPS de muestra |
|---|---:|
| Traje | 59,49 |
| Piel | 60,02 |
| Músculos | 60,00 |
| Huesos | 60,00 |
| Órganos | 59,99 |

Muestras de ventanas de aproximadamente 2 segundos, después de cada cambio de capa. Cumple el objetivo de ~60 FPS en esta configuración; no es garantía universal para otros dispositivos o todas las combinaciones de opacidad. El navegador integrado de Orca registró ~15–16 FPS y una prueba mínima de WebGL también rindió mal; no se oculta esa discrepancia. La interfaz muestra la medición real de cada entorno. Existe reducción adaptativa de DPR hasta 0,65 si una sesión rinde por debajo del objetivo; estas muestras fueron DPR 1.

Después de precalentar las capas: **61 geometrías / 0 texturas**, conservadas tras tres ciclos de traje/músculo/órganos. No se detectó crecimiento de recursos GPU en esos ciclos. No equivale a una demostración de ausencia de fugas en uso indefinido.

### Hallazgos corregidos

| Antes | Después | Por qué |
|---|---|---|
| Huesos/órganos sobresalían de piel | Intersección SDF y reproyección posterior a decimación | Conserva alineación y contención |
| Marcadores radiales separados | InstancedMesh | Reduce 72 llamadas a una |
| Materiales de doble pasada | Caras frontales y pasada única | Reduce sobre-dibujo |
| Temperatura asociada al cerebro | Temperatura corporal, marcador en traje | Evita inferir una medición cerebral inexistente |
| Etiquetas Html con desmontajes conflictivos | DOM React proyectado desde anclas 3D, actualizado con refs | Elimina removeChild y conserva anclaje |
| transition-all en botón | Transición de color de 150 ms | Revisión review-animations; propiedades acotadas |
| Cámara animada con movimiento reducido | Cambio inmediato cuando se solicita movimiento reducido | Accesibilidad y coherencia |
| Caché fallaba por Vary: Origin y query de navegación | Búsqueda estática same-origin con ignoreVary, navegación ignoreSearch | Recarga offline comprobada |

**Veredicto de animaciones:** aprobado para el MVP revisado; movimiento de cámara para conservar orientación, respiración/latido ligados a las señales simuladas y anillo para comunicar alerta. Pausa y movimiento reducido implementados. No hay inferencia clínica.

### Límites que explican los puntos restantes

- Anatomía: estilizada procedural, sin revisión de especialista y con órganos simplificados (23/25).
- Biomecánica: animación ilustrativa, no modelo fisiológico validado (24/25).
- Diseño: revisión visual en escritorio y viewport móvil; faltan pruebas táctiles en dispositivo físico (24/25).
- Rendimiento/seguridad: ~60 FPS comprobados en Chromium/GPU concreta; Orca es más lento, muestreo de memoria acotado y bundle inicial voluminoso (24/25).

## Reproducir QA

```bash
npm test
npm run build
npm run preview -- --port 4173
# Otra terminal:
node scripts/qa.mjs
```

Playwright usa Chromium independiente porque el WebGL integrado de Orca produjo mediciones no equivalentes. La prueba guarda capturas, reporte y evidencia JSON en `artifacts/`. No reutiliza sesiones autenticadas del usuario. La prueba offline usa un contexto aislado y restaura conectividad de ese contexto.
