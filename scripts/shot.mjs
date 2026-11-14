// Uso: node scripts/shot.mjs <nombre> [js a ejecutar antes de la captura] [espera ms]
import { chromium } from 'playwright'
const [name, js = '', wait = '1500'] = process.argv.slice(2)
const url = process.env.URL ?? 'http://localhost:5173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[1440, 900], [420, 860]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const logs = []
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
  await page.goto(url)
  await page.waitForTimeout(800)
  if (js) await page.evaluate(js)
  await page.waitForTimeout(+wait)
  await page.screenshot({ path: `shots/${name}-${w}.png` })
  const overflow = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('.scene *, .modal *')) {
      if (el.closest('svg') || el.closest('canvas')) continue
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible' && el.clientWidth > 0) bad.push(el.className + ' ' + el.scrollWidth + '>' + el.clientWidth)
    }
    const sc = document.querySelector('.scene')
    return { bad: bad.slice(0, 8), scroll: sc ? [sc.scrollHeight, sc.clientHeight, sc.scrollWidth, sc.clientWidth] : null }
  })
  console.log(w, JSON.stringify(overflow), [...new Set(logs)].slice(0, 8).join(' | ') || 'consola limpia')
  await page.close()
}
await browser.close()
