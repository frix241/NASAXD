import type { ActionId, Zone } from '../sim/issues'

export type TaskId = 'resistance' | 'water' | 'rest' | 'mood' | 'shelter'
export interface Task {
  id: TaskId; title: string; what: string; minutes: number; cares: string
  zone: Zone; points: number; action: ActionId; effect: string
}

export const TASKS: Task[] = [
  { id: 'resistance', title: 'Ejercicio de resistencia', what: 'Usa la máquina de fuerza: piernas, espalda y brazos.', minutes: 30, cares: 'Músculos y huesos', zone: 'muscles', points: 30, action: 'exercise', effect: 'Sube tu ejercicio semanal' },
  { id: 'water', title: 'Agua', what: 'Bebe una bolsa de agua completa.', minutes: 2, cares: 'Riñones y presión', zone: 'kidneys', points: 10, action: 'water', effect: 'Sube tu hidratación' },
  { id: 'rest', title: 'Descanso', what: 'Luz baja, ojos cerrados, sin pantallas.', minutes: 20, cares: 'Cabeza y corazón', zone: 'head', points: 15, action: 'rest', effect: 'Recupera sueño y baja la presión' },
  { id: 'mood', title: 'Chequeo de ánimo', what: 'Cuenta en voz alta cómo te sientes hoy.', minutes: 3, cares: 'Ánimo', zone: 'head', points: 10, action: 'mood', effect: 'Sube tu ánimo' },
  { id: 'shelter', title: 'Revisión del refugio', what: 'Comprueba que el refugio tenga agua, comida y camino libre.', minutes: 5, cares: 'Todo el cuerpo ante la radiación', zone: 'body', points: 15, action: 'ack', effect: 'Refugio listo para una tormenta' },
]
export const POINTS_PER_LEVEL = 100
export const ALERT_TASK_POINTS = 20
