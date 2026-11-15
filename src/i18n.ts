/**
 * Textos por idioma. Estructura lista para Quechua, pero SIN traducciones inventadas:
 * mientras una clave no tenga traducción revisada, se muestra en español.
 */
import { useStore } from './store'

export type Dict = Record<string, string>
export const QU_PENDING = 'Quechua: pendiente de revisión por hablantes nativos'

/** Devuelve t(clave). `qu` solo debe contener textos ya revisados por hablantes nativos. */
export function useT<D extends Dict>(es: D, qu: Partial<Record<keyof D, string>> = {}) {
  const lang = useStore((s) => s.lang)
  return (key: keyof D): string => (lang === 'qu' ? qu[key] ?? es[key] : es[key])
}
