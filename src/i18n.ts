/**
 * English interface copy. Quechua remains pending native-speaker review.
 */
import { useStore } from './store'

export type Dict = Record<string, string>
export const QU_PENDING = 'Quechua: pending review by native speakers'

/** Returns t(key). `qu` should only contain translations reviewed by native speakers. */
export function useT<D extends Dict>(en: D, qu: Partial<Record<keyof D, string>> = {}) {
  const lang = useStore((s) => s.lang)
  return (key: keyof D): string => (lang === 'qu' ? qu[key] ?? en[key] : en[key])
}
