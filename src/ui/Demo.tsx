import { useStore } from '../store'
import type { Scenario } from '../sim/simulator'

let storyTimers: ReturnType<typeof setTimeout>[] = []
export function stopStory() {
  storyTimers.forEach(clearTimeout); storyTimers = []
  useStore.getState().set({ storyCaption: null })
}

/** Modo historia: mala noche → alerta → tormenta → refugio → ruta diaria. Corre solo. */
export function playStory() {
  stopStory()
  const st = () => useStore.getState()
  const say = (storyCaption: string | null) => st().set({ storyCaption })
  const plan: [number, () => void][] = [
    [0, () => { st().reset(); st().set({ demoOpen: false, bootDone: true, visorUp: false }); st().setScene(1); say('Modo historia. Un día normal: todo en verde.') }],
    [4000, () => { st().scenario('badNight'); say('Mala noche: dormiste 4,8 horas. Aparece una alerta en el centro.') }],
    [10500, () => { st().act('rest', 'sleep'); say('Confirmas la alerta y programas una siesta.') }],
    [14000, () => { st().scenario('storm'); say('Llega una tormenta solar. La radiación sube.') }],
    [20500, () => { st().act('shelter', 'radiation'); say('Vas al refugio. La radiación vuelve a verde.') }],
    [25000, () => { st().setScene(3); say('Tu ruta diaria. Cada tarea cuida una parte del cuerpo.') }],
    [28500, () => st().completeTask('water')],
    [31000, () => st().completeTask('rest')],
    [33500, () => { st().completeTask('mood'); say('Tres tareas hechas: la racha sube un día.') }],
    [38000, () => say('Fin del modo historia.')],
    [41500, () => { say(null); storyTimers = [] }],
  ]
  storyTimers = plan.map(([ms, f]) => setTimeout(f, ms))
}

const SCENARIOS: [Scenario, string][] = [
  ['storm', 'Tormenta solar'], ['badNight', 'Mala noche'], ['lowWater', 'Poca agua'],
  ['highBP', 'Presión alta'], ['fever', 'Fiebre'],
]

/** Panel oculto de demostración. Se abre y se cierra con la tecla D. */
export function DemoPanel() {
  const open = useStore((s) => s.demoOpen)
  const scenario = useStore((s) => s.scenario)
  const reset = useStore((s) => s.reset)
  const story = useStore((s) => s.storyCaption)
  if (!open) return null
  return (
    <aside className="demo" aria-label="Modo demostración">
      <h2>Modo demostración</h2>
      <p>Tecla D para cerrar. Los cambios son simulados.</p>
      {SCENARIOS.map(([id, label]) => (
        <button key={id} className="btn ghost small" onClick={() => scenario(id)}>{label}</button>
      ))}
      <button className="btn ghost small" onClick={() => { stopStory(); reset() }}>Reiniciar</button>
      <button className="btn small" onClick={story ? stopStory : playStory}>{story ? 'Detener historia' : 'Modo historia'}</button>
    </aside>
  )
}
