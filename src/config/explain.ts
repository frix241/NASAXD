/**
 * Explicaciones cortas que aparecen al tocar una zona del gemelo o un indicador.
 * No se asume que la persona sabe de medicina: qué es, por qué cambia, cómo se mide y cuándo avisar.
 * Las del espacio siguen los cinco riesgos del vuelo espacial del Programa de Investigación Humana de la NASA.
 */
import type { MeasureField, MetricKey } from '../sim/simulator'

export interface Field { field: MeasureField; label: string; min: number; max: number; step: number; unit: string }
export interface Explain { what: string; why: string; how: string; alert: string; hazard?: string; fields?: Field[] }

export const EXPLAIN_LABELS = { what: 'What it is', why: 'Why it changes in space', how: 'How it is measured', alert: 'When to notify Earth' }

export const SPACE_EXPLAIN: Partial<Record<MetricKey, Explain>> = {
  pulse: {
    what: 'The number of times your heart beats per minute while resting.',
    why: 'Without gravity, the heart works less and loses strength. Stress, dehydration, and too little sleep can speed it up.',
    how: 'Read by the suit sensor. To count manually, feel your wrist pulse for 30 seconds and multiply by 2.',
    alert: 'If it stays above 100 at rest after 10 minutes, or if you have chest pain.',
    hazard: 'Altered gravity',
    fields: [{ field: 'pulse', label: 'Heart rate', min: 30, max: 200, step: 1, unit: 'bpm' }],
  },
  bp: {
    what: 'The force of blood pushing against your arteries. It has two numbers: the higher one during a heartbeat and the lower one between beats.',
    why: 'Without gravity, body fluids shift toward your head and your heart adapts. Too little sleep and water can raise it.',
    how: 'With a cuff: sit for 5 minutes with your arm at heart level. Do not talk while it measures.',
    alert: 'If the higher number is 140 or more in two readings in a row, or if you have a severe headache or blurred vision.',
    hazard: 'Altered gravity',
    fields: [
      { field: 'sys', label: 'Systolic', min: 70, max: 220, step: 1, unit: 'mmHg' },
      { field: 'dia', label: 'Diastolic', min: 40, max: 130, step: 1, unit: 'mmHg' },
    ],
  },
  spo2: {
    what: 'How much oxygen your blood carries. Normal is 95% or higher.',
    why: 'The spacecraft is a closed environment: if ventilation fails, stale air builds up and the oxygen you breathe drops.',
    how: 'Use a fingertip pulse oximeter. Keep your hand still and warm; wait for the reading to settle.',
    alert: 'If it drops below 90%, or is between 90 and 94% and you feel dizzy or short of breath.',
    hazard: 'Hostile closed environment',
    fields: [{ field: 'spo2', label: 'Oxygen', min: 70, max: 100, step: 1, unit: '%' }],
  },
  resp: {
    what: 'The number of breaths you take per minute. At rest, 12 to 20 is typical.',
    why: 'It can rise with fever, exertion, anxiety, or stale cabin air.',
    how: 'Read by the suit sensor. To count manually, watch your chest rise for 30 seconds and multiply by 2.',
    alert: 'If it is above 24 at rest or you feel short of breath.',
    hazard: 'Hostile closed environment',
    fields: [{ field: 'resp', label: 'Breathing', min: 4, max: 50, step: 1, unit: 'breaths/min' }],
  },
  hydration: {
    what: 'How much water your body contains. Your kidneys need it to filter your blood.',
    why: 'In space, you feel less thirsty and bones release calcium. Dehydration increases the risk of kidney stones.',
    how: 'Estimated by the suit. Manually, check your urine color: pale is a good sign; dark may mean you need water.',
    alert: 'If it drops below 45% and does not rise after drinking, or if you have severe lower-back pain.',
    hazard: 'Altered gravity',
    fields: [{ field: 'hydration', label: 'Hydration', min: 20, max: 100, step: 1, unit: '%' }],
  },
  temp: {
    what: 'Your body heat. A typical range is 36.0 to 37.5 °C.',
    why: 'During long missions, the body’s defenses change and germs can spread easily in a closed space.',
    how: 'Use an ear or forehead thermometer while resting and away from hot food.',
    alert: 'If it rises above 38.0 °C or drops below 35.5 °C.',
    hazard: 'Hostile closed environment',
    fields: [{ field: 'temp', label: 'Temperature', min: 34, max: 42, step: 0.1, unit: '°C' }],
  },
  glucose: {
    what: 'The sugar in your blood: your body’s fuel. Fasting levels are typically 70 to 99 mg/dL.',
    why: 'Mission food, reduced movement, and stress can change how your body uses sugar.',
    how: 'Use a glucose meter with a drop of blood from your finger in the morning before eating.',
    alert: 'If fasting glucose is 126 or higher two days in a row, or drops below 54. If below 70, eat something sweet and check again.',
    hazard: 'Distance from Earth',
    fields: [{ field: 'glucose', label: 'Glucose', min: 30, max: 400, step: 1, unit: 'mg/dL' }],
  },
  sleep: {
    what: 'The number of hours you slept last night. Aim for 7 or more.',
    why: 'There is no natural day or night in orbit, and there is noise and a lot of work. Too little sleep raises blood pressure and lowers mood.',
    how: 'Recorded by the suit. Manually, note when you fell asleep and when you woke up.',
    alert: 'If you sleep less than 6 hours for three nights in a row.',
    hazard: 'Isolation and confinement',
    fields: [{ field: 'sleep', label: 'Hours slept', min: 0, max: 12, step: 0.5, unit: 'h' }],
  },
  mood: {
    what: 'How you feel today, from 0 to 100.',
    why: 'Months in confinement, away from family and with the same small group, can wear anyone down.',
    how: 'You decide: think about your energy, patience, and motivation, and choose a number.',
    alert: 'If you are below 40 for several days or feel no motivation. Asking for support is part of the mission.',
    hazard: 'Isolation and confinement',
    fields: [{ field: 'mood', label: 'Mood', min: 0, max: 100, step: 5, unit: 'out of 100' }],
  },
  exercise: {
    what: 'Your progress toward your weekly exercise goal. Exercise protects your muscles and bones.',
    why: 'Without weight to carry, you can lose 1 to 1.5% of bone each month, as well as muscle. Strength training slows this loss.',
    how: 'It updates automatically when you complete resistance exercise in your daily plan.',
    alert: 'If you have been unable to exercise for more than a week, or have pain while bearing weight.',
    hazard: 'Altered gravity',
  },
  radiation: {
    what: 'Invisible energy from the Sun and space that passes through the spacecraft. It is compared with typical levels at your destination.',
    why: 'Far beyond Earth’s shield, much more reaches you. It can damage cells over time and rise sharply during a solar storm.',
    how: 'Measured by the spacecraft dosimeters and the one on your suit.',
    alert: 'Earth sends storm alerts. If radiation rises to more than 5 times normal, go to the shelter immediately.',
    hazard: 'Space radiation',
  },
}
