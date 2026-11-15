/**
 * Explicaciones cortas que aparecen al tocar una zona del gemelo o un indicador.
 * No se asume que la persona sabe de medicina: qué es, por qué cambia, cómo se mide y cuándo avisar.
 * Las del espacio siguen los cinco riesgos del vuelo espacial del Programa de Investigación Humana de la NASA.
 */
import type { MeasureField, MetricKey } from '../sim/simulator'

export interface Field { field: MeasureField; label: string; min: number; max: number; step: number; unit: string }
export interface Explain { what: string; why: string; how: string; alert: string; hazard?: string; fields?: Field[] }

export const EXPLAIN_LABELS = { what: 'Qué es', why: 'Por qué cambia en el espacio', how: 'Cómo se mide', alert: 'Cuándo avisar a la Tierra' }

export const SPACE_EXPLAIN: Partial<Record<MetricKey, Explain>> = {
  pulse: {
    what: 'Las veces que late tu corazón en un minuto, estando en reposo.',
    why: 'Sin gravedad el corazón trabaja menos y pierde fuerza. El estrés, la falta de agua y dormir poco lo aceleran.',
    how: 'Lo lee el sensor del traje. A mano: cuenta los latidos en la muñeca durante 30 segundos y multiplica por 2.',
    alert: 'Si pasa de 100 en reposo y no baja tras 10 minutos de descanso, o si sientes dolor en el pecho.',
    hazard: 'Gravedad alterada',
    fields: [{ field: 'pulse', label: 'Pulso', min: 30, max: 200, step: 1, unit: 'lpm' }],
  },
  bp: {
    what: 'La fuerza con que la sangre empuja las arterias. Son dos números: el alto (al latir) y el bajo (entre latidos).',
    why: 'Sin gravedad los líquidos del cuerpo suben hacia la cabeza y el corazón se adapta. Dormir poco y tomar poca agua la suben.',
    how: 'Con el brazalete: siéntate 5 minutos, brazo a la altura del corazón, sin hablar mientras mide.',
    alert: 'Si el número alto llega a 140 o más en dos mediciones seguidas, o si hay dolor de cabeza fuerte o visión borrosa.',
    hazard: 'Gravedad alterada',
    fields: [
      { field: 'sys', label: 'Número alto', min: 70, max: 220, step: 1, unit: 'mmHg' },
      { field: 'dia', label: 'Número bajo', min: 40, max: 130, step: 1, unit: 'mmHg' },
    ],
  },
  spo2: {
    what: 'Cuánto oxígeno lleva tu sangre. Lo normal es 95 % o más.',
    why: 'La nave es un ambiente cerrado: si falla la ventilación se acumula aire usado y baja el oxígeno que respiras.',
    how: 'Con la pinza del dedo. Mano quieta y tibia; espera a que el número se quede fijo.',
    alert: 'Si baja de 90 %, o si está entre 90 y 94 % y sientes mareo o falta de aire.',
    hazard: 'Ambiente cerrado y hostil',
    fields: [{ field: 'spo2', label: 'Oxígeno', min: 70, max: 100, step: 1, unit: '%' }],
  },
  resp: {
    what: 'Las veces que respiras en un minuto. En reposo, entre 12 y 20.',
    why: 'Sube con fiebre, con esfuerzo, con ansiedad o si el aire de la cabina está cargado.',
    how: 'Lo lee el sensor del traje. A mano: cuenta cuántas veces sube tu pecho en 30 segundos y multiplica por 2.',
    alert: 'Si pasa de 24 en reposo o sientes que te falta el aire.',
    hazard: 'Ambiente cerrado y hostil',
    fields: [{ field: 'resp', label: 'Respiración', min: 4, max: 50, step: 1, unit: 'rpm' }],
  },
  hydration: {
    what: 'Cuánta agua tiene tu cuerpo. Los riñones la necesitan para limpiar la sangre.',
    why: 'En el espacio se siente menos sed y los huesos sueltan calcio: con poca agua aumenta el riesgo de piedras en el riñón.',
    how: 'Lo estima el traje. A mano: mira el color de la orina. Clara es buena señal; oscura, falta agua.',
    alert: 'Si baja de 45 % y no sube después de beber, o si hay dolor fuerte en la espalda baja.',
    hazard: 'Gravedad alterada',
    fields: [{ field: 'hydration', label: 'Hidratación', min: 20, max: 100, step: 1, unit: '%' }],
  },
  temp: {
    what: 'El calor de tu cuerpo. Lo normal está entre 36,0 y 37,5 °C.',
    why: 'En misiones largas las defensas del cuerpo cambian y los microbios se contagian fácil en un espacio cerrado.',
    how: 'Con el termómetro de oído o de frente, en reposo y lejos de una comida caliente.',
    alert: 'Si pasa de 38,0 °C o baja de 35,5 °C.',
    hazard: 'Ambiente cerrado y hostil',
    fields: [{ field: 'temp', label: 'Temperatura', min: 34, max: 42, step: 0.1, unit: '°C' }],
  },
  glucose: {
    what: 'El azúcar que lleva tu sangre: es el combustible del cuerpo. En ayunas, lo normal es de 70 a 99 mg/dL.',
    why: 'La comida de la misión, el poco movimiento y el estrés pueden cambiar cómo el cuerpo usa el azúcar.',
    how: 'Con el medidor: una gota de sangre del dedo, por la mañana y antes de comer.',
    alert: 'Si en ayunas marca 126 o más dos días seguidos, o si baja de 54. Si baja de 70, come algo dulce y mide otra vez.',
    hazard: 'Distancia de la Tierra',
    fields: [{ field: 'glucose', label: 'Glucosa', min: 30, max: 400, step: 1, unit: 'mg/dL' }],
  },
  sleep: {
    what: 'Las horas que dormiste anoche. Hacen falta 7 o más.',
    why: 'En órbita no hay día ni noche naturales, hay ruido y mucho trabajo. Dormir poco sube la presión y baja el ánimo.',
    how: 'Lo registra el traje. A mano: anota a qué hora te dormiste y a qué hora despertaste.',
    alert: 'Si duermes menos de 6 horas tres noches seguidas.',
    hazard: 'Aislamiento y encierro',
    fields: [{ field: 'sleep', label: 'Horas dormidas', min: 0, max: 12, step: 0.5, unit: 'h' }],
  },
  mood: {
    what: 'Cómo te sientes hoy, de 0 a 100.',
    why: 'Meses de encierro, lejos de la familia y con el mismo grupo pequeño, desgastan a cualquiera.',
    how: 'Tú lo decides: piensa en tu energía, tu paciencia y tus ganas, y ponle un número.',
    alert: 'Si llevas varios días por debajo de 40 o no tienes ganas de nada. Pedir apoyo es parte de la misión.',
    hazard: 'Aislamiento y encierro',
    fields: [{ field: 'mood', label: 'Ánimo', min: 0, max: 100, step: 5, unit: 'de 100' }],
  },
  exercise: {
    what: 'Cuánto llevas de tu meta de ejercicio de la semana. Protege músculos y huesos.',
    why: 'Sin peso que cargar se pierde entre 1 y 1,5 % de hueso al mes, y también músculo. El ejercicio de fuerza lo frena.',
    how: 'Se suma solo al completar el ejercicio de resistencia de tu ruta diaria.',
    alert: 'Si llevas más de una semana sin poder hacer ejercicio, o si hay dolor al cargar peso.',
    hazard: 'Gravedad alterada',
  },
  radiation: {
    what: 'La energía invisible del Sol y del espacio que atraviesa la nave. Se compara con lo normal en tu destino.',
    why: 'Fuera del escudo de la Tierra llega mucha más. Con el tiempo daña las células; en una tormenta solar sube de golpe.',
    how: 'La miden los dosímetros de la nave y el que llevas en el traje.',
    alert: 'La Tierra avisa de las tormentas. Si sube a más de 5 veces lo normal, ve al refugio sin esperar el aviso.',
    hazard: 'Radiación espacial',
  },
}
