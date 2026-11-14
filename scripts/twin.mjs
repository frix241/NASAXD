import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:5173/')
await page.evaluate("astrotwin.getState().set({visorUp:false}); astrotwin.getState().setScene(1)")
for (const i of [0, 1, 2]) { await page.waitForTimeout(3000); await page.screenshot({ path: `shots/twin-${i}.png`, clip: { x: 60, y: 90, width: 440, height: 600 } }) }
console.log(await page.evaluate("astrotwin.getState().lowPerf"))
await browser.close()
