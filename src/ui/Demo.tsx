import { PROFILES } from '../profiles'
import { useProfile, useStore } from '../store'

let storyTimers: ReturnType<typeof setTimeout>[] = []
export function stopStory() {
  storyTimers.forEach(clearTimeout); storyTimers = []
  useStore.getState().set({ storyCaption: null })
}

/** Modo historia: reproduce sola la secuencia del perfil activo (misión espacial o colegio). */
export function playStory() {
  stopStory()
  const st = () => useStore.getState()
  const story = PROFILES[st().profile].story
  st().reset()
  st().set({ demoOpen: false, bootDone: true, visorUp: false })
  storyTimers = story.map((step) => setTimeout(() => {
    if (step.scene !== undefined) st().setScene(step.scene)
    if (step.scenario) st().scenario(step.scenario)
    if (step.act) st().act(step.act[0], step.act[1])
    if (step.task) st().completeTask(step.task)
    if (step.say !== undefined) st().set({ storyCaption: step.say })
  }, step.at))
}

/** Panel oculto de demostración. Se abre y se cierra con la tecla D. */
export function DemoPanel() {
  const p = useProfile()
  const open = useStore((s) => s.demoOpen)
  const scenario = useStore((s) => s.scenario)
  const reset = useStore((s) => s.reset)
  const story = useStore((s) => s.storyCaption)
  if (!open) return null
  return (
    <aside className="demo" aria-label="Modo demostración">
      <h2>Modo demostración</h2>
      <p>{p.text.demoNote}</p>
      {p.events.map(([id, label]) => (
        <button key={id} className="btn ghost small" onClick={() => scenario(id)}>{label}</button>
      ))}
      <button className="btn ghost small" onClick={() => { stopStory(); reset() }}>{p.text.restart}</button>
      <button className="btn small" onClick={story ? stopStory : playStory}>{story ? 'Detener historia' : 'Modo historia'}</button>
    </aside>
  )
}
