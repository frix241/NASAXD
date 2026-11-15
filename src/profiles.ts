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
  switchLabel: 'Space mission',
  hero: { starting: 'Starting AstroTwin…', ready: 'AstroTwin ready', checks: ['Suit sensors', 'Spacecraft link', 'Your profile'] },
  scenes: ['Launch', 'Monitor', 'Full data', 'Daily plan'],
  sceneKinds: ['boot', 'monitor', 'data', 'route'],
  hiddenZones: [],
  alertsAutoClose: true,
  alertWord: { bad: 'Act now', warn: 'Keep an eye on' },
  palette: { ice: '#6db3ff', line: 'rgba(109, 179, 255, 0.3)', lineSoft: 'rgba(109, 179, 255, 0.14)' },
  text: {
    day: 'Mission day', clock: 'Spacecraft time', dest: 'Destination', alias: null,
    routeTitle: 'Your plan for today', routeAllDone: 'Plan complete. Great work.', routeHint: 'Each task cares for a part of your body.',
    dataTitle: 'Full data', twinLabel: '3D digital twin', privacy: null,
    demoNote: 'Press D to close. Changes are simulated.', restart: 'Restart',
  },
  destinations: ['leo', 'luna', 'marte'],
  defaultDest: 'luna',
  zones: SPACE_ZONES,
  zoneOrder: ['heart', 'kidneys', 'bones', 'head', 'muscles', 'body'],
  chip: (z, r) => ({
    heart: `${r.pulse.text} bpm`, kidneys: `${r.hydration.text}%`, bones: `${r.exercise.text}%`,
    head: `${r.sleep.text} h`, muscles: `${r.exercise.text}%`,
    body: r.temp.status !== 'ok' ? `${r.temp.text} °C` : `${r.radiation.text}×`,
  })[z],
  vitals: [
    { key: 'pulse', label: 'Heart rate', unit: 'bpm', viz: 'ecg' },
    { key: 'bp', label: 'Blood pressure', unit: 'mmHg', viz: 'art', wide: true },
    { key: 'spo2', label: 'Blood oxygen', unit: '%', viz: 'pleth' },
    { key: 'hydration', label: 'Hydration', unit: '% water', viz: 'gauge', gauge: { max: 100, ticks: [45, 70] } },
    { key: 'temp', label: 'Temperature', unit: '°C', viz: 'spark', spark: { min: 35.5, max: 39 } },
    { key: 'resp', label: 'Breathing', unit: 'breaths/min', viz: 'resp' },
    { key: 'glucose', label: 'Glucose', unit: 'mg/dL', viz: 'gauge', gauge: { max: 200, ticks: [70, 100, 126] } },
  ],
  panels: ['sleep', 'body', 'labs', 'exercise', 'water', 'heart', 'rad', 'change'],
  tasks: SPACE_TASKS,
  events: [['storm', 'Solar storm'], ['badNight', 'Poor sleep'], ['lowWater', 'Low hydration'], ['highBP', 'High blood pressure'], ['fever', 'Fever']],
  story: [
    { at: 0, scene: 1, say: 'Story mode. A normal day: everything is green.' },
    { at: 4000, scenario: 'badNight', say: 'Poor sleep: you slept 4.8 hours. An alert appears in the center.' },
    { at: 10500, act: ['rest', 'sleep'], say: 'You acknowledge the alert and schedule a nap.' },
    { at: 14000, scenario: 'storm', say: 'A solar storm arrives. Radiation levels rise.' },
    { at: 20500, act: ['shelter', 'radiation'], say: 'You go to the shelter. Radiation returns to green.' },
    { at: 25000, scene: 3, say: 'Your daily plan. Each task cares for a part of your body.' },
    { at: 28500, task: 'water' }, { at: 31000, task: 'rest' },
    { at: 33500, task: 'mood', say: 'Three tasks complete: your streak increases by one day.' },
    { at: 38000, say: 'End of story mode.' }, { at: 41500, say: null },
  ],
  assistant: {
    samples: ["What's happening?", 'How am I doing?', 'What do my readings say?', 'What should I do next?'],
    suggestions: [
      ["What's happening?"],
      ['How am I doing?', 'How is my hydration?', 'Is there radiation?'],
      ['What do my readings say?', 'How did I sleep?', 'How is my exercise going?'],
      ['What should I do next?', 'How many points do I have?', 'How am I doing?'],
    ],
  },
}

/** Comunidad rural: heladas y friaje. Mismo motor de reglas explicables, otro contexto y otro tema. */
const COMMUNITY: Profile = {
  id: 'community',
  switchLabel: 'Rural community',
  hero: { starting: 'Starting AstroTwin Community…', ready: 'AstroTwin Community ready', checks: ['Rules loaded on this device', 'Works offline', 'No names or accounts'] },
  scenes: ['Launch', 'Person', 'Assessment', 'Referral form', 'Weather and risk'],
  sceneKinds: ['boot', 'person', 'evaluate', 'referral', 'climate'],
  hiddenZones: [],
  alertsAutoClose: true,
  alertWord: { bad: 'Refer to the health post', warn: 'Monitor and check again' },
  palette: null, // los colores los pone el tema (Luz del día o Noche)
  text: {
    day: '', clock: 'Time', dest: 'Region', alias: null,
    routeTitle: '', routeAllDone: '', routeHint: '',
    dataTitle: '', twinLabel: 'Digital twin of the person being assessed',
    privacy: 'No names or accounts. The assessment stays on this device; only the assistant uses the internet, if available.',
    demoNote: 'Press D to close. Demonstration data.', restart: 'New person',
  },
  destinations: ['sierraAlta', 'sierraMedia', 'selvaFriaje'],
  defaultDest: 'sierraAlta',
  zones: SPACE_ZONES,
  zoneOrder: [],
  chip: () => '',
  vitals: [],
  panels: [],
  tasks: [],
  events: [['frost', 'Simulate frost'], ['alarm', 'Mark a warning sign']],
  story: [
    { at: 0, scene: 1, scenario: 'calm', say: 'Story mode. A calm visit: no warning signs, so the community health worker provides care.' },
    { at: 4500, scenario: 'frost', say: 'A frosty early morning. For a child under 5, the status changes to "Monitor".' },
    { at: 11000, scene: 4, say: 'The temperature drops overnight and the risk rises.' },
    { at: 16500, scene: 1, scenario: 'alarm', say: 'A warning sign appears: the person is having trouble breathing. Now the status is "Refer".' },
    { at: 23000, scene: 3, say: 'The referral form is ready, with text to read over the radio.' },
    { at: 30000, say: 'End of story mode.' }, { at: 33000, say: null },
  ],
  assistant: {
    samples: ["What's happening?", 'What should I do?', 'What should I do?', 'What should I say over the radio?', 'Is frost expected?'],
    suggestions: [
      ["What's happening?"],
      ['What should I do?', 'Why?', 'How confident are you?'],
      ['What should I do?', 'How do I count breaths?', 'What else should I ask?'],
      ['What should I say over the radio?', 'What should I do on the way?', 'What should I do?'],
      ['Is frost expected?', 'What should I do?', 'How can I insulate the home?'],
    ],
  },
}

export const PROFILES: Record<ProfileId, Profile> = { space: SPACE, community: COMMUNITY }
