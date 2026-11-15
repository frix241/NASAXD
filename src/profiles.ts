/**
 * Perfiles de AstroTwin: la misma interfaz con dos significados.
 *  - `space`:  misión espacial (el original).
 *  - `school`: día escolar, para colegios del Perú. Sin mediciones clínicas ni nombres reales.
 * Todo lo que cambia entre modos vive aquí; los componentes solo leen el perfil activo.
 */
import type { Destination } from './config/rules'
import { SCHOOL_TASKS, SPACE_TASKS, type Task, type TaskId } from './config/tasks'
import { SCHOOL_ZONES, SPACE_ZONES, type ActionId, type Zone, type ZoneMap } from './sim/issues'
import type { MetricKey, Reading, Scenario } from './sim/simulator'

export type ProfileId = 'space' | 'school'
export type PanelId = 'sleep' | 'body' | 'exercise' | 'water' | 'heart' | 'rad' | 'labs' | 'change'
export type SceneKind = 'boot' | 'monitor' | 'data' | 'route' | 'count' | 'summary'

export interface VitalRow {
  key: MetricKey
  label: string
  unit: string
  viz: 'ecg' | 'art' | 'pleth' | 'resp' | 'gauge' | 'spark' | 'none'
  wide?: boolean // número largo (p. ej. 120/80)
  gauge?: { max: number; ticks: number[] }
  spark?: { min: number; max: number }
}
interface StoryStep { at: number; say?: string | null; scenario?: Scenario; act?: [ActionId, MetricKey]; scene?: number; task?: TaskId; nextDay?: boolean }

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
  palette: { ice: string; line: string; lineSoft: string }
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

const SCHOOL: Profile = {
  id: 'school',
  switchLabel: 'Colegio',
  hero: { starting: 'Iniciando AstroTwin Colegio…', ready: 'AstroTwin Colegio listo', checks: ['Tu aula', 'Clima de tu región', 'Sin nombres ni cuentas'] },
  scenes: ['Arranque', 'Aula', 'Conteo rápido', 'Día escolar', 'Resumen de la semana'],
  sceneKinds: ['boot', 'monitor', 'count', 'route', 'summary'],
  hiddenZones: ['heart', 'kidneys'],
  alertsAutoClose: false,
  alertWord: { bad: 'Acción del día', warn: 'Acción del día' },
  palette: { ice: '#6fd3c8', line: 'rgba(111, 211, 200, 0.32)', lineSoft: 'rgba(111, 211, 200, 0.15)' },
  text: {
    day: 'Día escolar', clock: 'Hora', dest: 'Región', alias: null,
    routeTitle: 'El día escolar del aula', routeAllDone: 'Día completo. ¡Buen trabajo!', routeHint: 'Cada momento cuida algo del grupo.',
    dataTitle: 'Resumen de la semana', twinLabel: 'Gemelo del aula en 3D',
    privacy: 'Los datos no salen de este dispositivo.',
    demoNote: 'Tecla D para cerrar. Los cambios son simulados.', restart: 'Reiniciar',
  },
  destinations: ['costa', 'sierra', 'selva'],
  defaultDest: 'costa',
  zones: SCHOOL_ZONES,
  zoneOrder: ['head', 'muscles', 'body', 'bones'],
  chip: (z, r) => ({
    head: `${r.sleep.value} % con sueño`, muscles: r.exercise.value ? 'con recreo activo' : 'sin recreo activo',
    body: r.radiation.text.toLowerCase(), bones: r.backpack.text === 'Sin dato' ? 'sin registrar' : `${r.backpack.value} %`,
    heart: '', kidneys: '',
  })[z],
  vitals: [
    { key: 'sleep', label: 'Sueño', unit: '', viz: 'gauge', gauge: { max: 100, ticks: [20, 40] } },
    { key: 'breakfast', label: 'Desayuno', unit: '', viz: 'gauge', gauge: { max: 100, ticks: [20, 40] } },
    { key: 'mood', label: 'Ánimo', unit: '', viz: 'gauge', gauge: { max: 100, ticks: [20, 40] } },
    { key: 'radiation', label: 'Clima del día', unit: '', viz: 'none', wide: true },
    { key: 'exercise', label: 'Recreo activo', unit: '', viz: 'none' },
  ],
  panels: [],
  tasks: SCHOOL_TASKS,
  events: [['sleepy', 'Mucho sueño hoy'], ['heat', 'Ola de calor'], ['cold', 'Friaje'], ['hardWeek', 'Tres días en rojo']],
  story: [
    { at: 0, scene: 1, say: 'Modo historia. Un día normal en el aula: todo en verde.' },
    { at: 4000, scenario: 'sleepy', say: 'En el conteo de hoy, casi la mitad durmió poco. Aparece la acción del día.' },
    { at: 10500, act: ['ack', 'sleep'], say: 'El tutor hace la pausa activa y la marca como hecha.' },
    { at: 14000, scenario: 'heat', say: 'Llega una ola de calor. El aula-gemelo cambia de color.' },
    { at: 20500, act: ['ack', 'radiation'], say: 'Ventanas abiertas, agua cada hora y recreo a la sombra.' },
    { at: 25000, scene: 3, say: 'El día escolar: seis momentos que guía el tutor.' },
    { at: 28500, task: 'breakfast' }, { at: 31000, task: 'entry' },
    { at: 33500, task: 'recess', say: 'Tres momentos hechos: la racha sube un día.' },
    { at: 36000, scene: 4, say: 'El resumen de la semana, listo para imprimir.' },
    { at: 40000, say: 'Fin del modo historia.' }, { at: 43000, say: null },
  ],
  assistant: {
    samples: ['¿Qué está pasando?', '¿Qué hago hoy?', '¿Qué hago hoy?', '¿Qué toca ahora?', '¿Cómo va la semana?'],
    suggestions: [
      ['¿Qué está pasando?'],
      ['¿Qué hago hoy?', '¿Cómo está el aula?', '¿Hay mucho sueño?'],
      ['¿Qué hago hoy?', '¿Cómo está el aula?', '¿Cómo va la semana?'],
      ['¿Qué toca ahora?', '¿Qué hago hoy?', '¿Cuántos puntos tenemos?'],
      ['¿Cómo va la semana?', '¿Qué hago hoy?', '¿Cómo está el aula?'],
    ],
  },
}

export const PROFILES: Record<ProfileId, Profile> = { space: SPACE, school: SCHOOL }
