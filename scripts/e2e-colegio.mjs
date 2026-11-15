// Modo colegio de punta a punta sobre el build, con la red externa bloqueada.
import { chromium } from 'playwright'
const url = process.env.URL ?? 'http://localhost:4173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
let fails = 0
for (const [w, h] of [[1440, 900], [420, 860]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  const logs = []; const external = []
  await page.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(url) || u.startsWith('data:') || u.startsWith('blob:')) r.continue(); else { external.push(u); r.abort() } })
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) }); page.on('pageerror', (e) => logs.push('pageerror ' + e.message))
  await page.addInitScript(() => { window.__prints = []; window.print = () => window.__prints.push(document.body.dataset.print) })
  const S = (k) => page.evaluate(`(() => { const s = astrotwin.getState(); return ${k} })()`)
  const check = (name, ok) => { if (!ok) fails++; console.log(`${ok ? 'OK  ' : 'FALLA'} [${w}] ${name}`) }

  await page.goto(url + '?modo=colegio'); await page.waitForTimeout(500)
  check('?modo=colegio abre en modo colegio', (await S('s.profile')) === 'school')
  check('el título del arranque es el del colegio', await page.getByRole('heading', { name: /AstroTwin Colegio/ }).isVisible())
  await page.getByRole('button', { name: 'Saltar' }).click(); await page.waitForTimeout(1100)

  // cambiar de modo 5 veces (tecla C e interruptor)
  for (let i = 0; i < 4; i++) { await page.keyboard.press('c'); await page.waitForTimeout(500) }
  check('tecla C alterna el modo (4 veces vuelve a colegio)', (await S('s.profile')) === 'school')
  await page.getByRole('button', { name: 'Misión espacial' }).click(); await page.waitForTimeout(500)
  check('interruptor: misión espacial muestra el pulso', (await S('s.profile')) === 'space' && await page.getByText('Pulso').first().isVisible())
  await page.getByRole('button', { name: 'Colegio', exact: true }).click(); await page.waitForTimeout(600)
  const text = (await page.locator('.stage').innerText()).toLowerCase()
  const clinical = ['pulso', 'presión', 'oxígeno', 'riñ', 'corazón', 'mmhg', 'lpm', 'radiación', 'sangre', 'hidratación'].filter((t) => text.includes(t))
  check('modo colegio sin términos clínicos en pantalla ' + clinical.join(','), clinical.length === 0)
  check('nada guardado en localStorage', (await page.evaluate('localStorage.length + sessionStorage.length')) === 0)

  // región y evento de calor
  await page.getByRole('button', { name: 'Sierra (Cusco)' }).click()
  check('cambia la región', (await S('s.aula.region')) === 'sierra' && await page.getByText(/lo normal en sierra: 17/).isVisible())
  await page.keyboard.press('d'); await page.getByRole('button', { name: 'Ola de calor' }).click(); await page.keyboard.press('d')
  await page.waitForTimeout(700)
  check('ola de calor: clima en rojo y acción del día', (await S('s.readings.radiation.status')) === 'bad' && await page.getByRole('alertdialog', { name: 'Ola de calor' }).isVisible())
  await page.screenshot({ path: `shots/col-calor-${w}.png` })
  await page.getByRole('button', { name: 'Hecho' }).click()

  // conteo rápido: 7 días con valores distintos, solo con botones
  await page.getByRole('button', { name: 'Conteo rápido' }).click(); await page.waitForTimeout(1100)
  const tap = async (label, n) => { for (let i = 0; i < n; i++) { await page.getByRole('button', { name: label }).click() } }
  const plan = [[0, 'Normal', 'Sí'], [4, 'Calor', 'Sí'], [10, 'Normal', 'No'], [10, 'Frío', 'Sí'], [10, 'Normal', 'Sí'], [0, 'Normal', 'Sí'], [2, 'Normal', 'Sí']]
  const seen = []
  for (const [more, clima, recreo] of plan) {
    await tap('Uno más: ¿Cuántos durmieron poco?', more)
    await page.getByRole('button', { name: clima, exact: true }).click()
    await page.getByRole('button', { name: recreo, exact: true }).click()
    seen.push(await S('s.readings.sleep.status') + '/' + await S('s.readings.radiation.status') + '/' + await S('s.readings.exercise.status'))
    await page.getByRole('button', { name: 'Guardar y pasar al día siguiente' }).click()
  }
  check('7 días registrados; el semáforo cambia: ' + seen.join(' '), new Set(seen).size >= 4 && seen[2].startsWith('bad') && seen[0].startsWith('ok'))
  check('se conservan 7 días', (await S('s.aula.days.length')) === 7)
  // tres días seguidos en rojo -> hablar con la familia o la posta
  await tap('Uno más: ¿Cuántos durmieron poco?', 11)
  await page.getByRole('button', { name: 'Guardar y pasar al día siguiente' }).click(); await tap('Uno más: ¿Cuántos durmieron poco?', 11)
  await page.getByRole('button', { name: 'Guardar y pasar al día siguiente' }).click(); await tap('Uno más: ¿Cuántos durmieron poco?', 11)
  check('3 días en rojo: sugiere familia o posta de salud', await page.getByText(/conversa con la familia o la posta de salud/).first().isVisible())
  await page.screenshot({ path: `shots/col-conteo-${w}.png` })
  await page.locator('summary').click()
  await tap('Uno más: ¿Cuántos no trajeron agua?', 3)
  check('nivel 2 opcional se despliega y cuenta', (await S('s.aula.days.at(-1).noWater')) === 3)

  // resumen e impresión
  await page.getByRole('button', { name: 'Resumen de la semana' }).click(); await page.waitForTimeout(1100)
  check('resumen: tabla de 7 días y 3 mini gráficos', (await page.locator('.summary table.week thead th').count()) === 8 && (await page.locator('.trend svg').count()) === 3)
  check('etiqueta "Datos de demostración"', await page.getByText('Datos de demostración').first().isVisible())
  await page.screenshot({ path: `shots/col-resumen-${w}.png` })
  await page.getByRole('button', { name: 'Imprimir ficha' }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Informe para el director' }).click(); await page.waitForTimeout(300)
  check('se abre la impresión de la ficha y del informe', JSON.stringify(await page.evaluate('window.__prints')) === '["ficha","informe"]')
  for (const sheet of ['ficha', 'informe']) {
    await page.evaluate(`astrotwin.getState().set({ printing: '${sheet}' })`); await page.waitForTimeout(150)
    const pdf = await page.pdf({ path: `shots/${sheet}-${w}.pdf`, format: 'A4', preferCSSPageSize: true })
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    check(`${sheet}: cabe en una hoja (${pages})`, pages === 1)
  }
  await page.emulateMedia({ media: 'print' }); await page.evaluate("astrotwin.getState().set({ printing: 'informe' })"); await page.waitForTimeout(150)
  check('informe: semáforo, acciones y "Datos de demostración"', await page.getByText('Tres acciones para la próxima semana').isVisible() && await page.locator('.informe .foot').getByText('Datos de demostración.').isVisible())
  await page.setViewportSize({ width: 794, height: 1123 }); await page.screenshot({ path: `shots/informe-${w}.png` })
  await page.evaluate("astrotwin.getState().set({ printing: 'ficha' })"); await page.waitForTimeout(150); await page.screenshot({ path: `shots/ficha-${w}.png` })
  await page.emulateMedia({ media: 'screen' }); await page.setViewportSize({ width: w, height: h }); await page.evaluate("astrotwin.getState().set({ printing: null })")

  // copiloto y modo historia del colegio
  await page.getByRole('button', { name: 'Escribir al asistente' }).click()
  await page.getByRole('button', { name: '¿Qué hago hoy?' }).click(); await page.waitForTimeout(1200)
  const ans = await page.locator('.msg.bot').last().innerText()
  check('copiloto da la acción del día: ' + ans.slice(0, 60), /Acción del día|Todo en verde/.test(ans))
  await page.getByRole('button', { name: 'Cerrar asistente' }).click()
  await page.keyboard.press('d'); await page.getByRole('button', { name: 'Modo historia' }).click()
  // El render por software puede atrasar los temporizadores: se espera cada paso en vez de dormir un tiempo fijo
  const until = (f, ms) => page.waitForFunction(f, null, { timeout: ms }).then(() => true, () => false)
  // Se mira el estado y no la pantalla: con render por software dos pasos de la historia pueden caer en el mismo cuadro
  check('historia: acción del día por sueño', await until(() => { const s = astrotwin.getState(); return s.issues.some((i) => i.key === 'sleep' && i.level === 'bad') || !!s.acted.sleep }, 30000))
  { const ok = await until(() => astrotwin.getState().scene === 4 && astrotwin.getState().streak === 5, 90000); check('historia: llega al resumen de la semana', ok); if (!ok) console.log(await page.evaluate("JSON.stringify({scene: astrotwin.getState().scene, streak: astrotwin.getState().streak, done: astrotwin.getState().tasksDone, cap: astrotwin.getState().storyCaption})")) }
  check('historia termina sola', await until(() => astrotwin.getState().storyCaption === null, 30000))
  check('sin pedidos a internet', external.length === 0); if (external.length) console.log(external)
  check('consola sin errores', logs.length === 0); if (logs.length) console.log(logs.slice(0, 5))
  await ctx.close()
}
console.log(fails ? `${fails} comprobaciones fallaron` : 'todo bien')
process.exit(fails ? 1 : 0)
