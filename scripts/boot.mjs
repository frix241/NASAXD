import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[1440, 900], [420, 860]]) {
  for (const t of [1700, 4300]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    await page.goto('http://localhost:5173/')
    await page.waitForTimeout(t)
    await page.screenshot({ path: `shots/boot-${w}-${t}.png` })
    await page.close()
  }
}
await browser.close()
