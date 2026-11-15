/** Convierte lecturas fuera de rango en avisos con lenguaje sencillo y una acción. Nunca diagnostica. */
import type { Status } from '../config/rules'
import type { MetricKey, Reading, SimState } from './simulator'

export type Zone = 'heart' | 'kidneys' | 'bones' | 'head' | 'muscles' | 'body'
export type ActionId = 'shelter' | 'water' | 'rest' | 'earth' | 'exercise' | 'mood' | 'ack'

export interface ZoneMap { of: Record<MetricKey, Zone>; label: Record<Zone, string>; metrics: Record<Zone, MetricKey[]> }
export const SPACE_ZONES: ZoneMap = {
  of: {
    pulse: 'heart', bp: 'heart', spo2: 'heart', resp: 'heart', hydration: 'kidneys',
    sleep: 'head', mood: 'head', exercise: 'muscles', radiation: 'body', temp: 'body', glucose: 'body',
  },
  label: {
    heart: 'Heart', kidneys: 'Kidneys', bones: 'Bones', head: 'Head and sleep',
    muscles: 'Muscles', body: 'Whole body',
  },
  metrics: {
    heart: ['pulse', 'bp', 'spo2', 'resp'], kidneys: ['hydration'], bones: ['exercise'],
    head: ['sleep', 'mood'], muscles: ['exercise'], body: ['radiation', 'temp', 'glucose'],
  },
}
export interface Issue {
  key: MetricKey
  level: Exclude<Status, 'ok'>
  zone: Zone
  title: string
  why: string
  action: ActionId
  actionLabel: string
  minutes: number
}

const PRIORITY: MetricKey[] = ['radiation', 'temp', 'spo2', 'bp', 'pulse', 'glucose', 'hydration', 'sleep', 'resp', 'exercise', 'mood']

type Copy = Omit<Issue, 'key' | 'level' | 'zone'>
function copy(key: MetricKey, bad: boolean, r: Reading, s: SimState): Copy {
  switch (key) {
    case 'radiation': return bad
      ? { title: 'Solar storm', why: `Radiation is ${r.text} times higher than normal. The shelter walls will protect you.`, action: 'shelter', actionLabel: 'Go to shelter', minutes: 5 }
      : { title: 'Radiation slightly high', why: `It is ${r.text} times above normal. Stay in the central areas of the spacecraft.`, action: 'ack', actionLabel: 'Got it', minutes: 1 }
    case 'temp': return bad
      ? { title: 'Temperature outside the normal range', why: `Your body temperature is ${r.text} °C. Rest, drink water, and report it to Earth.`, action: 'earth', actionLabel: 'Notify Earth', minutes: 3 }
      : { title: 'Temperature slightly high', why: `Your temperature is ${r.text} °C. Drink water and check again in 30 minutes.`, action: 'water', actionLabel: 'Drink water', minutes: 2 }
    case 'spo2': return bad
      ? { title: 'Low blood oxygen', why: `It is at ${r.text}%. Stop what you are doing, take a deep breath, and notify Earth.`, action: 'earth', actionLabel: 'Notify Earth', minutes: 3 }
      : { title: 'Blood oxygen slightly low', why: `It is at ${r.text}%. Breathe slowly and deeply for a few minutes.`, action: 'ack', actionLabel: 'Got it', minutes: 3 }
    case 'bp': return bad
      ? { title: 'High blood pressure', why: `Your blood pressure is ${r.text}. Sit down and breathe slowly. If it does not come down in 15 minutes, notify Earth.`, action: 'rest', actionLabel: 'Rest now', minutes: 15 }
      : { title: 'Blood pressure slightly high', why: s.sleepHours < 7
          ? `It is ${r.text}. Not getting enough sleep raises blood pressure. Rest and drink water.`
          : `It is ${r.text}. Drink water and avoid exertion for a while.`, action: 'water', actionLabel: 'Drink water', minutes: 2 }
    case 'pulse': return bad
      ? { title: 'Very fast resting heart rate', why: `Your heart beats ${r.text} times per minute while you are not exercising. Rest and notify Earth.`, action: 'earth', actionLabel: 'Notify Earth', minutes: 3 }
      : { title: 'Heart rate slightly fast', why: `Your heart beats ${r.text} times per minute. Sit down and breathe slowly.`, action: 'rest', actionLabel: 'Rest now', minutes: 10 }
    case 'hydration': return bad
      ? { title: 'You need water', why: `Your body is at ${r.text}% hydration. Dehydration can raise blood pressure and make you more tired.`, action: 'water', actionLabel: 'Drink water', minutes: 2 }
      : { title: 'Drink some water', why: `Your hydration is at ${r.text}%. A glass of water now can keep it from dropping further.`, action: 'water', actionLabel: 'Drink water', minutes: 2 }
    case 'sleep': return bad
      ? { title: 'You slept very little', why: `You slept ${r.text} hours last night. Too little sleep can raise blood pressure and lower your mood.`, action: 'rest', actionLabel: 'Take a nap', minutes: 20 }
      : { title: 'You need more sleep', why: `You slept ${r.text} hours last night. Try to take a short rest today.`, action: 'rest', actionLabel: 'Take a nap', minutes: 20 }
    case 'resp': return { title: bad ? 'Breathing outside the normal range' : 'Breathing slightly fast', why: `You are breathing ${r.text} times per minute. Stop and breathe slowly.`, action: bad ? 'earth' : 'ack', actionLabel: bad ? 'Notify Earth' : 'Got it', minutes: 3 }
    case 'exercise': return { title: bad ? 'Very little exercise this week' : 'You need more exercise this week', why: `You have completed ${r.text}% of your goal. Without exercise, muscle and bone are lost.`, action: 'exercise', actionLabel: 'Exercise', minutes: 30 }
    case 'mood': return { title: bad ? 'Very low mood' : 'Low mood', why: 'Your mood is lower. Resting or talking with someone may help.', action: 'mood', actionLabel: 'Mood check-in', minutes: 3 }
    case 'glucose': return r.value < 70
      ? { title: bad ? 'Very low blood sugar' : 'Slightly low blood sugar', why: `Your glucose is ${r.text} mg/dL. Eat something sweet now and check again in 15 minutes.${bad ? ' Notify Earth.' : ''}`, action: bad ? 'earth' : 'ack', actionLabel: bad ? 'Notify Earth' : 'I ate something', minutes: 15 }
      : { title: bad ? 'High blood sugar' : 'Slightly high blood sugar', why: `Your fasting glucose is ${r.text} mg/dL. ${bad ? 'Repeat the measurement and report it to Earth.' : 'Drink water, move around a little, and check again tomorrow before eating.'}`, action: bad ? 'earth' : 'ack', actionLabel: bad ? 'Notify Earth' : 'Got it', minutes: 5 }
    default: return { title: r.label, why: '', action: 'ack', actionLabel: 'Got it', minutes: 1 }
  }
}

export function findIssues(s: SimState, readings: Record<MetricKey, Reading>): Issue[] {
  const list: Issue[] = []
  for (const level of ['bad', 'warn'] as const) {
    for (const key of PRIORITY) {
      const r = readings[key]
      if (r.status !== level) continue
      list.push({ key, level, zone: SPACE_ZONES.of[key], ...copy(key, level === 'bad', r, s) })
    }
  }
  return list
}

export function statusPhrase(issues: Issue[]): string {
  if (!issues.length) return 'All clear'
  return issues.length === 1 ? '1 item to watch' : `${issues.length} items to watch`
}
