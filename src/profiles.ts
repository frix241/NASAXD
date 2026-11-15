/**
 * Perfiles de AstroTwin: la misma interfaz con dos significados.
 *  - `space`:  misión espacial (el original).
 *  - `community`: comunidad rural (heladas y friaje). Apoyo a la decisión sin sensores; nunca un diagnóstico.
 * Todo lo que cambia entre modos vive aquí; los componentes solo leen el perfil activo.
 */
import type { Destination } from './config/rules'
import { SPACE_TASKS, type Task, type TaskId } from './config/tasks'
import { SPACE_ZONES, type ActionId, type Zone, type ZoneMap } from './sim/issues'
import type { MetricKey, Reading, Scenario } from './sim/simulator'

export type ProfileId = 'space' | 'community'
export type PanelId = 'sleep' | 'body' | 'exercise' | 'water' | 'heart' | 'rad' | 'labs' | 'change'
export type SceneKind = 'boot' | 'monitor' | 'data' | 'route' | 'person' | 'evaluate' | 'referral' | 'climate'

export interface VitalRow {
  key: MetricKey
  label: string
  unit: string
  viz: 'ecg' | 'art' | 'pleth' | 'resp' | 'gauge' | 'spark' | 'none'
  wide?: boolean // número largo (p. ej. 120/80)
  gauge?: { max: number; ticks: number[] }
  spark?: { min: number; max: number }
}
interface StoryStep { at: number; say?: string | null; scenario?: Scenario; act?: [ActionId, MetricKey]; scene?: number; task?: TaskId }

export interface Profile {
  id: ProfileId
  switchLabel: string
  hero: { starting: string; ready: string; checks: string[] }
  scenes: string[]
  sceneKinds: SceneKind[]
  /** Zonas del gemelo que no se dibujan (en el colegio: las clínicas). */
  hiddenZones: Zone[]
  /** Las alertas ámbar se cierran solas (misión) o se quedan como acción del día (colegio). */
  alertsAutoClose: boolean
  alertWord: { bad: string; warn: string }
  palette: { ice: string; line: string; lineSoft: string } | null
  text: {
    day: string; clock: string; dest: string; alias: string | null
    routeTitle: string; routeAllDone: string; routeHint: string
    dataTitle: string; twinLabel: string; privacy: string | null
    demoNote: string; restart: string
  }
  destinations: Destination[]
  defaultDest: Destination
  zones: ZoneMap
  zoneOrder: Zone[]
  chip: (zone: Zone, r: Record<MetricKey, Reading>) => string
  vitals: VitalRow[]
  panels: PanelId[]
  tasks: Task[]
  events: [Scenario, string][]
  story: StoryStep[]
  assistant: { samples: string[]; suggestions: string[][] }
}

const SPACE: Profile = {
  id: 'space',
  switchLabel: 'Misión espacial',
  hero: { starting: 'Iniciando AstroTwin…', ready: 'AstroTwin listo', checks: ['Sensores del traje', 'Enlace con la nave', 'Tu perfil'] },
  scenes: ['Arranque', 'Monitor', 'Datos completos', 'Ruta diaria'],
  sceneKinds: ['boot', 'monitor', 'data', 'route'],
  hiddenZones: [],
  alertsAutoClose: true,
  alertWord: { bad: 'Atender ahora', warn: 'Para vigilar' },
  palette: { ice: '#6db3ff', line: 'rgba(109, 179, 255, 0.3)', lineSoft: 'rgba(109, 179, 255, 0.14)' },
  text: {
    day: 'Día de misión', clock: 'Hora de la nave', dest: 'Destino', alias: null,
    routeTitle: 'Tu ruta de hoy', routeAllDone: 'Ruta completa. Buen trabajo.', routeHint: 'Cada una cuida una parte de tu cuerpo.',
    dataTitle: 'Datos completos', twinLabel: 'Gemelo digital en 3D', privacy: null,
    demoNote: 'Tecla D para cerrar. Los cambios son simulados.', restart: 'Reiniciar',
  },
  destinations: ['leo', 'luna', 'marte'],
  defaultDest: 'luna',
  zones: SPACE_ZONES,
  zoneOrder: ['heart', 'kidneys', 'bones', 'head', 'muscles', 'body'],
  chip: (z, r) => ({
    heart: `${r.pulse.text} lpm`, kidneys: `${r.hydration.text} %`, bones: `${r.exercise.text} %`,
    head: `${r.sleep.text} h`, muscles: `${r.exercise.text} %`,
    body: r.temp.status !== 'ok' ? `${r.temp.text} °C` : `${r.radiation.text}×`,
  })[z],
  vitals: [
    { key: 'pulse', label: 'Pulso', unit: 'lpm', viz: 'ecg' },
    { key: 'bp', label: 'Presión arterial', unit: 'mmHg', viz: 'art', wide: true },
    { key: 'spo2', label: 'Oxígeno en sangre', unit: '%', viz: 'pleth' },
    { key: 'hydration', label: 'Hidratación', unit: '% de agua', viz: 'gauge', gauge: { max: 100, ticks: [45, 70] } },
    { key: 'temp', label: 'Temperatura', unit: '°C', viz: 'spark', spark: { min: 35.5, max: 39 } },
    { key: 'resp', label: 'Respiración', unit: 'rpm', viz: 'resp' },
    { key: 'glucose', label: 'Glucosa', unit: 'mg/dL', viz: 'gauge', gauge: { max: 200, ticks: [70, 100, 126] } },
  ],
  panels: ['sleep', 'body', 'labs', 'exercise', 'water', 'heart', 'rad', 'change'],
  tasks: SPACE_TASKS,
  events: [['storm', 'Tormenta solar'], ['badNight', 'Mala noche'], ['lowWater', 'Poca agua'], ['highBP', 'Presión alta'], ['fever', 'Fiebre']],
  story: [
    { at: 0, scene: 1, say: 'Modo historia. Un día normal: todo en verde.' },
    { at: 4000, scenario: 'badNight', say: 'Mala noche: dormiste 4,8 horas. Aparece una alerta en el centro.' },
    { at: 10500, act: ['rest', 'sleep'], say: 'Confirmas la alerta y programas una siesta.' },
    { at: 14000, scenario: 'storm', say: 'Llega una tormenta solar. La radiación sube.' },
    { at: 20500, act: ['shelter', 'radiation'], say: 'Vas al refugio. La radiación vuelve a verde.' },
    { at: 25000, scene: 3, say: 'Tu ruta diaria. Cada tarea cuida una parte del cuerpo.' },
    { at: 28500, task: 'water' }, { at: 31000, task: 'rest' },
    { at: 33500, task: 'mood', say: 'Tres tareas hechas: la racha sube un día.' },
    { at: 38000, say: 'Fin del modo historia.' }, { at: 41500, say: null },
  ],
  assistant: {
    samples: ['¿Qué está pasando?', '¿Cómo estoy?', '¿Qué dicen mis datos?', '¿Qué me toca ahora?'],
    suggestions: [
      ['¿Qué está pasando?'],
      ['¿Cómo estoy?', '¿Cómo va mi agua?', '¿Hay radiación?'],
      ['¿Qué dicen mis datos?', '¿Cómo dormí?', '¿Cómo va mi ejercicio?'],
      ['¿Qué me toca ahora?', '¿Cuántos puntos tengo?', '¿Cómo estoy?'],
    ],
  },
}

