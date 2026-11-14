# Motor de simulación y biomecánica — Iteración 1

Propiedad: OpenCode. Código en `src/engine/**`, pruebas en los `*.test.ts` del
mismo directorio. No modifica `App.tsx`, la escena, `src/contracts.ts` ni la UI.

Todo el motor es puro y determinista: no usa `Math.random`, `Date.now`, timers
ni red. Una misma entrada produce siempre la misma salida. La telemetría está
marcada con `source: 'simulated'` y es ficción de demostración, no telemetría
real ni consejo médico.

## API pública (`src/engine/index.ts`)

```ts
getSimulationFrame(scenario: ScenarioId, elapsedSeconds: number): SimulationFrame
getBiomechanics(vitals: Vitals, elapsedSeconds: number): {breath: number; heartbeat: number; sway: number}
new DiagnosticEngineStub().evaluate(input: DiagnosticInput): Promise<DiagnosticResult>
```

Se reexportan además `SCENARIO_IDS`, `ALERT_THRESHOLDS`, `VITAL_RANGES`,
`MAX_ELAPSED_SECONDS`, `sanitizeElapsedSeconds`, `sanitizeVitals`,
`scenarioVitals`, `evaluateAlert`, `BIOMECHANICS`, `DiagnosticEngineError` y los
tipos del motor. Los tipos de contrato (`Vitals`, `SimulationFrame`,
`ScenarioId`, `OrganId`) siguen viviendo en `src/contracts.ts`.

### Unidades

| Señal | Unidad | Origen |
| --- | --- | --- |
| `bpm` | latidos/min | simulado |
| `spo2` | % | simulado |
| `systolic`, `diastolic` | mmHg | simulado |
| `temperature` | °C | simulado |
| `respiratoryRate` | respiraciones/min | simulado |
| `radiation` | µSv/h | exposición ambiental ficticia, **no** dosis personal |

## Escenarios

Cada escenario interpola con `smoothstep` entre una línea base y una crisis
durante `onsetSeconds`, y añade una oscilación determinista pequeña. La tabla
muestra los objetivos en crisis (valores redondeados); la oscilación nunca
cambia el órgano alertado.

| Escenario | onset | BPM | SpO₂ % | Sistólica/diastólica | Temp °C | FR /min | Radiación µSv/h |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `nominal` | — | 72 | 98 | 118/76 | 36.7 | 14 | 0.12 |
| `cardiac` | 5 s | 132 | 95.5 | 150/98 | 37.0 | 18 | 0.12 |
| `respiratory` | 4 s | 98 | 88.5 | 126/82 | 36.8 | 28 | 0.12 |
| `thermal` | 6 s | 108 | 96 | 130/86 | 39.0 | 20 | 0.12 |
| `radiation` | 3 s | 80 | 97 | 120/78 | 36.8 | 15 | 48 |

`nominal` es estable y nunca genera alerta. Los demás escenarios empiezan sin
alerta y cruzan su umbral durante la rampa (antes de ~10 s).

## Umbrales de demo y mapeo de órganos

Umbrales explícitos en `ALERT_THRESHOLDS`. **No están validados clínicamente**;
solo gobiernan la demo visual.

| Órgano | Condición de alerta | Copy |
| --- | --- | --- |
| `heart` | BPM ≥ 120 **o** sistólica ≥ 145 **o** diastólica ≥ 95 | «Ritmo cardiaco elevado (simulado)» |
| `lungs` | SpO₂ ≤ 91 **o** FR ≥ 24 | «Oxigenación baja (simulada)» |
| `suit` (zona corporal/traje) | temperatura corporal ≥ 38.5 °C | «Temperatura corporal elevada (simulada)» |
| `suit` | radiación ambiental ≥ 20 µSv/h | «Radiación ambiental elevada (simulada)» |

La temperatura es una lectura corporal interna simulada: no mide el cerebro y
la alerta **no infiere lesión cerebral**. Por eso se asigna a la zona
corporal/traje (`suit`), no a `brain`, y su texto lo declara explícitamente.

Prioridad si varias condiciones se cumplen a la vez:
**heart → lungs → thermal (suit) → radiation (suit)**. La alerta incluye
`organ`, título, mensaje y recomendación de demo; siempre declara que es
simulación y que no es un diagnóstico. Al volver a `nominal`, la alerta desaparece porque se recalcula
desde las señales, no desde un estado guardado.

