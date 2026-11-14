# AstroTwin

Copiloto de salud para astronautas, visto desde dentro del casco. NASA Space Apps 2026.

```
npm install
npm run dev      # desarrollo
npm test         # pruebas del simulador, las reglas y el lector del CSV
npm run build    # build en dist/ (funciona sin internet)
npm run preview
```

## Cómo se usa
- Rueda, flechas o deslizar: cambia de escena (Arranque, Monitor, Datos completos, Ruta diaria).
- Tecla **D**: panel de demostración (tormenta solar, mala noche, poca agua, presión alta, fiebre, reiniciar, modo historia).
- Botón de micrófono: asistente. Escucha si el navegador reconoce voz (Chrome/Edge, con internet); si no, usa una pregunta de ejemplo. El botón de teclado abre el chat para escribir. Responde con reglas y la voz del sistema.

## Dónde está cada cosa
| Qué | Archivo |
|---|---|
| Umbrales verde / ámbar / rojo y conexiones | `src/config/rules.ts` |
| Tareas de la ruta y puntos | `src/config/tasks.ts` |
| Simulador (1 paso = 1 minuto de la nave, 1 paso por segundo) | `src/sim/simulator.ts` |
| Textos y acciones de las alertas | `src/sim/issues.ts` |
| Asistente: `askAssistant(texto, contexto)` | `src/assistant/askAssistant.ts` |
| Lector del CSV de Inspiration4 | `src/data/inspiration4.ts` |
| Planetas, gemelo 3D | `src/three/` |

## Datos
- `data/inspiration4_laboratorios_tidy.csv` es por ahora un **archivo de ejemplo** generado con
  `node scripts/gen-sample-csv.mjs`. Columnas: `tripulante, medida, unidad, momento, valor, calidad, fuente`.
  Al reemplazarlo por el real (sin la columna `fuente = simulado`) desaparece el aviso "Datos de ejemplo".
  Solo se usan filas con calidad `ok`; lo que falta se muestra como "sin dato".
- Planetas con imágenes reales de dominio público, guardadas en `public/textures/` (la app no las pide a internet):
  Tierra de día (Blue Marble, NASA Earth Observatory), Tierra de noche (Black Marble 2016), Luna (mosaico de LRO, NASA SVS)
  y Marte (Viking MDIM 2.1, USGS/NASA). `scripts/fetch-textures.sh` las vuelve a descargar. Si faltan, se usan shaders procedurales.

## Pruebas visuales
Con `npm run preview` abierto: `node scripts/e2e.mjs` recorre navegación, asistente y modo historia
en 1440 px y 420 px con la red externa bloqueada. `node scripts/shot.mjs <nombre>` toma capturas (con `npm run dev`).

La app no diagnostica: sugiere acciones y cuándo avisar a la Tierra.
