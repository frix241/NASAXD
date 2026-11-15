import type { ActionId, Zone } from '../sim/issues'

export type TaskId =
  | 'resistance' | 'water' | 'rest' | 'mood' | 'shelter' | 'measure'
  | 'breakfast' | 'entry' | 'recess' | 'lunch' | 'exit' | 'night'
export interface Task {
  id: TaskId; title: string; what: string; minutes: number; cares: string
  zone: Zone; points: number; action: ActionId; effect: string
}

export const SPACE_TASKS: Task[] = [
  { id: 'measure', title: 'Mediciones de rutina', what: 'En el Monitor, toca Presión y Glucosa y registra lo que marcan tus aparatos.', minutes: 5, cares: 'Corazón y azúcar en sangre', zone: 'heart', points: 15, action: 'ack', effect: 'Tus datos quedan al día' },
  { id: 'resistance', title: 'Ejercicio de resistencia', what: 'Usa la máquina de fuerza: piernas, espalda y brazos.', minutes: 30, cares: 'Músculos y huesos', zone: 'muscles', points: 30, action: 'exercise', effect: 'Sube tu ejercicio semanal' },
  { id: 'water', title: 'Agua', what: 'Bebe una bolsa de agua completa.', minutes: 2, cares: 'Riñones y presión', zone: 'kidneys', points: 10, action: 'water', effect: 'Sube tu hidratación' },
  { id: 'rest', title: 'Descanso', what: 'Luz baja, ojos cerrados, sin pantallas.', minutes: 20, cares: 'Cabeza y corazón', zone: 'head', points: 15, action: 'rest', effect: 'Recupera sueño y baja la presión' },
  { id: 'mood', title: 'Chequeo de ánimo', what: 'Cuenta en voz alta cómo te sientes hoy.', minutes: 3, cares: 'Ánimo', zone: 'head', points: 10, action: 'mood', effect: 'Sube tu ánimo' },
  { id: 'shelter', title: 'Revisión del refugio', what: 'Comprueba que el refugio tenga agua, comida y camino libre.', minutes: 5, cares: 'Todo el cuerpo ante la radiación', zone: 'body', points: 15, action: 'ack', effect: 'Refugio listo para una tormenta' },
]

/** Día escolar del aula: seis momentos que guía el tutor. */
export const SCHOOL_TASKS: Task[] = [
  { id: 'breakfast', title: 'Desayuno', what: 'Pregunta a mano alzada quiénes desayunaron. Solo cuenta, sin señalar a nadie.', minutes: 1, cares: 'Energía para la mañana', zone: 'muscles', points: 10, action: 'ack', effect: 'Dato para el conteo rápido' },
  { id: 'entry', title: 'Entrada', what: 'Haz el conteo rápido del día: cinco preguntas, treinta segundos.', minutes: 1, cares: 'Sueño y ánimo', zone: 'head', points: 20, action: 'ack', effect: 'Semáforo del aula al día' },
  { id: 'recess', title: 'Recreo', what: 'Propón un juego con movimiento para todo el grupo.', minutes: 20, cares: 'Energía y movimiento', zone: 'muscles', points: 30, action: 'ack', effect: 'Recreo activo cumplido' },
  { id: 'lunch', title: 'Lonche', what: 'Antes de comer, pausa para tomar agua y lavarse las manos.', minutes: 5, cares: 'Agua', zone: 'body', points: 10, action: 'ack', effect: 'El aula toma agua' },
  { id: 'exit', title: 'Salida', what: 'Recuerda: gorro, sombra en el camino y mañana solo lo del día en la mochila.', minutes: 2, cares: 'Sol, mochila y postura', zone: 'bones', points: 15, action: 'ack', effect: 'Mochilas más livianas mañana' },
  { id: 'night', title: 'Noche', what: 'Mensaje para casa: pantallas apagadas y a dormir temprano.', minutes: 1, cares: 'Sueño', zone: 'head', points: 15, action: 'ack', effect: 'Menos sueño mañana' },
]
export const POINTS_PER_LEVEL = 100
export const ALERT_TASK_POINTS = 20
