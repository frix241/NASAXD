import type { ActionId, Zone } from '../sim/issues'

export type TaskId =
  | 'resistance' | 'water' | 'rest' | 'mood' | 'shelter' | 'measure'
export interface Task {
  id: TaskId; title: string; what: string; minutes: number; cares: string
  zone: Zone; points: number; action: ActionId; effect: string
}

export const SPACE_TASKS: Task[] = [
  { id: 'measure', title: 'Routine measurements', what: 'On the Monitor, tap Blood Pressure and Glucose and enter the readings from your devices.', minutes: 5, cares: 'Heart and blood sugar', zone: 'heart', points: 15, action: 'ack', effect: 'Your data is up to date' },
  { id: 'resistance', title: 'Resistance exercise', what: 'Use the strength machine: legs, back, and arms.', minutes: 30, cares: 'Muscles and bones', zone: 'muscles', points: 30, action: 'exercise', effect: 'Increases your weekly exercise' },
  { id: 'water', title: 'Water', what: 'Drink a full pouch of water.', minutes: 2, cares: 'Kidneys and blood pressure', zone: 'kidneys', points: 10, action: 'water', effect: 'Improves your hydration' },
  { id: 'rest', title: 'Rest', what: 'Dim the lights, close your eyes, and avoid screens.', minutes: 20, cares: 'Head and heart', zone: 'head', points: 15, action: 'rest', effect: 'Restores sleep and lowers blood pressure' },
  { id: 'mood', title: 'Mood check-in', what: 'Say out loud how you feel today.', minutes: 3, cares: 'Mood', zone: 'head', points: 10, action: 'mood', effect: 'Improves your mood' },
  { id: 'shelter', title: 'Shelter check', what: 'Make sure the shelter has water, food, and a clear path.', minutes: 5, cares: 'Whole-body protection from radiation', zone: 'body', points: 15, action: 'ack', effect: 'Shelter ready for a storm' },
]

export const POINTS_PER_LEVEL = 100
export const ALERT_TASK_POINTS = 20
