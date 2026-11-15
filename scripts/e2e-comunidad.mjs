// Prueba de punta a punta del perfil "Comunidad rural: heladas y friaje" (id `community`).
// Uso: URL=http://localhost:4173/ node scripts/e2e-comunidad.mjs   → código 1 si algo falla.
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const url = process.env.URL ?? 'http://localhost:4173/'
const root = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(`${root}shots`, { recursive: true })
const SCENE_H1 = { 1: 'Persona', 2: 'Evaluar', 3: 'Hoja de derivación', 4: 'Clima y riesgo' }
const LONG = 120_000
let fails = 0

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

for (const [w, h] of [[1440, 900], [420, 860]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 })
  const page = await ctx.newPage()
  page.setDefaultTimeout(LONG)
  const logs = []; const external = []
  await page.addInitScript(() => { window.__printCalls = []; window.print = () => { window.__printCalls.push(document.body.dataset.print ?? '') } })
  await page.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(url) || u.startsWith('data:') || u.startsWith('blob:')) r.continue(); else { external.push(u); r.abort() } })
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message))

  const S = (k) => page.evaluate(`(() => { const s = astrotwin.getState(); return ${k} })()`)
  const waitS = (expr, timeout = LONG) => page.waitForFunction(`(() => { const s = astrotwin.getState(); return ${expr} })()`, null, { timeout })
  const report = (name, ok, extra) => {
    if (!ok) fails++
    console.log(`${ok ? 'OK  ' : 'FALLA'} [${w}] ${name}`)
    if (extra) console.log('       ' + String(extra).split('\n').join('\n       '))
  }
  const check = async (name, fn) => {
    try { const r = await fn(); if (r && typeof r === 'object' && 'ok' in r) report(name, r.ok, r.info); else report(name, !!r) }
    catch (e) { report(name, false, 'excepción: ' + String(e.message).split('\n')[0]) }
  }
  const shot = (n) => page.screenshot({ path: `${root}shots/comunidad-${n}-${w}.png` }).catch(() => {})
  const skipIntro = async () => {
    const b = page.getByRole('button', { name: 'Saltar' })
    try { await b.click({ timeout: 8000 }) } catch { await page.evaluate('astrotwin.getState().setScene(1)') }
    await waitS('s.scene >= 1')
  }
  const goScene = async (n) => {
    await page.evaluate(`astrotwin.getState().setScene(${n})`)
    await waitS(`s.scene === ${n}`)
    await page.waitForFunction(([t]) => {
      const h1 = document.querySelector('.stage .scene h1')
      return h1 && h1.textContent.trim() === t && !document.querySelector('.stage.holo-out, .stage.holo-in')
    }, [SCENE_H1[n]])
  }
  const grp = (name) => page.getByRole('group', { name, exact: true })

  // ── 1. Entrada directa en comunidad, con luz del día ─────────────────────
  await page.goto(new URL('?modo=comunidad', url).href)
  await check('?modo=comunidad abre en perfil comunidad con tema Luz del día', async () => {
    await page.waitForSelector('.app.mode-community.theme-day')
    return (await S('s.profile')) === 'community' && (await S('s.theme')) === 'day'
  })
  await skipIntro()

  // ── 2. Cambiar de perfil 5 veces ─────────────────────────────────────────
  await page.goto(url)
  await skipIntro()
  await check('cambiar de perfil 5 veces (tecla C e interruptor) termina en comunidad; en misión sigue el Pulso', async () => {
    const want = ['community', 'space', 'community', 'space', 'community']
    let pulse = true
    for (let i = 0; i < 5; i++) {
      if (i === 0 || i === 4) { await page.mouse.move(w / 2, h / 2); await page.keyboard.press('c') }
      else if (i === 2) await page.getByRole('button', { name: 'Comunidad rural' }).click()
      else await page.getByRole('button', { name: 'Misión espacial' }).click()
      await waitS(`s.profile === '${want[i]}'`)
      if (want[i] === 'space') {
        try { await page.getByText('Pulso', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 }) } catch { pulse = false }
      }
    }
    await page.waitForSelector('.app.mode-community.theme-day')
    return { ok: pulse && (await S('s.profile')) === 'community', info: pulse ? '' : 'no apareció "Pulso" en misión espacial' }
  })
  await page.getByRole('button', { name: /Persona/ }).first().waitFor({ state: 'attached' }).catch(() => {})
  await goScene(1)

  // ── 3. Sin planetas ni casco ─────────────────────────────────────────────
  await check('en comunidad no hay .space, .helmet ni .scanlines visibles', async () => {
    const found = await page.evaluate(() => ['.space', '.helmet', '.scanlines'].filter((sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0
    }))
    return { ok: found.length === 0, info: found.join(', ') }
  })
  await shot('persona')

  // ── 4. Escenario completo en Evaluar ─────────────────────────────────────
  await goScene(2)
  await shot('evaluar-inicio')
  await check('Evaluar: elegir "Niño menor de 5" lo marca en la visita', async () => {
    await page.getByRole('button', { name: /Niño menor de 5/ }).click()
    await waitS(`s.visit.kind === 'child'`)
    return true
  })
  await check('Evaluar: responder la observación (tos, fiebre, abrigo, líquidos) deja "Atiendo yo"', async () => {
    const answer = async (group, text) => { await grp(group).getByRole('button', { name: text, exact: true }).click() }
    await answer('Tiene tos', 'No')
    await answer('Tiene fiebre (al tacto)', 'No')
    await answer('Tiene abrigo suficiente', 'Sí')
    await answer('Comió y tomó líquidos hoy', 'Sí')
    await waitS(`s.visit.cough === false && s.visit.feverTouch === false && s.visit.warmEnough === true && s.visit.ateDrank === true`)
    // la respiración se corrige a mano con +/− (se prueba aparte en el cronómetro); aquí se pone por el store
    await page.evaluate("astrotwin.getState().setVisit({ breaths: 30 })")
    const st = await S('s.result.status')
    return { ok: st === 'ok', info: `estado: ${st}` }
  })
  let before
  await check('Evaluar: cambiar el frío a "Helada" cambia el resultado', async () => {
    before = await S('({ label: s.result.label, reason: s.result.reason })')
    await grp('Nivel de frío').getByRole('button', { name: /Helada/ }).click()
    await waitS(`s.visit.cold === 'helada'`)
    const after = await S('({ label: s.result.label, reason: s.result.reason })')
    return { ok: JSON.stringify(after) !== JSON.stringify(before), info: `${before.label} (${before.reason}) → ${after.label} (${after.reason})` }
  })
  await check('Evaluar: la cabecera del resultado muestra la decisión actual', async () => {
    const label = await S('s.result.label')
    return page.locator('.cm-result-label').filter({ hasText: label }).first().isVisible()
  })
  await check('"Simular helada" (panel de demostración) ⇒ "Vigilo y vuelvo a revisar" (warn)', async () => {
    await page.mouse.move(w / 2, h / 2)
    await page.keyboard.press('d')
    await page.getByRole('complementary', { name: 'Modo demostración' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Simular helada' }).click()
    await waitS('s.frostOn === true')
    await page.keyboard.press('d')
    await waitS('s.demoOpen === false')
    const r = await S('({ status: s.result.status, label: s.result.label })')
    return { ok: r.status === 'warn' && r.label === 'Vigilo y vuelvo a revisar', info: JSON.stringify(r) }
  })
  await shot('evaluar-helada')
  await check('etiqueta "Datos de demostración" aparece en Persona y en la Hoja tras simular helada', async () => {
    await goScene(1)
    const a = await page.locator('.stage').getByText('Datos de demostración').first().isVisible()
    await goScene(3)
    const b = await page.locator('.stage').getByText('Datos de demostración').first().isVisible()
    await goScene(2)
    return { ok: a && b, info: `Persona: ${a}, Hoja: ${b}` }
  })
  await check('marcar "Dificultad para respirar" ⇒ "Derivo a la posta" (bad)', async () => {
    const btn = page.getByRole('button', { name: /Dificultad para respirar/ })
    await btn.click()
    await waitS(`s.visit.danger.breathless === true`)
    const r = await S('({ status: s.result.status, label: s.result.label })')
    return { ok: r.status === 'bad' && r.label === 'Derivo a la posta' && (await btn.getAttribute('aria-pressed')) === 'true', info: JSON.stringify(r) }
  })
  await shot('evaluar-alarma')
  await check('una señal de alarma con TODO lo demás sin responder sigue en "Derivo"', async () => {
    await page.getByRole('button', { name: 'Ver más' }).first().click().catch(() => {})
    await page.getByRole('button', { name: 'Nueva persona' }).last().click()
    await waitS(`s.visit.cough === null && s.visit.breaths === null && !s.visit.danger.breathless`)
    await page.getByRole('button', { name: /Dificultad para respirar/ }).click()
    await waitS(`s.visit.danger.breathless === true`)
    const r = await S('({ status: s.result.status, answered: s.result.confidence.answered, cough: s.visit.cough, fever: s.visit.feverTouch, warm: s.visit.warmEnough, ate: s.visit.ateDrank, b: s.visit.breaths })')
    return { ok: r.status === 'bad' && r.answered === 0, info: JSON.stringify(r) }
  })

  // ── 5. Incertidumbre ─────────────────────────────────────────────────────
  await check('con pocos datos se ve "Con pocos datos: seré más cautelosa."', async () => {
    const loc = page.locator('.cm-result').getByText('Con pocos datos: seré más cautelosa.')
    if (!(await loc.isVisible())) await page.locator('.cm-result-more').click()
    await loc.waitFor({ state: 'visible', timeout: 10000 })
    return true
  })

  // ── 6. Cronómetro de respiración ─────────────────────────────────────────
  await check('cronómetro: empezar, tocar 5 veces y el contador sube a 5', async () => {
    await page.getByRole('button', { name: 'Empezar a contar' }).click()
    const tap = page.locator('.cm-tap')
    await tap.waitFor({ state: 'visible' })
    for (let i = 0; i < 5; i++) await tap.click()
    await page.waitForFunction(() => document.querySelector('.cm-tap-num')?.textContent.trim() === '5')
    return true
  })
  await check('cronómetro: Parar no guarda un conteo incompleto y + y − guardan visit.breaths', async () => {
    await page.getByRole('button', { name: 'Parar' }).click()
    await page.getByRole('button', { name: 'Una respiración más' }).waitFor({ state: 'visible' })
    const stopped = await S('s.visit.breaths')
    const more = page.getByRole('button', { name: 'Una respiración más' })
    await more.click(); await more.click(); await more.click()
    await waitS('s.visit.breaths === 3')
    await page.getByRole('button', { name: 'Una respiración menos' }).click()
    await waitS('s.visit.breaths === 2')
    const shown = await page.locator('.cm-breath-value output').innerText()
    return { ok: stopped === null && shown.trim() === '2', info: `tras parar: ${stopped}; mostrado: ${shown}` }
  })
  await shot('respiracion')

  // ── 7. Hoja de derivación ────────────────────────────────────────────────
  await page.evaluate(`astrotwin.getState().setVisit({ hoursToPost: 3 })`)
  await goScene(3)
  await shot('hoja')
  await check('Hoja: muestra alias, señales marcadas, hora, distancia a la posta y "En el camino"', async () => {
    const sheet = page.locator('.cm-paper')
    const txt = await sheet.innerText()
    const have = {
      alias: /Persona 1/.test(txt),
      senales: /Señales de alarma/.test(txt) && /Le cuesta respirar/i.test(txt),
      hora: /Hora\s*\n?\s*\d{2}:\d{2}/.test(txt),
      distancia: /Distancia a la posta\s*\n?\s*3 horas/.test(txt),
      camino: await page.locator('.cm-paper').getByRole('heading', { name: 'En el camino' }).isVisible(),
    }
    return { ok: Object.values(have).every(Boolean), info: JSON.stringify(have) }
  })
  await check('Hoja: cinco líneas para dictar por radio', async () => {
    const n = await page.locator('.cm-radio li').count()
    const heading = await page.getByRole('heading', { name: 'Para dictar por radio o teléfono' }).isVisible()
    return { ok: n === 5 && heading, info: `líneas: ${n}` }
  })
  await check('"Imprimir hoja" llama a window.print con body[data-print="derivacion"]', async () => {
    await page.getByRole('button', { name: 'Imprimir hoja' }).click()
    await page.waitForFunction(() => window.__printCalls.length > 0)
    const calls = await page.evaluate('window.__printCalls')
    const after = await S('s.printing')
    return { ok: calls.length === 1 && calls[0] === 'derivacion' && after === null, info: `llamadas: ${JSON.stringify(calls)}, printing final: ${after}` }
  })
  await check('PDF A4 de la hoja (printing=derivacion) tiene exactamente 1 página', async () => {
    await page.evaluate("astrotwin.getState().set({ printing: 'derivacion' })")
    await page.waitForFunction(() => document.body.dataset.print === 'derivacion')
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, path: `${root}shots/comunidad-hoja-${w}.pdf` })
    await page.evaluate("astrotwin.getState().set({ printing: null })")
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    return { ok: pages === 1, info: `páginas: ${pages}` }
  })

  // ── 8. Tamaños y contraste en tema día ───────────────────────────────────
  const measured = {}
  for (const n of [1, 2, 3, 4]) {
    await goScene(n)
    // los <details> cerrados (sensores, umbrales) se abren para medir también su contenido
    await page.evaluate(() => document.querySelectorAll('.stage details').forEach((d) => { d.open = true }))
    await page.waitForTimeout(600)
    measured[n] = await page.evaluate(() => {
      const sel = (el) => {
        let s = el.tagName.toLowerCase()
        if (el.id) s += '#' + el.id
        const c = [...el.classList].slice(0, 3).join('.')
        if (c) s += '.' + c
        const p = el.parentElement
        if (p && p !== document.body) { const pc = [...p.classList][0]; s = (p.tagName.toLowerCase() + (pc ? '.' + pc : '')) + ' > ' + s }
        return s
      }
      const visible = (el) => {
        const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e)
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || +cs.opacity === 0) return false
        }
        return true
      }
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
      const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a) }
      const bgOf = (el) => {
        const layers = []
        for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 0.99) break }
        let acc = layers.length && layers[layers.length - 1][3] >= 0.99 ? layers.pop() : [255, 255, 255, 1]
        while (layers.length) acc = over(layers.pop(), acc)
        return acc
      }
      const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
      const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
      const stage = document.querySelector('.stage')
      const small = []; const lowContrast = []; const buttons = []; let texts = 0
      const seen = new Set()
      for (const el of stage.querySelectorAll('*')) {
        if (el.closest('svg') || ['SCRIPT', 'STYLE', 'CANVAS'].includes(el.tagName)) continue
        if (!visible(el)) continue
        const own = [...el.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim().length > 0)
        if (el.tagName === 'BUTTON') {
          const r = el.getBoundingClientRect(); const min = el.closest('.topbar') ? 48 : 56
          if (r.height < min - 0.5) buttons.push({ sel: sel(el), h: Math.round(r.height * 10) / 10, min, text: el.textContent.trim().slice(0, 30) })
        }
        if (!own) continue
        texts++
        const cs = getComputedStyle(el)
        const fs = parseFloat(cs.fontSize)
        const text = [...el.childNodes].filter((nd) => nd.nodeType === 3).map((nd) => nd.textContent.trim()).join(' ').slice(0, 30)
        if (fs < 18 - 0.01) small.push({ sel: sel(el), fs, text })
        if (el.disabled || el.closest('[disabled]')) continue
        const bg = bgOf(el)
        const fg = over(parse(cs.color), bg)
        const r = ratio(fg, bg)
        const key = sel(el) + cs.color + bg.join()
        if (r < 4.5 && !seen.has(key)) { seen.add(key); lowContrast.push({ sel: sel(el), ratio: Math.round(r * 100) / 100, fg: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round)})`, text }) }
      }
      return { small, lowContrast, buttons, texts, theme: document.querySelector('.app').className }
    })
  }
  const dedupe = (list, f) => [...new Map(list.map((x) => [f(x), x])).values()]
  const allSmall = dedupe(Object.entries(measured).flatMap(([n, m]) => m.small.map((x) => ({ ...x, scene: n }))), (x) => x.sel + x.fs)
  const allButtons = dedupe(Object.entries(measured).flatMap(([n, m]) => m.buttons.map((x) => ({ ...x, scene: n }))), (x) => x.sel + x.h)
  const allLow = dedupe(Object.entries(measured).flatMap(([n, m]) => m.lowContrast.map((x) => ({ ...x, scene: n }))), (x) => x.sel + x.fg + x.bg)
  await check('tema día activo en las escenas 1 a 4 y se midió texto en todas', async () => {
    const ok = Object.values(measured).every((m) => /theme-day/.test(m.theme) && m.texts > 5)
    return { ok, info: Object.entries(measured).map(([n, m]) => `escena ${n}: ${m.texts} textos`).join('; ') }
  })
  await check('tamaño de letra: todo texto visible en .stage mide 18 px o más (escenas 1 a 4)', async () => ({
    ok: allSmall.length === 0,
    info: allSmall.length ? `${allSmall.length} excepciones:\n` + allSmall.map((x) => `escena ${x.scene}  ${x.sel}  ${x.fs}px  "${x.text}"`).join('\n') : '',
  }))
  await check('botones: todo button visible en .stage mide 56 px o más (48 px en .topbar)', async () => ({
    ok: allButtons.length === 0,
    info: allButtons.length ? `${allButtons.length} excepciones:\n` + allButtons.map((x) => `escena ${x.scene}  ${x.sel}  ${x.h}px (mín ${x.min})  "${x.text}"`).join('\n') : '',
  }))
  await check('contraste WCAG 4.5:1 entre texto y fondo efectivo (todos los textos visibles, escenas 1 a 4)', async () => ({
    ok: allLow.length === 0,
    info: allLow.length ? `${allLow.length} excepciones:\n` + allLow.map((x) => `escena ${x.scene}  ${x.sel}  ${x.ratio}:1  ${x.fg} sobre ${x.bg}  "${x.text}"`).join('\n') : '',
  }))
  if (w === 1440) {
    await check('node scripts/contrast.mjs termina con código 0', async () => {
      const r = spawnSync(process.execPath, [`${root}scripts/contrast.mjs`], { encoding: 'utf8' })
      return { ok: r.status === 0, info: r.status === 0 ? '' : (r.stdout + r.stderr).slice(-800) }
    })
  }

  // ── 9. Tema ──────────────────────────────────────────────────────────────
  await goScene(2)
  await check('botón "Noche" pone theme-night y "Luz del día" vuelve a theme-day', async () => {
    await page.locator('.topbar').getByRole('button', { name: 'Noche' }).click()
    await page.waitForSelector('.app.theme-night')
    await shot('noche')
    await page.locator('.topbar').getByRole('button', { name: 'Luz del día' }).click()
    await page.waitForSelector('.app.theme-day:not(.theme-night)')
    return true
  })

  // ── 10. Idioma ───────────────────────────────────────────────────────────
  await check('Quechua muestra la nota de revisión pendiente y los textos siguen en español', async () => {
    await page.getByRole('button', { name: /Quechua/ }).click()
    await waitS(`s.lang === 'qu'`)
    const note = await page.getByText('pendiente de revisión por hablantes nativos').isVisible()
    const es = (await page.locator('.cm-eval h1').innerText()).trim() === 'Evaluar' && await page.getByRole('button', { name: /Niño menor de 5/ }).isVisible()
    await page.getByRole('button', { name: /Español/ }).click()
    await waitS(`s.lang === 'es'`)
    return { ok: note && es, info: `nota: ${note}, español: ${es}` }
  })

  // ── 11. Leer en voz alta ─────────────────────────────────────────────────
  await check('"Leer en voz alta" no produce errores de consola (con o sin voz)', async () => {
    const n0 = logs.length
    const read = page.getByRole('button', { name: /Leer en voz alta|Callar/ }).first()
    if (!(await read.isVisible())) await page.locator('.cm-result-more').click()
    if (await read.isDisabled()) { await page.waitForTimeout(500); return { ok: logs.length === n0, info: 'sin voz: botón desactivado con aviso' } }
    await read.click(); await page.waitForTimeout(800)
    // Sin voz, el aviso de error del navegador desactiva el botón: es el comportamiento esperado
    const again = page.getByRole('button', { name: /Leer en voz alta|Callar/ }).first()
    const off = await again.isDisabled()
    if (!off) { await again.click(); await page.waitForTimeout(500) }
    return { ok: logs.length === n0, info: (off ? 'el botón se desactivó (sin voz). ' : '') + logs.slice(n0).join(' | ') }
  })

  // ── 12. Modo historia ────────────────────────────────────────────────────
  await check('modo historia (tecla D): termina solo y pasa por "Derivo" (bad)', async () => {
    await page.evaluate(`window.__seenBad = false; astrotwin.subscribe((s) => { if (s.result.status === 'bad') window.__seenBad = true })`)
    await page.mouse.move(w / 2, h / 2)
    await page.keyboard.press('d')
    await page.getByRole('button', { name: 'Modo historia' }).click()
    await waitS('s.storyCaption !== null', 30000)
    await waitS('s.storyCaption === null', 120000)
    const bad = await page.evaluate('window.__seenBad')
    return { ok: bad, info: bad ? '' : 'la historia terminó sin pasar por "bad"' }
  })
  await shot('historia-fin')

  // ── 14. Sin desborde horizontal en 420 px ────────────────────────────────
  if (w === 420) {
    const over = {}
    for (const n of [1, 2, 3, 4]) {
      await goScene(n); await page.waitForTimeout(400)
      over[n] = await page.evaluate('document.documentElement.scrollWidth')
    }
    await check('420 px: sin desborde horizontal en las escenas 1 a 4', async () => ({
      ok: Object.values(over).every((v) => v <= 420), info: 'scrollWidth por escena: ' + JSON.stringify(over),
    }))
  }

  // ── 13. Privacidad y calidad ─────────────────────────────────────────────
  await check('localStorage + sessionStorage vacíos', async () =>
    ({ ok: (await page.evaluate('localStorage.length + sessionStorage.length')) === 0 }))
  await check('ninguna petición fuera de la URL base', async () => ({ ok: external.length === 0, info: external.slice(0, 5).join('\n') }))
  await check('consola sin errores', async () => ({ ok: logs.length === 0, info: logs.slice(0, 5).join('\n') }))
  await ctx.close()
}
await browser.close()
console.log(fails === 0 ? 'todo bien' : `${fails} comprobaciones fallaron`)
process.exit(fails === 0 ? 0 : 1)