## Biomecánica para R3F

`getBiomechanics` usa solo `bpm` y `respiratoryRate` (sanea el resto) y
devuelve tres factores documentados:

| Factor | Rango | Significado |
| --- | --- | --- |
| `breath` | `1 ± 0.012` | escala de expansión torácica; seno a `respiratoryRate / 60` Hz |
| `heartbeat` | `1 … 1.02` | escala cardiaca; pico sistólico + rebote dicrótico a `bpm / 60` Hz, máx. +2 % |
| `sway` | `|sway| ≤ 0.0065 m` | desplazamiento postural lateral en metros; 0.05 Hz + 0.031 Hz, amplitud muy baja |

Las constantes están en `BIOMECHANICS` y documentadas en el código. La escena
puede multiplicar la escala del pecho por `breath`, la del corazón por
`heartbeat` y aplicar `sway` como traslación lateral en metros. No se debe usar
`heartbeat` como deformación grande.

## Robustez temporal y de valores

- `elapsedSeconds < 0` o no finito (NaN, ±Infinity) se trata como `0`, de modo
  que un reset reproduce exactamente el estado inicial.
- Tiempo muy grande se limita a `MAX_ELAPSED_SECONDS` (10 000 000 s) para
  mantener fases estables y finitas.
- `scenario` desconocido cae a `nominal`.
- `getBiomechanics` sanea `Vitals`: valores no finitos usan el valor por defecto
  de demo (BPM 72, FR 14) y el resto se limita a `VITAL_RANGES`.
- `getSimulationFrame` siempre devuelve valores finitos y redondeados (BPM,
  SpO₂, presiones y FR a 1 decimal; temperatura y radiación a 2).
- Ninguna función muta sus entradas y cada llamada devuelve objetos nuevos.

## DiagnosticEngineStub

`evaluate` es `async`, no realiza red y **no hay ningún LLM clínico ni modelo
diagnóstico conectado**. Devuelve siempre `status: 'unavailable'` y
`clinicalModel: 'none'`, con las observaciones normalizadas sin interpretarlas,
limitaciones y aviso de que es un prototipo educativo. No genera patologías ni
recomendaciones personalizadas.

### Entrada simulada (estado actual)

```ts
{source: 'simulated', scenario: ScenarioId, elapsedSeconds: number, vitals: Vitals}
```

### Entrada externa reservada (integración real futura)

El contrato futuro está separado del estado simulado y todavía no se consume:

```ts
{
  source: 'external';
  subjectRef: string;
  observations: Array<{label: string; value: number; unit: string; timestampIso?: string}>;
  clinicalNote?: string;
}
```

### Errores tipados

`DiagnosticEngineError` (`code`, `message`, `details`):

- `INVALID_INPUT`: forma inválida, escenario desconocido, observaciones vacías…
- `UNSUPPORTED_SOURCE`: `source` distinto de `simulated`/`external`.
- `NON_FINITE_VALUE`: cualquier vital, tiempo u observación no finita.

Salida:

```ts
{
  status: 'unavailable';
  source: 'simulated' | 'external';
  clinicalModel: 'none';
  summary: string;           // explica que no hay modelo clínico conectado
  observations: DiagnosticObservation[];
  limitations: string[];
  disclaimer: string;
}
```

## Límites declarados

- Demostración educativa; no es dispositivo médico ni diagnóstico.
- Umbrales y rangos son de demo, no intervalos clínicos.
- La radiación es exposición ambiental ficticia en µSv/h; no es dosis personal.
- No se atribuye ninguna validación a NASA ni a terceros.
- El copiloto clínico por IA es una integración futura, no implementada aquí.

## Pruebas

```sh
npx vitest run src/engine
```

Cubren escenarios y unidades, determinismo (incluido que no se llaman
`Math.random`/`Date.now`), zonas de alerta y limpieza, tiempo negativo/no
finito, valores no finitos, no mutación de entradas congeladas, escala y
sincronía biomecánica y el stub de diagnóstico (async, sin red, errores
tipados). Resultado de la última ejecución: **3 archivos, 36 pruebas, todas
en verde** (Vitest 3.2.7, Node 22, 2026-11-14).
