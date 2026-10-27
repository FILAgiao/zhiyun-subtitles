const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const POSITION_KEY = 'ai-resume-position-v1';
const source = ['warm-theme.js', 'ai-learning.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
const fixture = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{margin:0;background:#f7f5f0;font:18px sans-serif}
  #host{position:fixed;inset:0;pointer-events:none}
  #under-resume{position:fixed;right:18px;bottom:24px;width:150px;height:44px}
</style><button id="under-resume">页面操作</button><div id="host"></div>`;
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const context = await browser.newContext({viewport:{width:1200,height:800}, hasTouch:true,isMobile:true});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://resume-drag.test/**', route => route.fulfill({contentType:'text/html',body:fixture}));
    await page.goto('https://resume-drag.test/');
    async function install(saved = {}) {
      await page.addScriptTag({content:source});
      await page.evaluate(initialSaved => {
        window.saved = initialSaved; window.positionWrites = 0; window.backgroundClicks = 0;
        document.querySelector('#under-resume').onclick = () => backgroundClicks++;
        const shadow = document.querySelector('#host').attachShadow({mode:'open'});
        shadow.innerHTML = '<button id="transcript-open" hidden>历史对话</button><div id="settings-ai" hidden></div>';
        window.mount = () => window.ai = ZhiyunLearning.mountLearningAssistant({
          shadow, getCourseId:() => 'resume-drag-course', getApiKey:() => 'local-test-session',
          getValue:(key, fallback) => saved[key] ?? fallback,
          setValue:(key, value) => {saved[key] = structuredClone(value); if(key === 'ai-resume-position-v1')positionWrites++;},
          request:options => {
            queueMicrotask(() => options.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'继续对话的已有回答'}]}]})}));
            return {abort(){}};
          }
        }); mount();
      }, saved);
    }
    await install();
    const host = page.locator('#host'), resume = host.locator('#ai-resume'), panel = host.locator('#ai-learning');
    const box = () => resume.boundingBox();
    const assertPosition = (actual, expected, message) => {
      assert.ok(Math.abs(actual.x - expected.x) < 2 && Math.abs(actual.y - expected.y) < 2, `${message}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
    };
    async function assertOnscreen(message) {
      await page.waitForFunction(() => {const el=document.querySelector('#host').shadowRoot.querySelector('#ai-resume'),r=el.getBoundingClientRect();return r.left>=7&&r.top>=7&&r.right<=innerWidth-7&&r.bottom<=innerHeight-7;},{},{timeout:3000});
      const b = await box(), viewport = await page.evaluate(() => ({width:innerWidth,height:innerHeight}));
      assert.ok(b.x >= 7 && b.y >= 7 && b.x + b.width <= viewport.width - 7 && b.y + b.height <= viewport.height - 7, `${message}: ${JSON.stringify(b)} in ${JSON.stringify(viewport)}`);
    }
    async function dragMouse(target, beforeMove) {
      const b = await box(), start = {x:b.x + b.width / 2, y:b.y + b.height / 2};
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      if(beforeMove)await beforeMove(b);
      await page.mouse.move(target.x, target.y, {steps:8}); await page.mouse.up();
    }
    await page.evaluate(async () => {await ai.send('继续对话的已有问题');ai.close();});
    const original = await box(), coveredPoint = {x:original.x + original.width / 2,y:original.y + original.height / 2};
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x,p.y).id, coveredPoint), 'host', 'the resume button initially covers the page control');
    // Real mouse movement retains capture outside the button without resuming the conversation.
    await dragMouse({x:240,y:220}, async before => {
      await resume.dispatchEvent('pointermove', {pointerId:99,isPrimary:false,clientX:20,clientY:20});
      assertPosition(await box(),before,'an unrelated pointer cannot move an active drag');
    });
    assert.equal(await panel.isVisible(), false, 'dragging must not open the conversation');
    const moved = await box(); assert.ok(moved.x < 300 && moved.y < 250, 'the button follows the mouse');
    const stored = await page.evaluate(key => saved[key], POSITION_KEY);
    assert.ok(Number.isFinite(stored.x) && Number.isFinite(stored.y), 'drag stores a finite position');
    await page.mouse.click(coveredPoint.x,coveredPoint.y);
    assert.equal(await page.evaluate(() => backgroundClicks),1,'the page control works after moving the button');
    // Normal click, slight hand movement, and keyboard activation keep working.
    await resume.click(); assert.equal(await panel.isVisible(),true);
    assert.match(await host.locator('#ai-log').textContent(),/继续对话的已有回答/);
    await host.locator('#ai-close').click(); assertPosition(await box(),moved,'close retains the button location');
    let b = await box(); await page.mouse.move(b.x + b.width / 2,b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 2,b.y + b.height / 2 + 1); await page.mouse.up();
    assert.equal(await panel.isVisible(),true,'small hand movement is still a click');
    await host.locator('#ai-close').click(); await resume.focus(); await page.keyboard.press('Enter');
    assert.equal(await panel.isVisible(),true,'keyboard activation resumes'); await host.locator('#ai-close').click();
    // GM position restores across component remount and page refresh; tab history restores too.
    await page.evaluate(() => {ai.destroy();mount();}); assertPosition(await box(),moved,'remount restores the location');
    const savedForRefresh = await page.evaluate(() => structuredClone(saved)); await page.reload(); await install(savedForRefresh);
    assertPosition(await box(),moved,'refresh restores the location'); await resume.click();
    assert.match(await host.locator('#ai-log').textContent(),/继续对话的已有回答/,'refresh preserves the tab conversation');
    const hiddenPosition = await page.evaluate(key => structuredClone(saved[key]),POSITION_KEY);
    await page.setViewportSize({width:900,height:600});
    assert.deepEqual(await page.evaluate(key => saved[key],POSITION_KEY),hiddenPosition,'hidden resize must not replace the position with a zero rectangle');
    await host.locator('#ai-close').click(); assertPosition(await box(),moved,'show restores the location after hidden resize');
    // Real Chrome touch events include the compatibility click following the gesture.
    assert.equal(await resume.evaluate(element => getComputedStyle(element).touchAction),'none');
    const cdp = await context.newCDPSession(page); b = await box();
    const touch = (x,y) => [{x,y,id:7,radiusX:1,radiusY:1}];
    // Space hardware touch samples so Chrome recognizes separate gestures reliably.
    const dispatchTouch = async event => {await cdp.send('Input.dispatchTouchEvent',event);await page.waitForTimeout(80);};
    await dispatchTouch({type:'touchStart',touchPoints:touch(b.x + b.width / 2,b.y + b.height / 2)});
    await dispatchTouch({type:'touchMove',touchPoints:touch(600,430)});
    await dispatchTouch({type:'touchEnd',touchPoints:[]});
    assert.equal(await panel.isVisible(),false,'touch drag must not trigger a compatibility click');
    b = await box(); assert.ok(b.x > 450 && b.y > 300,'the button follows a real touch drag');
    await dispatchTouch({type:'touchStart',touchPoints:touch(b.x + b.width / 2,b.y + b.height / 2)});await dispatchTouch({type:'touchEnd',touchPoints:[]});
    assert.equal(await panel.isVisible(),true,'a normal tap still resumes'); await host.locator('#ai-close').click();
    // Cancellation and blur clear the gesture instead of retaining later pointer moves.
    await resume.evaluate(el => el.addEventListener('pointerdown',e => window.canceledTouchId=e.pointerId,{once:true}));
    b = await box();
    await dispatchTouch({type:'touchStart',touchPoints:touch(b.x + 20,b.y + 20)});
    await dispatchTouch({type:'touchMove',touchPoints:touch(400,280)});
    await dispatchTouch({type:'touchCancel',touchPoints:[]});
    const canceled = await box(), canceledTouchId = await page.evaluate(() => window.canceledTouchId);
    await resume.dispatchEvent('pointermove',{pointerId:canceledTouchId,pointerType:'touch',isPrimary:true,clientX:100,clientY:100});
    assertPosition(await box(),canceled,'touch cancel clears the gesture'); assert.equal(await panel.isVisible(),false);
    await page.mouse.move(canceled.x + 20,canceled.y + 20); await page.mouse.down(); await page.mouse.move(200,180,{steps:4});
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const blurred = await box(); await page.mouse.move(700,500); await page.mouse.up();
    assertPosition(await box(),blurred,'window blur clears the gesture'); assert.equal(await panel.isVisible(),false);
    // Rendered dimensions, including CSS zoom, keep the whole button within the viewport.
    await dragMouse({x:890,y:590}); await assertOnscreen('bottom/right drag clamp');
    await page.setViewportSize({width:320,height:400}); await assertOnscreen('narrow viewport resize');
    await page.evaluate(() => {document.documentElement.style.zoom='1.25';window.dispatchEvent(new Event('resize'));});
    await assertOnscreen('root zoom clamp'); await dragMouse({x:319,y:399}); await assertOnscreen('root zoom drag clamp');
    await dragMouse({x:0,y:0}); await assertOnscreen('top/left drag clamp');
    await page.evaluate(() => document.documentElement.requestFullscreen()); await assertOnscreen('fullscreen clamp');
    await page.evaluate(() => document.exitFullscreen());
    // Destroy during a drag must remove both control and global listeners.
    b = await box(); await page.mouse.move(b.x + 20,b.y + 20); await page.mouse.down(); await page.mouse.move(150,160);
    const destroyedState = await page.evaluate(() => {
      window.removedResume=document.querySelector('#host').shadowRoot.querySelector('#ai-resume'); ai.destroy();
      return {position:structuredClone(saved['ai-resume-position-v1']),writes:positionWrites,style:removedResume.style.cssText};
    }); await page.mouse.up();
    await page.evaluate(() => {
      removedResume.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,isPrimary:true,clientX:20,clientY:20}));
      removedResume.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,isPrimary:true,clientX:200,clientY:200}));
      removedResume.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,button:0,isPrimary:true,clientX:200,clientY:200}));
      removedResume.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('blur'));
    });
    assert.equal(await resume.count(),0); assert.equal(await panel.count(),0);
    assert.deepEqual(await page.evaluate(() => ({position:saved['ai-resume-position-v1'],writes:positionWrites,style:removedResume.style.cssText})),destroyedState,'destroyed assistant cannot respond to detached controls or global events');
    assert.deepEqual(errors,[]);
    console.log('PASS: resume mouse/touch drag clears page controls; click/tap/keyboard resume; saved position restores; cancel/blur, resize/zoom/fullscreen, and destroy stay safe.');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});







