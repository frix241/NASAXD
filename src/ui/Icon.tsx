import type { Status } from '../config/rules'

type Name = Status | 'close' | 'mic' | 'send' | 'sound' | 'mute' | 'keys'
const PATHS: Record<Name, string> = {
  ok: 'M3.5 8.5l3 3 6-7',
  warn: 'M8 2.5v6.5M8 12.6v.4',
  bad: 'M4 4l8 8M12 4l-8 8',
  close: 'M4 4l8 8M12 4l-8 8',
  mic: 'M6 2.8a2 2 0 0 1 4 0v4.4a2 2 0 0 1-4 0zM3.6 7.4a4.4 4.4 0 0 0 8.8 0M8 11.8v2.4M5.8 14.2h4.4',
  send: 'M2.5 8h10M8.5 4l4 4-4 4',
  sound: 'M2.5 6.2h2.3L8 3.5v9L4.8 9.8H2.5zM10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 3.8a6 6 0 0 1 0 8.4',
  mute: 'M2.5 6.2h2.3L8 3.5v9L4.8 9.8H2.5zM10.6 6l3 4M13.6 6l-3 4',
  keys: 'M2 4.5h12v7H2zM4.4 7h.2M7 7h.2M9.4 7h.2M11.6 7h.2M5 9.3h6',
}

/** Iconos propios, un solo trazo. `size` en px. */
export function Icon({ name, size = 14 }: { name: Name; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={name === 'ok' || name === 'warn' || name === 'bad' ? 2.2 : 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