/** Comunidad rural: heladas y friaje. Mismo motor de reglas explicables, otro contexto y otro tema. */
const COMMUNITY: Profile = {
  id: 'community',
  switchLabel: 'Comunidad rural',
  hero: { starting: 'Iniciando AstroTwin Comunidad…', ready: 'AstroTwin Comunidad listo', checks: ['Reglas cargadas en este equipo', 'Funciona sin internet', 'Sin nombres ni cuentas'] },
  scenes: ['Arranque', 'Persona', 'Evaluar', 'Hoja de derivación', 'Clima y riesgo'],
  sceneKinds: ['boot', 'person', 'evaluate', 'referral', 'climate'],
  hiddenZones: [],
  alertsAutoClose: true,
  alertWord: { bad: 'Derivo a la posta', warn: 'Vigilo y vuelvo a revisar' },
  palette: null, // los colores los pone el tema (Luz del día o Noche)
  text: {
    day: '', clock: 'Hora', dest: 'Región', alias: null,
    routeTitle: '', routeAllDone: '', routeHint: '',
    dataTitle: '', twinLabel: 'Gemelo de la persona atendida',
    privacy: 'Sin nombres ni cuentas. La evaluación se hace en este dispositivo; solo el asistente usa internet, si lo hay.',
    demoNote: 'Tecla D para cerrar. Datos de demostración.', restart: 'Nueva persona',
  },
  destinations: ['sierraAlta', 'sierraMedia', 'selvaFriaje'],
  defaultDest: 'sierraAlta',
  zones: SPACE_ZONES,
  zoneOrder: [],
  chip: () => '',
  vitals: [],
  panels: [],
  tasks: [],
  events: [['frost', 'Simular helada'], ['alarm', 'Marcar una señal de alarma']],
  story: [
    { at: 0, scene: 1, scenario: 'calm', say: 'Modo historia. Una visita tranquila: sin señales, atiende la agente comunitaria.' },
    { at: 4500, scenario: 'frost', say: 'Madrugada con helada. En un niño menor de 5 el semáforo pasa a "Vigilo".' },
    { at: 11000, scene: 4, say: 'La temperatura cae por la noche y el riesgo sube.' },
    { at: 16500, scene: 1, scenario: 'alarm', say: 'Aparece una señal de alarma: le cuesta respirar. Ahora es "Derivo".' },
    { at: 23000, scene: 3, say: 'La hoja de derivación ya está lista, con el texto para dictar por radio.' },
    { at: 30000, say: 'Fin del modo historia.' }, { at: 33000, say: null },
  ],
  assistant: {
    samples: ['¿Qué está pasando?', '¿Qué hago?', '¿Qué hago?', '¿Qué digo por radio?', '¿Hay helada?'],
    suggestions: [
      ['¿Qué está pasando?'],
      ['¿Qué hago?', '¿Por qué?', '¿Qué tan segura estás?'],
      ['¿Qué hago?', '¿Cómo cuento la respiración?', '¿Qué me falta preguntar?'],
      ['¿Qué digo por radio?', '¿Qué hago en el camino?', '¿Qué hago?'],
      ['¿Hay helada?', '¿Qué hago?', '¿Cómo abrigo la vivienda?'],
    ],
  },
}

export const PROFILES: Record<ProfileId, Profile> = { space: SPACE, community: COMMUNITY }
