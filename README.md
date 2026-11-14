# AstroTwin 3D

MVP experimental de gemelo digital espacial. React + TypeScript + Vite, React Three Fiber, Drei, Three.js y controles oficiales shadcn/Radix. Todas las señales son simuladas. No es un dispositivo médico.

## Ejecutar

```bash
cd /home/bunuelo/astrotwin-3d
npm install
npm run dev
```

Abrir la URL local mostrada por Vite. `npm run build` compila; `npm run preview` sirve la versión compilada; `npm test` ejecuta pruebas del motor.

## Uso previsto

Arrastrar para rotar y usar rueda/pellizco para zoom. Ajustar opacidad de cada capa. Cambiar entre vista frontal/posterior o restablecer cámara. Seleccionar órgano. Activar escenario y esperar la rampa de 3–6 segundos; aparece alerta visual cuando cruza el umbral de demostración. Pausar/reanudar congela el tiempo de simulación. Preparar reporte descarga un JSON local, sin envío remoto. Preferencias de opacidad se guardan localmente.

Fuentes y modelo empaquetados localmente; geometría original procedural documentada en `docs/MODEL.md`. Requiere WebGL para el visor. La versión compilada instala caché offline después de la primera carga correcta. El stub clínico no realiza llamadas a IA ni produce diagnósticos.

## Resultado de QA

MVP revisado: **95/100** según la rúbrica del proyecto; 36 pruebas de motor y 18 comprobaciones del navegador aprobadas (14 de la suite integral y 4 regresiones de estado/offline). Cinco capas rindieron ~59–60 FPS en Chromium con Intel UHD y DPR 1. El navegador integrado de Orca rindió más lento; rendimiento dependiente del entorno. Informe completo, límites y criterios en `docs/QA.md`.

```bash
# Con el preview ejecutándose en 4173:
node scripts/qa.mjs
```

Capturas en `artifacts/`, evidencia en `artifacts/browser-qa.json` y escena editable en `public/models/astrotwin_human.blend`. Cualquier revisión visual puede iterarse sin usar servicios externos de generación.
