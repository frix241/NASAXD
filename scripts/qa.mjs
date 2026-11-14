import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:process.env.QA_HEADLESS!=='0',channel:'chromium',args:['--ignore-gpu-blocklist','--enable-gpu','--enable-gpu-rasterization','--use-gl=angle','--use-angle=gl']});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
const results={url:'http://127.0.0.1:4173/?qa=1',checks:[],errors,performance:[]};
const check=(name)=>{results.checks.push(name);console.log('PASS',name);};
const sample=async()=>{await page.waitForFunction(()=>window.__ASTROTWIN_QA__?.fps>0);await page.waitForTimeout(2200);return page.evaluate(()=>window.__ASTROTWIN_QA__);};
try{
 await page.goto(results.url);
 await page.waitForFunction(()=>window.__ASTROTWIN_QA__?.layers.organs===true,{timeout:30000});
 assert.equal(await page.locator('canvas').count(),1);check('Visor WebGL carga sin fallback');
 await page.screenshot({path:'artifacts/mvp-desktop.png'});
 for(const label of ['Aislar Traje biométrico','Aislar Cuerpo holográfico','Aislar Tejido muscular','Aislar Sistema óseo','Aislar Órganos internos']){
  await page.getByRole('radio',{name:label,exact:true}).click();
  const sampleData=await sample();results.performance.push({layer:label,...sampleData});
  await page.screenshot({path:`artifacts/layer-${label.split(' ')[1].toLowerCase()}.png`});
 }check('Cinco disecciones rápidas actualizan capas');
 const baseline=await sample();
 for(let i=0;i<3;i++)for(const label of ['Aislar Traje biométrico','Aislar Tejido muscular','Aislar Órganos internos']){await page.getByRole('radio',{name:label,exact:true}).click();await page.waitForTimeout(180);}
 const after=await sample();assert.ok(after.memory.geometries<=baseline.memory.geometries+1);check('Geometrías estables tras ciclos de capas');
 await page.getByLabel('Explorar órgano',{exact:true}).selectOption('heart');
 await page.getByText('Seleccionado: Corazón',{exact:true}).waitFor();check('Selección de órgano actualiza contexto');
 await page.getByRole('radio',{name:'Vista posterior',exact:true}).click();
 await page.waitForFunction(()=>window.__ASTROTWIN_QA__?.camera[2]<-3);check('Cámara posterior funcional');
 await page.getByRole('button',{name:'Restablecer cámara',exact:true}).click();
 await page.waitForFunction(()=>window.__ASTROTWIN_QA__?.camera[2]>3);check('Reset de cámara funcional');
 for(const scenario of ['cardiac','respiratory','thermal','radiation']){
  await page.locator('#scenario').selectOption(scenario);
  await page.locator('.alert-label').waitFor({timeout:12000});
  assert.ok((await page.locator('.alert-label').innerText()).includes('SEÑAL SIMULADA'));
  await page.screenshot({path:`artifacts/alert-${scenario}.png`});
 }check('Cuatro escenarios generan anillo y alerta');
 await page.getByRole('button',{name:'Pausar simulación',exact:true}).click();
 const frozen=await page.locator('.metric strong').allTextContents();
 await page.waitForTimeout(1100);
 assert.deepEqual(await page.locator('.metric strong').allTextContents(),frozen);check('Pausa congela telemetría');
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Preparar reporte',exact:true}).click();const download=await downloadEvent;await download.saveAs('artifacts/reporte-simulado.json');check('Reporte JSON descargable');
 await page.getByRole('button',{name:'Restaurar escenario',exact:true}).click();await page.getByRole('heading',{name:'Monitoreo estable',exact:true}).waitFor();check('Reset elimina alertas');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.__ASTROTWIN_QA__?.layers.organs===true);check('Carga completa offline tras instalación');await context.setOffline(false);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'artifacts/mvp-mobile.png',fullPage:true});check('Móvil 390px sin desbordamiento horizontal');
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('Explorar órgano',{exact:true}).selectOption('lungs');check('Preferencia de movimiento reducido admite interacción');
 assert.deepEqual(errors,[]);check('Sin errores de consola o ejecución');
 results.geometryBaseline=baseline.memory;results.geometryAfter=after.memory;results.passed=true;
}catch(error){results.passed=false;results.failure=String(error);console.error(error);await page.screenshot({path:'artifacts/qa-failure.png',fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{await writeFile('artifacts/browser-qa.json',JSON.stringify(results,null,2));await browser.close();}
