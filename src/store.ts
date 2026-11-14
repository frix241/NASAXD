import { create } from 'zustand'
import { ALERT_TASK_POINTS, TASKS, type TaskId } from './config/tasks'
import type { Destination, Status } from './config/rules'
import { findIssues, type ActionId, type Issue, type Zone } from './sim/issues'
import {
  applyScenario, createSim, doExercise, drinkWater, evaluate, goToShelter, moodCheck,
  notifyEarth, rest, setDestination, step, type MetricKey, type Reading, type Scenario,
  type SimState,
} from './sim/simulator'

export const SCENES = ['Arranque', 'Monitor', 'Datos completos', 'Ruta diaria'] as const

interface Store {
  scene: number
  bootDone: boolean
  sim: SimState
  readings: Record<MetricKey, Reading>
  issues: Issue[]
  dismissed: Partial<Record<MetricKey, Status>>
  acted: Partial<Record<MetricKey, Status>>
  highlight: Zone | null
  tasksDone: Partial<Record<TaskId, boolean>>
  points: number
  streak: number
  toast: string | null
  demoOpen: boolean
  storyCaption: string | null
  lowPerf: boolean
  visorUp: boolean
  fogKey: number
  webgl: boolean
  setScene: (n: number) => void
  finishBoot: () => void
  tick: () => void
  scenario: (sc: Scenario) => void
  setDest: (d: Destination) => void
  dismiss: (key: MetricKey) => void
  act: (action: ActionId, key?: MetricKey) => void
  completeTask: (id: TaskId) => void
  setHighlight: (z: Zone | null) => void
  say: (t: string | null) => void
  reset: () => void
  set: (p: Partial<Store>) => void
}

function derive(sim: SimState) {
  const readings = evaluate(sim)
  return { sim, readings, issues: findIssues(sim, readings) }
}

function applyAction(sim: SimState, action: ActionId): SimState {
  switch (action) {
    case 'shelter': return goToShelter(sim)
    case 'water': return drinkWater(sim)
    case 'rest': return rest(sim, sim.sleepHours < 6 ? 1.3 : 0.6)
    case 'earth': return notifyEarth(sim)
    case 'exercise': return doExercise(sim, 30)
    case 'mood': return moodCheck(sim)
    case 'ack': return sim
  }
}
const ACTION_SAID: Record<ActionId, string> = {
  shelter: 'Vas al refugio. La radiación baja ahí dentro.',
  water: 'Agua registrada. Tu hidratación va a subir.',
  rest: 'Descanso registrado.',
  earth: 'Aviso enviado a la Tierra. Te responderán pronto.',
  exercise: 'Ejercicio en marcha. El pulso alto ahora es normal.',
  mood: 'Chequeo de ánimo guardado.',
  ack: 'Anotado.',
}

const initial = () => ({
  ...derive(createSim()),
  dismissed: {}, acted: {}, highlight: null, tasksDone: {}, points: 240, streak: 4,
  toast: null, storyCaption: null,
})

export const useStore = create<Store>((set, get) => ({
  scene: 0,
  bootDone: false,
  demoOpen: false,
  lowPerf: false,
  visorUp: true,
  fogKey: 0,
  webgl: true,
  ...initial(),
  set: (p) => set(p),
  setScene: (n) => set({ scene: Math.max(0, Math.min(SCENES.length - 1, n)) }),
  finishBoot: () => { if (get().scene === 0) set({ scene: 1, bootDone: true }); else set({ bootDone: true }) },
  tick: () => {
    const d = derive(step(get().sim))
    const dismissed = { ...get().dismissed }
    const acted = { ...get().acted }
    for (const k of Object.keys(d.readings) as MetricKey[]) {
      if (d.readings[k].status === 'ok') { delete dismissed[k]; delete acted[k] }
    }
    set({ ...d, dismissed, acted })
  },
  scenario: (sc) => set(derive(applyScenario(get().sim, sc))),
  setDest: (d) => set(derive(setDestination(get().sim, d))),
  dismiss: (key) => {
    const st = get().readings[key].status
    set({ dismissed: { ...get().dismissed, [key]: st } })
  },
  act: (action, key) => {
    const s = get()
    const patch: Partial<Store> = { ...derive(applyAction(s.sim, action)), toast: ACTION_SAID[action] }
    if (key) {
      patch.dismissed = { ...s.dismissed, [key]: s.readings[key].status }
      if (!s.acted[key]) patch.points = s.points + ALERT_TASK_POINTS
      patch.acted = { ...s.acted, [key]: s.readings[key].status }
    }
    set(patch)
  },
  completeTask: (id) => {
    const s = get()
    if (s.tasksDone[id]) return
    const task = TASKS.find((t) => t.id === id)!
    const tasksDone = { ...s.tasksDone, [id]: true }
    const count = Object.keys(tasksDone).length
    set({
      ...derive(applyAction(s.sim, task.action)),
      tasksDone,
      points: s.points + task.points,
      streak: count === 3 ? s.streak + 1 : s.streak,
      toast: `${task.title}: hecho. +${task.points} puntos`,
    })
  },
  setHighlight: (z) => set({ highlight: z }),
  say: (t) => set({ toast: t }),
  reset: () => set(initial()),
}))

/** Aviso que toca mostrar en el centro: el más grave que no se haya cerrado. */
const RANK: Record<Status, number> = { ok: 0, warn: 1, bad: 2 }
export function currentAlert(s: Pick<Store, 'issues' | 'dismissed' | 'acted'>): Issue | null {
  return s.issues.find((i) => s.dismissed[i.key] !== i.level && RANK[i.level] > RANK[s.acted[i.key] ?? 'ok']) ?? null
}
/** Avisos cuya acción todavía no se hizo: van primero en la ruta diaria. */
export function pendingIssues(s: Pick<Store, 'issues' | 'acted'>): Issue[] {
  return s.issues.filter((i) => RANK[i.level] > RANK[s.acted[i.key] ?? 'ok'])
}

// Acceso desde la consola y las pruebas automáticas
;(globalThis as unknown as { astrotwin: typeof useStore }).astrotwin = useStore
