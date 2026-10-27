const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// All origins below are fulfilled locally. No website or paid AI service is used.
(async () => {
  const extensionMode = process.argv.includes('--extension');
  const extension = path.resolve('dist/extension');
  const source = path.resolve(process.env.AI_LEARNING_SOURCE || 'ai-learning.js');
  const viewport = { width: 1200, height: 900 };
  const browser = extensionMode ? null : await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  const context = extensionMode ? await chromium.launchPersistentContext(path.resolve('.test-media/middle-links-' + Date.now()), {
    headless: true, viewport,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
  }) : await browser.newContext({ viewport });
  let checks = 0, server;
  try {
    let worker;
    if (extensionMode) {
      worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
      await worker.evaluate(async () => {
        await chrome.storage.local.set({
          'gateway-guide-no-remind-v2': true,
          'gateway-account-v1': { url: 'https://47.77.182.216.sslip.io/gateway', token: 'fixture-middle-links' }
        });
        globalThis.captureCalls = 0;
        globalThis.aiCalls = 0;
        chrome.runtime.onMessage.addListener(message => { if (message?.type === 'zy-capture-visible') captureCalls++; });
        globalThis.fetch = async url => {
          if (/learning\/jobs|ark\/responses/.test(url)) { aiCalls++; throw Error('This test must not send AI requests'); }
          return new Response(JSON.stringify({ username: 'middle links fixture', permissions: { learning: true },
            capabilities: { web_search: false }, usage: { month: '2026-10', requests: 0, request_limit: 20 }, prompts: [] }),
          { headers: { 'Content-Type': 'application/json' } });
        };
      });
    }
    const slideSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#85bbef"/></svg>';
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;font:16px sans-serif;background:white}#targets{position:absolute;left:30px;top:30px;display:grid;grid-template-columns:repeat(3,190px);gap:15px}
      .target{display:block;height:46px;box-sizing:border-box;padding:10px;border:1px solid #ccc;color:#123;background:#eee}
      #pointer{cursor:pointer}#pointer span{cursor:auto}#ppt{position:absolute;left:710px;top:300px;width:320px;height:180px;cursor:pointer}
      #ppt-image{display:block;width:100%;height:100%;cursor:pointer}#ppt button{position:absolute;top:8px;left:8px}
      #blank{position:absolute;left:30px;top:590px;width:550px;height:180px;background:#dfe6eb}
    </style><div id="targets">
      <a id="anchor" class="target" href="/opened/anchor"><span>Ordinary anchor</span></a>
      <div id="pointer" class="target" data-open="pointer"><span>Script navigation card</span></div>
      <div id="role-link" class="target" role="link" data-open="role-link"><span>ARIA link</span></div>
      <div id="role-button" class="target" role="button"><span>ARIA button</span></div>
      <button id="button" class="target"><span>Native button</span></button>
      <label class="target">Input <input id="input" style="width:80px"></label>
      <a id="shadow-anchor" class="target" href="/opened/shadow"><span id="shadow-host"></span></a>
      <div id="slot-host" class="target"><span id="slotted">Slotted link text</span></div>
      <svg id="svg-link" class="target" viewBox="0 0 170 26"><a href="/opened/svg"><rect id="svg-hit" width="170" height="26" fill="#bce"/></a></svg>
      <div id="dynamic-anchor" class="target" role="link"><span id="dynamic-hit">Semantics change on press</span></div>
      <div id="prevented" class="target">Already handled by page</div>
      <div id="editable" class="target" contenteditable="true">Editable text</div>
    </div><div id="ppt"><img id="ppt-image" src="https://fixture-middle.example/slide.svg"><button id="ppt-action">PPT control</button></div>
    <div id="blank">Ordinary blank page area</div>`;
    // Native middle-click navigation can precede Playwright popup interception.
    // A real loopback server keeps even that first request completely local.
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      response.setHeader('Content-Type', pathname === '/slide.svg' ? 'image/svg+xml' : 'text/html; charset=utf-8');
      response.end(pathname === '/slide.svg' ? slideSvg : pathname.startsWith('/opened/') ? '<p>Opened local destination</p>' : html.replaceAll('https://fixture-middle.example', origin));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.hostname === 'fixture-middle.example') {
        return route.fulfill({ contentType: url.pathname === '/slide.svg' ? 'image/svg+xml' : 'text/html',
          body: url.pathname === '/slide.svg' ? slideSvg : url.pathname.startsWith('/opened/') ? '<p>Opened local destination</p>' : html });
      }
      if (url.hostname === 'interactivemeta.cmc.zju.edu.cn') return route.fulfill({ contentType: 'text/html',
        body: '<style>body{margin:0}video{width:640px;height:360px}#pane-ppt,#pane-voice{display:none}</style><video id="mainVideo" muted playsinline></video><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:00</div><div class="trans-lan"><div>PPT fixture</div></div></div></div><div id="pane-ppt"><div class="tab-ppt"><img src="https://fixture-middle.example/slide.svg"><span class="time">00:00:00</span></div></div>' });
      return route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(() => {
      document.querySelector('#shadow-host').attachShadow({ mode: 'open' }).innerHTML = '<span id="shadow-hit">Text across shadow root</span>';
      document.querySelector('#slot-host').attachShadow({ mode: 'open' }).innerHTML = '<a href="/opened/slot"><slot></slot></a>';
      window.events = [];
      for (const type of ['mousedown', 'mouseup', 'auxclick']) document.addEventListener(type, event => {
        if (event.button === 1) events.push({ type, prevented: event.defaultPrevented });
      });
      window.addEventListener('mousedown', event => { if (event.target.id === 'prevented') event.preventDefault(); }, true);
      document.querySelector('#dynamic-hit').addEventListener('mousedown', event => {
        if (event.button === 1) event.currentTarget.parentNode.removeAttribute('role');
      });
      document.addEventListener('auxclick', event => {
        const target = event.composedPath()[0];
        const route = target.closest?.('[data-open]')?.dataset.open || (target.id === 'dynamic-hit' ? 'dynamic' : null);
        if (event.button === 1 && route && !event.defaultPrevented) {
          event.preventDefault();
          window.open('/opened/' + route, '_blank');
        }
      });
    });
    if (!extensionMode) {
      await page.addScriptTag({ content: fs.readFileSync(source, 'utf8') });
      await page.evaluate(() => {
        const host = document.createElement('div'); host.id = 'zy-subtitle-host'; document.body.append(host);
        const shadow = host.attachShadow({ mode: 'open' }); shadow.innerHTML = '<div id="settings-ai" hidden></div>';
        const canvas = document.createElement('canvas'); canvas.width = innerWidth; canvas.height = innerHeight;
        canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
        window.captureCalls = 0; window.aiCalls = 0;
        window.ZYNativeCapture = { capture: async () => { captureCalls++; return canvas.toDataURL(); } };
        window.ai = ZhiyunLearning.mountLearningAssistant({ shadow, getApiKey: () => 'fixture',
          getSlide: () => ({ imageElement: document.querySelector('#ppt-image'), viewportElement: document.querySelector('#ppt') }),
          request: () => { aiCalls++; throw Error('This test must not send AI requests'); } });
      });
    }
    const host = page.locator('#zy-subtitle-host');
    await host.locator('#ai-question').waitFor({ state: 'attached' });
    const captures = () => extensionMode ? worker.evaluate(() => captureCalls) : page.evaluate(() => captureCalls);
    async function untouched(label, locator, opens) {
      await page.bringToFront();
      await page.evaluate(() => { events.length = 0; });
      const before = await captures();
      const popupPromise = opens ? context.waitForEvent('page', { timeout: 5000 }) : null;
      popupPromise?.catch(() => {});
      await locator.click({ button: 'middle' });
      assert.deepEqual(await page.evaluate(() => events.map(event => event.type)), ['mousedown', 'mouseup', 'auxclick'], label + ': complete page event sequence');
      assert.deepEqual(await page.evaluate(() => events.map(event => event.prevented)), label === 'already prevented mousedown' ? [true, false, false] : [false, false, false], label + ': extension preserves default browser behavior');
      assert.equal(await host.locator('#ai-crop').count(), 0, label + ': no screenshot selection');
      assert.equal(await captures(), before, label + ': no native capture');
      if (opens) {
        const popup = await popupPromise;
        await popup.waitForURL('**/opened/' + opens, { timeout: 5000, waitUntil: 'domcontentloaded' });
        await popup.close();
        await page.bringToFront();
      }
      checks++;
    }
    for (const [label, selector, destination] of [
      ['ordinary anchor', '#anchor span', 'anchor'],
      ['pointer script card with cursor:auto child', '#pointer span', 'pointer'],
      ['ARIA link', '#role-link span', 'role-link'],
      ['ARIA button', '#role-button span'], ['native button', '#button span'], ['native input', '#input'],
      ['anchor across shadow root', '#shadow-host #shadow-hit', 'shadow'],
      ['anchor across a slot', '#slotted', 'slot'], ['SVG anchor', '#svg-hit', 'svg'],
      ['link semantics removed after mousedown', '#dynamic-hit', 'dynamic'],
      ['editable field', '#editable'], ['already prevented mousedown', '#prevented'],
      ['semantic control over PPT', '#ppt-action']
    ]) await untouched(label, page.locator(selector), destination);
    assert.equal(await page.evaluate(() => {
      const event = new MouseEvent('auxclick', { button: 1, bubbles: true, composed: true, cancelable: true });
      document.querySelector('#blank').dispatchEvent(event); return event.defaultPrevented;
    }), false, 'standalone auxclick has no claimed screenshot gesture');
    checks++;
    await page.keyboard.down('Control');
    try { await untouched('modified middle click', page.locator('#blank')); }
    finally { await page.keyboard.up('Control'); }
    const toggle = host.locator('.ai-settings input[type="checkbox"]').first();
    await toggle.evaluate(input => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await untouched('middle screenshot setting disabled', page.locator('#blank'));
    await toggle.evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    // Positive controls: a click waits for a left selection, and a drag retains its own coordinates.
    let before = await captures();
    await page.mouse.click(100, 620, { button: 'middle' });
    await host.locator('#ai-crop-image').waitFor({ state: 'visible' });
    assert.equal(await host.locator('#ai-crop-preview').count(), 0, 'blank click must not fast-select the visible PPT');
    assert.equal(await captures(), before + 1);
    await host.locator('#ai-crop-cancel').click(); checks++;
    before = await captures();
    await page.mouse.move(100, 620); await page.mouse.down({ button: 'middle' });
    await host.locator('#ai-crop-selection').waitFor({ state: 'visible' });
    assert.equal(await captures(), before, 'capture waits until drag release');
    await page.mouse.move(420, 750, { steps: 8 }); await page.mouse.up({ button: 'middle' });
    await host.locator('#ai-crop-preview').waitFor();
    assert.deepEqual(await host.locator('#ai-crop-preview').boundingBox(), { x: 100, y: 620, width: 320, height: 130 });
    assert.equal(await captures(), before + 1);
    await host.locator('#ai-crop-cancel').click(); checks++;
    // Verify real PPT callbacks too: generic pages have no PPT callback in the extension.
    let pptPage = page, pptHost = host, image = page.locator('#ppt-image'), slide = page.locator('#ppt');
    if (extensionMode) {
      pptPage = await context.newPage(); pptPage.setDefaultTimeout(12000);
      pptPage.on('pageerror', error => errors.push(error.message));
      await pptPage.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=middle-links&sub_id=1');
      pptHost = pptPage.locator('#zy-subtitle-host'); await pptHost.waitFor();
      const videoPath = path.resolve('.test-media/lecture.mp4');
      assert.ok(fs.existsSync(videoPath), 'Run npm run test:media before the MV3 classroom regression');
      await pptPage.evaluate(async src => {
        const video = document.querySelector('#mainVideo'); video.src = src; await video.play(); video.pause();
        Object.defineProperties(video, { duration: { get: () => 3600 }, currentTime: { get: () => 0 }, paused: { get: () => true } });
      }, 'data:video/mp4;base64,' + fs.readFileSync(videoPath).toString('base64'));
      await pptHost.locator('#show-slides').click();
      image = pptHost.locator('#slide-image'); slide = pptHost.locator('#slide-viewport');
      await image.waitFor({ state: 'visible' });
    }
    await pptPage.bringToFront();
    await image.evaluate(async element => { try { await element.decode(); } catch (error) { throw Error(error.message + ': ' + element.currentSrc); } element.style.cursor = 'pointer'; });
    await slide.evaluate(element => { element.style.cursor = 'pointer'; });
    const box = await slide.boundingBox(); before = await captures();
    await image.click({ button: 'middle', position: { x: 140, y: 110 } });
    await pptHost.locator('#ai-crop-preview').waitFor({ timeout: 12000 });
    assert.deepEqual(await pptHost.locator('#ai-crop-preview').boundingBox(), box, 'real PPT hit remains full-slide quick selection despite pointer cursor');
    assert.equal(await captures(), before + 1);
    await pptHost.locator('#ai-crop-cancel').click(); checks++;
    assert.equal(extensionMode ? await worker.evaluate(() => aiCalls) : await page.evaluate(() => aiCalls), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: ' + checks + ' middle-link scenarios (' + (extensionMode ? 'actual Edge MV3 + native capture' : path.relative(process.cwd(), source)) + '): real new tabs, complete page events, semantic/pointer/shadow/slot/SVG/dynamic links, disabled and modified gestures, blank/drag/PPT screenshots.');
  } finally { await context.close(); await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
