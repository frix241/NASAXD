import { useEffect, useRef, useState } from 'react'
import Boot from './scenes/Boot'
import DataWall from './scenes/DataWall'
import Monitor from './scenes/Monitor'
import Route from './scenes/Route'
import Climate from './scenes/community/Climate'
import Evaluate from './scenes/community/Evaluate'
import Person from './scenes/community/Person'
import Referral, { ReferralPrint } from './scenes/community/Referral'
import { useProfile, useStore } from './store'
import { Space } from './three/Space'
import { Assistant } from './ui/Assistant'
import { CommunityBackdrop } from './ui/community/Backdrop'
import { DemoPanel } from './ui/Demo'
import { Helmet } from './ui/Helmet'
import { hasWebGL, useTabVisible } from './ui/hooks'

const OUT_MS = 320
const IN_MS = 480 // total 800 ms

function useSceneNav() {
  useEffect(() => {
    let lock = 0; let lastScroll = 0
    const go = (dir: number) => {
      const now = performance.now()
      if (now < lock) return
      lock = now + 950
      const s = useStore.getState()
      s.setScene(s.scene + dir)
    }
    const blocked = (t: EventTarget | null) => t instanceof Element && !!t.closest('.modal, .demo, .chat')
    const scroller = () => document.querySelector<HTMLElement>('.scene')
    const room = (dir: number) => {
      const el = scroller()
      if (!el) return false
      return dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 2 : el.scrollTop > 2
    }
    const onWheel = (e: WheelEvent) => {
      if (blocked(e.target) || Math.abs(e.deltaY) < 8) return
      const dir = Math.sign(e.deltaY); const now = performance.now()
      if (room(dir)) { lastScroll = now; return }
      if (now - lastScroll < 450) { lastScroll = now; return }
      go(dir)
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      const s = useStore.getState()
      if (e.key === 'd' || e.key === 'D') { s.set({ demoOpen: !s.demoOpen }); return }
      if (e.key === 'c' || e.key === 'C') { s.setProfile(s.profile === 'space' ? 'community' : 'space'); return }
      if (document.querySelector('.modal')) return
      if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); go(1) }
      if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1) }
    }
    let sx = 0; let sy = 0; let edgeDown = false; let edgeUp = false; let skip = false
    const onStart = (e: TouchEvent) => {
      skip = blocked(e.target)
      sx = e.touches[0].clientX; sy = e.touches[0].clientY
      edgeDown = !room(1); edgeUp = !room(-1)
    }
    const onEnd = (e: TouchEvent) => {
      if (skip) return
      const dx = e.changedTouches[0].clientX - sx; const dy = e.changedTouches[0].clientY - sy
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
      else if (dy < -70 && Math.abs(dy) > Math.abs(dx) * 1.5 && edgeDown) go(1)
      else if (dy > 70 && Math.abs(dy) > Math.abs(dx) * 1.5 && edgeUp) go(-1)
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey)
      window.removeEventListener('touchstart', onStart); window.removeEventListener('touchend', onEnd)
    }
  }, [])
}

function NavDots() {
  const scene = useStore((s) => s.scene)
  const setScene = useStore((s) => s.setScene)
  const scenes = useProfile().scenes
  return (
    <nav className="dots" aria-label="Scenes">
      {scenes.map((name, i) => (
        <button key={name} aria-label={name} aria-current={i === scene} onClick={() => setScene(i)}>
          <i /><span>{name}</span>
        </button>
      ))}
    </nav>
  )
}

function Toast() {
  const toast = useStore((s) => s.toast)
  const say = useStore((s) => s.say)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => say(null), 3600)
    return () => clearTimeout(t)
  }, [toast, say])
  return toast ? <div className="toast" role="status">{toast}</div> : null
}

export default function App() {
  const scene = useStore((s) => s.scene)
  const story = useStore((s) => s.storyCaption)
  const p = useProfile()
  const printing = useStore((s) => s.printing)
  const theme = useStore((s) => s.theme)
  const [swap, setSwap] = useState(false)
  const visible = useTabVisible()
  const [shown, setShown] = useState(scene)
  const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle')
  useSceneNav()

  useEffect(() => { if (!hasWebGL()) useStore.getState().set({ webgl: false }) }, [])
  // Brief transition when switching modes.
  const firstMode = useRef(true)
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return }
    setSwap(true)
    const t = setTimeout(() => setSwap(false), 400)
    return () => clearTimeout(t)
  }, [p.id])
  useEffect(() => { document.body.dataset.print = printing ?? '' }, [printing])
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => useStore.getState().tick(), 1000)
    return () => clearInterval(id)
  }, [visible])
  useEffect(() => {
    if (scene === shown) return
    setPhase('out')
    const t = setTimeout(() => { setShown(scene); setPhase('in') }, OUT_MS)
    return () => clearTimeout(t)
  }, [scene, shown])
  useEffect(() => {
    if (phase !== 'in') return
    const t = setTimeout(() => setPhase('idle'), IN_MS)
    return () => clearTimeout(t)
  }, [phase, shown])

  const kind = p.sceneKinds[Math.min(shown, p.sceneKinds.length - 1)]
  return (
    <div className={`app mode-${p.id}${p.id === 'community' ? ` theme-${theme}` : ''}${swap ? ' mode-swap' : ''}`}
      style={p.palette ? { '--ice': p.palette.ice, '--line': p.palette.line, '--line-soft': p.palette.lineSoft } as React.CSSProperties : undefined}>
      {p.id !== 'community' && <Space boot={shown === 0} />}
      {p.id === 'community' && <CommunityBackdrop />}
      <main className={`stage${phase === 'idle' ? '' : ` holo-${phase}`}`}>
        <div className={`scene${shown === 0 ? ' boot-scene' : ''}`} key={shown}>
          {kind === 'boot' && <Boot />}
          {kind === 'monitor' && <Monitor />}
          {kind === 'data' && <DataWall />}
          {kind === 'route' && <Route />}
          {kind === 'person' && <Person />}
          {kind === 'evaluate' && <Evaluate />}
          {kind === 'referral' && <Referral />}
          {kind === 'climate' && <Climate />}
        </div>
      </main>
      <Helmet />
      <NavDots />
      <Assistant />
      <Toast />
      {story && <div className="story" role="status">{story}</div>}
      <DemoPanel />
      {p.id === 'community' && <ReferralPrint />}
    </div>
  )
}
