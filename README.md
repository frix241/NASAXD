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

## Perfil Comunidad rural: heladas y friaje
El mismo motor de reglas explicables, para un agente comunitario de salud o técnico de posta en el Perú: sin internet, sin formación médica avanzada y con pocos o ningún sensor. **Es apoyo a la decisión, nunca un diagnóstico.**
- Interruptor arriba "Misión espacial | Comunidad rural", tecla **C**, o abrir con `?modo=comunidad`. El perfil vive solo en memoria.
- **Evaluar:** quién es (niño menor de 5, adulto mayor, adulto, con alias), 7 señales de alarma con pictogramas, observación, cronómetro de 60 s para contar respiraciones, frío del entorno, altitud y distancia a la posta. Termómetro y pulsioxímetro son opcionales.
- **Semáforo:** "Atiendo yo", "Vigilo y vuelvo a revisar" o "Derivo a la posta", con la razón, dos acciones y el nivel de confianza. Con pocos datos deriva antes; con una señal de alarma siempre deriva.
- **Hoja de derivación** imprimible y versión de 5 líneas para dictar por radio o teléfono.
- **Clima y riesgo:** 48 horas de temperatura y el botón "Simular helada".
- Tema "Luz del día" (alto contraste, para leer al sol) y tema "Noche". Estructura lista para Quechua, sin traducciones inventadas.
- Umbrales en `src/config/communityRules.ts`: **valores de ejemplo, validar con normas MINSA (AIEPI) antes de uso real.**

## Asistente con modelo (opcional)
El asistente siempre responde con reglas, así funciona sin internet. En **los dos perfiles**, si hay red y una clave de Groq, un modelo redacta la respuesta a partir de esas reglas y de los datos; si falla o tarda más de 9 s, se usa la de reglas.
- Copia `.env.example` como `.env.local` y pon `GROQ_API_KEY=...` (opcional `GROQ_MODEL=`; por defecto `openai/gpt-oss-120b`). `.env.local` no se sube al repositorio.
- La clave **no llega al navegador**: `npm run dev` y `npm run preview` la añaden en el servidor al reenviar `/api/groq` (ver `vite.config.ts`). Si abres `dist/` como archivos estáticos sin ese servidor, el asistente usa solo las reglas.
- En **comunidad rural** la decisión (atiendo, vigilo o derivo) la toman siempre las reglas locales. Al modelo se le envía la visita sin alias ni nombres y no puede cambiar la decisión.
- **Micrófono:** los navegadores solo lo permiten en `https` o en `localhost`. Para abrir la app desde otro equipo de la red con micrófono: `DEV_HTTPS=1 npx vite --port 5174 --host 0.0.0.0` y entrar por `https://<ip>:5174/` (hay que aceptar el aviso del certificado propio). La voz se convierte en texto con Whisper a través de `/api/groq-stt`.
- En pruebas automáticas se usan solo las reglas, para que sean repetibles y no gasten la clave.

## Publicar en Vercel

1. Importa `frix241/NASAXD` desde GitHub y selecciona la rama `master` (o la rama con este cambio).
2. Usa la raíz del repositorio. `vercel.json` configura Vite, `npm run build` y la salida `dist`.
3. En **Settings → Environment Variables**, agrega `GROQ_API_KEY` con tu clave de [Groq](https://console.groq.com/keys) para Production y Preview. Opcional: `GROQ_MODEL` (por defecto `openai/gpt-oss-120b`).
4. Despliega. Si agregas o cambias las variables después, haz **Redeploy**: la disponibilidad del modelo se determina también durante la compilación.

Las funciones `api/groq.mjs` y `api/groq-stt.mjs` conectan el chat y Whisper con Groq en Vercel. La clave permanece en el servidor: no uses el prefijo `VITE_`. Sin clave, sin red o si falla Groq, el chat mantiene las respuestas por reglas. El micrófono requiere HTTPS y permiso del navegador.

Pruebas del servidor sin consumir la API: `node --test server/groq-proxy.node.mjs`.

## Dónde está cada cosa
| Qué | Archivo |
|---|---|
| Umbrales verde / ámbar / rojo y conexiones | `src/config/rules.ts` |
| Tareas de la ruta y puntos | `src/config/tasks.ts` |
| Simulador (1 paso = 1 minuto de la nave, 1 paso por segundo) | `src/sim/simulator.ts` |
| Textos y acciones de las alertas | `src/sim/issues.ts` |
| Asistente: `askAssistant(texto, contexto)` | `src/assistant/askAssistant.ts` |
| Lector del CSV de Inspiration4 | `src/data/inspiration4.ts` |
| Perfiles (misión espacial y comunidad rural) | `src/profiles.ts` |
| Motor de reglas de la comunidad | `src/sim/community.ts` y `src/config/communityRules.ts` |
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
en 1440 px y 420 px con la red externa bloqueada; `node scripts/e2e-comunidad.mjs` hace lo mismo con el perfil comunidad (escenario de helada, hoja de derivación, contraste y tamaños). `node scripts/shot.mjs <nombre>` toma capturas (con `npm run dev`).

La app no diagnostica: sugiere acciones y cuándo avisar a la Tierra.
