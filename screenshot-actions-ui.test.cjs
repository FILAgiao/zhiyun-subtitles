const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');

const COURSE = 'screenshot-actions-course';
const artifactVersion = process.env.SCREENSHOT_VERSION || JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const source = fs.readFileSync('warm-theme.js', 'utf8') + '\n' + fs.readFileSync('ai-learning.js', 'utf8');

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors = [];
  fs.mkdirSync('.test-media', {recursive: true});
  async function mount({session = null, saved = {}, delayedPrompts = false} = {}) {
    const page = await browser.newPage({viewport: {width: 1200, height: 900}});
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://screenshot-actions.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>截图交互验收</title><style>body{margin:0;background:#fff}#host{position:fixed;inset:0;pointer-events:none}</style><div id="host"></div>'}));
    await page.goto('https://screenshot-actions.test/lesson');
    await page.addScriptTag({content: source});
    await page.evaluate(({course, session, saved, delayedPrompts}) => {
      window.saved = saved;
      window.course = course;
      const catalog = {prompts: [{id: 'default', label: '默认讲解', prompt: '解释图片内容。', scope: 'official'}]};
      const promptStore = delayedPrompts ? {account: () => 'local-owner', list: () => new Promise(resolve => {window.resolveCatalog = () => resolve(catalog);})} : null;
      window.calls = [];
      window.captureCalls = 0;
      window.shares = 0;
      if (session) sessionStorage.setItem('zhiyun-ai-tab-v1:' + course, JSON.stringify(session));
      const shadow = document.querySelector('#host').attachShadow({mode: 'open'});
      shadow.innerHTML = '<style>[hidden]{display:none!important}</style>';
      const frame = document.createElement('canvas');
      frame.width = 1200; frame.height = 900;
      const context = frame.getContext('2d');
      context.fillStyle = '#fff7df'; context.fillRect(0, 0, frame.width, frame.height);
      context.fillStyle = '#325b70'; context.font = '32px sans-serif'; context.fillText('Native screenshot fixture', 140, 180);
      window.ZYNativeCapture = {capture: async () => {captureCalls++; return frame.toDataURL('image/png');}};
      Object.defineProperty(navigator, 'mediaDevices', {value: {getDisplayMedia: async () => {shares++; throw Error('Screenshot actions must not start sharing');}}, configurable: true});
      window.assistant = ZhiyunLearning.mountLearningAssistant({
        shadow, promptStore, getApiKey: () => 'local-mock-session', getCourseId: () => window.course, getCourseTitle: () => '截图交互测试课程',
        getValue: (key, fallback) => Object.hasOwn(window.saved, key) ? window.saved[key] : fallback,
        setValue: (key, value) => window.saved[key] = value,
        request: options => {
          calls.push(JSON.parse(options.data));
          queueMicrotask(() => options.onload({status: 200, responseText: JSON.stringify({output: [{type: 'message', content: [{type: 'output_text', text: '已直接收到截图并解释。'}]}]})}));
          return {abort() {}};
        }
      });
    }, {course: COURSE, session, saved, delayedPrompts});
    return {page, host: page.locator('#host')};
  }
  async function crop(page, host) {
    await page.mouse.move(120, 100);
    await page.mouse.down({button: 'middle'});
    await host.locator('#ai-crop').waitFor({state: 'visible'});
    await page.mouse.move(Math.min(600, page.viewportSize().width - 24), 360, {steps: 8});
    await page.mouse.up({button: 'middle'});
    await host.locator('#ai-crop-preview').waitFor();
    assert.equal(await host.locator('#ai-crop-send').innerText(), '新对话提问');
  }
  async function finished(page) {
    await page.waitForFunction(() => calls.length === 1 && document.querySelector('#host').shadowRoot.querySelector('#ai-learning').getAttribute('aria-busy') === 'false');
  }
  const history = marker => [{role: 'user', text: marker + '_QUESTION'}, {role: 'assistant', text: marker + '_ANSWER'}];
  const indexed = (id, origin = COURSE) => ({id, origin, title: id, course: '测试课程', source: '文字提问', updated: Date.now()});
  try {
    // There is always a working new-conversation action, with no dead continuation button.
    {
      const {page, host} = await mount();
      await crop(page, host);
      assert.equal(await host.locator('#ai-crop-use').isHidden(), true, 'no conversation means no continue action');
      assert.equal(await host.locator('#ai-crop-send').isEnabled(), true);
      await host.locator('#ai-crop-send').click();
      await finished(page);
      assert.equal(await host.locator('#ai-crop').count(), 0);
      assert.equal(await host.locator('#ai-attachment').isVisible(), false, 'no second composer submission is needed');
      assert.equal(await page.evaluate(() => calls[0].input.at(-1).content.filter(item => item.type === 'input_image').length), 1);
      await page.close();
    }
    // A draft, attached image, or assistant-only session is not a real previous conversation.
    {
      const {page, host} = await mount();
      await page.evaluate(() => assistant.capturePage());
      await host.locator('#ai-attachment').waitFor();
      await host.locator('#ai-question').fill('尚未发送的草稿');
      await crop(page, host);
      assert.equal(await host.locator('#ai-crop-use').isHidden(), true, 'unsent content does not enable continue');
      await host.locator('#ai-crop-cancel').click();
      assert.equal(await page.evaluate(() => calls.length), 0);
      await page.close();
      const assistantOnly = await mount({session: {history: [{role: 'assistant', text: '没有用户提问'}], open: false}});
      await crop(assistantOnly.page, assistantOnly.host);
      assert.equal(await assistantOnly.host.locator('#ai-crop-use').isHidden(), true);
      await assistantOnly.page.keyboard.press('Escape');
      assert.equal(await assistantOnly.page.evaluate(() => calls.length), 0);
      await assistantOnly.page.close();
    }
    // Index entries alone cannot enable continuation.
    {
      const {page, host} = await mount({saved: {
        'ai-question-index-v1': [indexed('missing'), indexed('empty'), indexed('other', 'other-course')],
        'ai-question-v1:empty': {history: [], origin: COURSE},
        'ai-question-v1:other': {history: history('OTHER_COURSE'), origin: 'other-course'}
      }});
      await crop(page, host);
      assert.equal(await host.locator('#ai-crop-use').isHidden(), true, 'stale index cannot expose a dead continue action');
      await host.locator('#ai-crop-cancel').click();
      assert.equal(await page.evaluate(() => calls.length), 0);
      await page.close();
    }
    // Current history resumes immediately, including when its panel was closed.
    {
      const {page, host} = await mount({session: {history: history('CURRENT_HISTORY'), conversationTitle: '当前问题', open: false}});
      await crop(page, host);
      assert.equal(await host.locator('#ai-crop-use').isVisible(), true);
      assert.equal(await host.locator('#ai-crop-use').isEnabled(), true);
      await host.locator('#ai-crop-use').click();
      await finished(page);
      const input = await page.evaluate(() => JSON.stringify(calls[0].input));
      assert.match(input, /CURRENT_HISTORY_QUESTION/);
      assert.match(input, /CURRENT_HISTORY_ANSWER/);
      assert.equal(await host.locator('#ai-learning').isVisible(), true);
      assert.equal(await host.locator('#ai-crop').count(), 0);
      await page.close();
    }
    // A broken newest index entry must not hide a usable archive from this course.
    {
      const {page, host} = await mount({saved: {
        'ai-question-index-v1': [indexed('missing'), indexed('other', 'other-course'), indexed('valid')],
        'ai-question-v1:other': {history: history('OTHER_COURSE'), origin: 'other-course'},
        'ai-question-v1:valid': {history: history('SAME_COURSE_ARCHIVE'), title: '同课程旧问题', origin: COURSE, course: '测试课程'}
      }});
      await crop(page, host);
      assert.equal(await host.locator('#ai-crop-use').isEnabled(), true);
      await host.locator('#ai-crop-use').click();
      await finished(page);
      const input = await page.evaluate(() => JSON.stringify(calls[0].input));
      assert.match(input, /SAME_COURSE_ARCHIVE_QUESTION/);
      assert.doesNotMatch(input, /OTHER_COURSE/);
      await page.close();
    }
    // The request includes real annotation pixels and excludes old conversation history.
    {
      const {page, host} = await mount({session: {history: history('OLD_HISTORY'), conversationTitle: '旧问题', open: false}});
      await crop(page, host);
      await host.locator('#ai-crop-draw').click();
      await host.locator('#ai-crop-circle').click();
      const box = await host.locator('#ai-crop-preview').boundingBox();
      await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down();
      await page.mouse.move(box.x + 280, box.y + 170, {steps: 6}); await page.mouse.up();
      await host.locator('#ai-crop-send').evaluate(button => {button.click(); button.click();});
      await finished(page);
      const request = await page.evaluate(() => calls[0]);
      assert.doesNotMatch(JSON.stringify(request.input), /OLD_HISTORY/);
      const image = request.input.at(-1).content.find(item => item.type === 'input_image').image_url;
      const pixels = await page.evaluate(async src => {
        const image = new Image(); image.src = src; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let red = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] < 110 && data[i + 2] < 110) red++;
        return {width: canvas.width, height: canvas.height, red};
      }, image);
      assert.deepEqual([pixels.width, pixels.height], [480, 260], 'submitted image preserves the selected bounds');
      assert.ok(pixels.red > 100, 'the AI request includes the composited red circle');
      assert.equal(await page.evaluate(() => calls.length), 1, 'repeated clicks submit exactly once');
      assert.equal(await host.locator('#ai-attachment').isVisible(), false);
      await page.close();
    }
    {
      const {page, host} = await mount();
      await crop(page, host);
      await host.locator('#ai-crop-draw').click();
      await host.locator('#ai-crop-cancel').click();
      assert.equal(await page.evaluate(() => calls.length), 0, 'cancelling never submits a model request');
      assert.equal(await page.evaluate(() => shares), 0);
      await page.close();
    }
    // Optional notes stay beside collection, remain usable on narrow screens, and Escape dismisses them first.
    {
      const {page, host} = await mount();
      await page.setViewportSize({width: 375, height: 844});
      await crop(page, host);
      assert.equal(await host.locator('#ai-clip-title').isHidden(), true);
      assert.equal(await host.locator('#ai-clip-note').isHidden(), true);
      assert.equal(await host.locator('#ai-clip-details summary').innerText(), '备注');
      const summary = await host.locator('#ai-clip-details summary').boundingBox();
      const favorite = await host.locator('#ai-crop-save').boundingBox();
      assert.ok(Math.abs((summary.y + summary.height / 2) - (favorite.y + favorite.height / 2)) < 15, 'notes are alongside collection');
      await page.screenshot({path: '.test-media/screenshot-actions-' + artifactVersion + '.png'});
      await host.locator('#ai-clip-details summary').click();
      await host.locator('#ai-clip-title').fill('窄屏可选标题');
      await host.locator('#ai-clip-note').fill('窄屏可选备注');
      const editor = await host.locator('.ai-clip-editor').boundingBox();
      assert.ok(editor.x >= 0 && editor.y >= 0 && editor.x + editor.width <= 376 && editor.y + editor.height <= 845, 'notes editor fits the narrow viewport');
      assert.equal(await host.locator('.ai-crop-actions').evaluate(node => node.scrollWidth <= node.clientWidth), true, 'action controls are not clipped');
      await page.screenshot({path: '.test-media/screenshot-notes-' + artifactVersion + '.png'});
      await page.keyboard.press('Escape');
      assert.equal(await host.locator('#ai-clip-details').evaluate(node => node.open), false);
      assert.equal(await host.locator('#ai-crop-preview').isVisible(), true, 'first Escape closes only notes');
      await host.locator('#ai-clip-details summary').click();
      assert.equal(await host.locator('#ai-clip-title').inputValue(), '窄屏可选标题');
      assert.equal(await host.locator('#ai-clip-note').inputValue(), '窄屏可选备注');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      assert.equal(await host.locator('#ai-crop').count(), 0);
      assert.equal(await page.evaluate(() => calls.length), 0);
      await page.close();
    }
    // An awaited prompt catalog cannot resurrect a screenshot after reset, course change, or teardown.
    for (const action of ['stop', 'collapse', 'reset', 'switch', 'destroy']) {
      const {page, host} = await mount({delayedPrompts: true});
      await crop(page, host);
      await host.locator('#ai-crop-send').click();
      assert.equal(await page.evaluate(() => calls.length), 0);
      if (action === 'stop') await host.locator('#ai-stop').click();
      else if (action === 'collapse') await host.locator('#ai-close').click();
      else await page.evaluate(action => {
        if (action === 'reset') assistant.resetCourse();
        if (action === 'switch') {window.course = 'changed-course'; assistant.switchCourse();}
        if (action === 'destroy') assistant.destroy();
      }, action);
      await page.evaluate(async () => {resolveCatalog(); await new Promise(resolve => setTimeout(resolve, 0));});
      assert.equal(await page.evaluate(() => calls.length), 0, action + ' prevents a late screenshot submission');
      if (action === 'collapse') assert.equal(await host.locator('#ai-learning').isVisible(), false, 'late prompt catalog keeps the conversation closed');
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: screenshot actions hide unavailable history, validate same-course archives, send annotated pixels once, start clean new conversations, and cancel without model requests. All AI replies are local mocks.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});

