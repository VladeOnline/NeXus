import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Local Chrome audit, without dependencies or changes to the user's browser profile.
const output = resolve(process.argv[2] || 'performance/results.json');
await mkdir(dirname(output), { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'nexus-performance-'));
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
let sequence = 0;
let buffer = '';
const pending = new Map();
const listeners = new Map();
let session;
function call(method, params = {}, sessionId = session) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
browser.stdio[4].on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id) {
      const job = pending.get(message.id);
      if (job) {
        clearTimeout(job.timeout); pending.delete(message.id);
        message.error ? job.reject(new Error(JSON.stringify(message.error))) : job.resolve(message.result);
      }
    } else {
      for (const handler of listeners.get(message.method) || []) handler(message.params);
    }
  }
});
browser.on('error', error => { console.error(error); process.exitCode = 1; });
function on(name, handler) {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(handler);
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const pause = ms => new Promise(r => setTimeout(r, ms));
let layers = [];
const errors = [];
on('LayerTree.layerTreeDidChange', e => { if (e.layers) layers = e.layers; });
on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
async function sample(label) {
  await pause(700);
  await call('Page.bringToFront');
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  if (!process.argv.includes('--no-screenshots')) {
    await writeFile(output.replace(/\.json$/, `-${label}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  const events = [];
  const collector = e => events.push(...e.value);
  on('Tracing.dataCollected', collector);
  await call('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc', transferMode: 'ReportEvents' }, undefined);
  const frame = await evaluate(`new Promise(resolve => {
    const times = []; let last; const start = performance.now();
    function next(now) {
      if(last !== undefined) times.push(now-last); last=now;
      if(now-start < 3000) requestAnimationFrame(next);
      else {const sorted=times.slice().sort((a,b)=>a-b); resolve({frames:times.length, meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:sorted[Math.floor(sorted.length*.95)],over25ms:times.filter(t=>t>25).length});}
    } requestAnimationFrame(next);
  })`);
  const done = new Promise(resolve => on('Tracing.tracingComplete', resolve));
  await call('Tracing.end', {}, undefined); await done;
  listeners.set('Tracing.dataCollected', listeners.get('Tracing.dataCollected').filter(x => x !== collector));
  const names = ['Paint', 'RasterTask', 'Layout', 'UpdateLayoutTree'];
  const work = Object.fromEntries(names.map(name => {
    const matching = events.filter(e => e.name === name && e.ph === 'X');
    return [name, { count: matching.length, totalMs: matching.reduce((sum,e) => sum + (e.dur || 0), 0)/1000 }];
  }));
  const contentLayers = layers.filter(x => x.drawsContent);
  const surfaces = await evaluate(`[
    ['lines','.ambient-lines','::before'],['particles','.ambient-particles',null],
    ['glow1','.ambient','::before'],['glow2','.ambient','::after']
  ].map(([name,selector,pseudo])=>{const s=getComputedStyle(document.querySelector(selector),pseudo);return {name,width:parseFloat(s.width),height:parseFloat(s.height),display:s.display,animation:s.animationName};})`);
  return { label, frame, work, surfaces, layers: contentLayers.map(x => ({width:x.width,height:x.height,paintCount:x.paintCount})),
    animations: await evaluate(`document.getAnimations().map(a=>({name:a.animationName,state:a.playState}))`) };
}
try {
  const target = await call('Target.createTarget', { url: 'about:blank' }, undefined);
  session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, undefined)).sessionId;
  await call('Page.enable'); await call('Runtime.enable'); await call('LayerTree.enable');
  await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width:1440,height:900,deviceScaleFactor:1,mobile:false });
  await call('Page.navigate', { url: pathToFileURL(resolve('index.html')).href });
  for (let i=0;i<50;i++) {
    if (await evaluate(`document.readyState==='complete' && typeof showView==='function'`)) break;
    await pause(200);
  }
  await evaluate(`document.fonts.ready.then(()=>true)`);
  await evaluate(`setTheme('oscuro')`);
  const samples = [await sample('desktop-dark')];
  // Isolate each effect to locate paint/raster costs without changing source files.
  if (process.argv.includes('--isolate')) {
    for (const [label, css] of [
      ['without-glows','.ambient::before,.ambient::after{display:none!important}'],
      ['without-lines','.ambient-lines{display:none!important}'],
      ['without-particles','.ambient-particles{display:none!important}'],
    ]) {
      await evaluate(`(()=>{const s=document.createElement('style');s.id='audit-style';s.textContent=${JSON.stringify(css)};document.head.append(s)})()`);
      samples.push(await sample(label));
      await evaluate(`document.getElementById('audit-style').remove()`);
    }
  }
  await evaluate(`document.getElementById('theme-toggle').click()`);
  samples.push(await sample('desktop-light'));
  const checks = {};
  checks.theme = await evaluate(`document.getElementById('app-shell').classList.contains('theme-light')`);
  checks.themeIcon = await evaluate(`getComputedStyle(document.getElementById('theme-icon-light')).display!=='none' && getComputedStyle(document.getElementById('theme-icon-dark')).display==='none'`);
  await evaluate(`document.getElementById('home-cta').click();document.getElementById('mode-link').click()`);
  checks.analysisMode = await evaluate(`document.getElementById('view-analizar').classList.contains('active') && document.getElementById('mode-link').getAttribute('aria-pressed')==='true'`);
  await evaluate(`document.getElementById('analyze-submit').click()`);
  checks.result = await evaluate(`document.getElementById('view-resultado').classList.contains('active')`);
  await evaluate(`showView('aprender');document.querySelector('[data-filter="banca"]').click()`);
  checks.filter = await evaluate(`[...document.querySelectorAll('.case-card')].filter(c=>!c.hidden).every(c=>c.dataset.category.split(' ').includes('banca'))`);
  await evaluate(`showView('reportar');document.getElementById('report-type').value='mensaje';document.getElementById('report-medium').value='sms';document.getElementById('report-description').value='Mensaje de prueba para verificar el formulario.';document.getElementById('report-form').requestSubmit()`);
  checks.report = await evaluate(`document.getElementById('report-confirmation').classList.contains('active')`);
  await evaluate(`showView('inicio')`);
  await call('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true });
  samples.push(await sample('mobile'));
  checks.mobileHeroFits = await evaluate(`[...document.querySelectorAll('.hero > *, .hero h1, .hero-description')].every(e=>e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().right<=innerWidth+1)`);
  checks.mobileBackgroundMoves = await evaluate(`new Promise(resolve=>{const layer=document.querySelector('.ambient-lines');const before=getComputedStyle(layer,'::before').transform;setTimeout(()=>resolve(before!==getComputedStyle(layer,'::before').transform),150)})`);
  await evaluate(`document.getElementById('mobile-toggle').click()`);
  checks.mobileMenu = await evaluate(`document.getElementById('main-nav').classList.contains('open')`);
  await evaluate(`document.querySelector('[data-view="acerca"]').click()`);
  checks.menuCloses = await evaluate(`!document.getElementById('main-nav').classList.contains('open') && document.getElementById('view-acerca').classList.contains('active')`);
  checks.noHorizontalOverflow = await evaluate(`document.documentElement.scrollWidth<=innerWidth`);
  await evaluate(`showView('aprender');window.scrollTo({top:500,behavior:'instant'})`);
  checks.scroll = await evaluate(`scrollY>0`);
  await call('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
  checks.reducedMotion = await evaluate(`document.getAnimations().every(a=>a.playState!=='running')`);
  checks.noRuntimeErrors = errors.length === 0;
  const report = { date:new Date().toISOString(), environment:'Chrome headless; 3-second samples; deviceScaleFactor 1; no CPU throttling', samples, checks, errors };
  await writeFile(output, JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if (Object.values(checks).some(x=>!x)) process.exitCode=1;
} finally {
  try { await call('Browser.close', {}, undefined); } catch {}
  browser.kill();
}
