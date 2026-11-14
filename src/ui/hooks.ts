import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function useTabVisible(): boolean {
  const [v, setV] = useState(!document.hidden)
  useEffect(() => {
    const f = () => setV(!document.hidden)
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return v
}

export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Número que sube poco a poco hasta el valor nuevo (puntos). */
export function useCountUp(value: number, ms = 600): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reducedMotion() || from.current === value) { from.current = value; setShown(value); return }
    const a = from.current; const t0 = performance.now(); let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms); const e = 1 - Math.pow(1 - k, 3)
      setShown(Math.round(a + (value - a) * e))
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = value }
  }, [value, ms])
  return shown
}
