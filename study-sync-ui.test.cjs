const assert = require('node:assert/strict');
const {chromium} = require('playwright');

// Exercise the full ordinary-page userscript, not a stand-alone mocked component.
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://study-sync.test/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<title>机器学习复习</title><style>body{font:20px sans-serif;padding:50px;background:#f4f0e9}</style><h1>课程资料</h1><p>OTHER_PAGE_CONTENT_MUST_NOT_UPLOAD</p>'
    }));
    await page.goto('https://study-sync.test/lesson');
    await page.evaluate(() => {
      window.saved = {
        'gateway-guide-no-remind-v2': true,
        'gateway-account-v1': {url: 'https://47.77.182.216.sslip.io/gateway', token: ''},
        'ark-api-key': 'LOCAL_PROVIDER_KEY_MUST_NOT_UPLOAD'
      };
      window.calls = [];
      window.failSave = false;
      window.fixtureAnswer = '梯度指出损失增加最快的方向，沿反方向小步更新参数，可以逐步降低损失。';
      window.fixtureProfile = {
        username: '学习同学',
        membership: {plan: 'pro', active: true, state: 'paid', expires: Math.floor(Date.now() / 1000) + 86400},
        permissions: {learning: true, translation: true, speech: true, learning_records: true, card_export: true},
        usage: {month: '2026-10', requests: 1, request_limit: 100, total_tokens: 30, audio_seconds: 0, audio_limit: 600}
      };
      window.GM_getValue = (key, fallback) => saved[key] ?? fallback;
      window.GM_setValue = (key, value) => saved[key] = structuredClone(value);
      window.GM_deleteValue = key => delete saved[key];
      window.GM_registerMenuCommand = () => {};
      window.GM_xmlhttpRequest = options => {
        calls.push({url: options.url, method: options.method, data: options.data, headers: {...options.headers}});
        const timer = setTimeout(() => {
          let result = {}, status = 200;
          if (options.url.endsWith('/auth/login')) {
            result = {...fixtureProfile, server_time: Math.floor(Date.now() / 1000), token: 'PRIVATE_SESSION_TOKEN'};
          } else if (options.url.endsWith('/me')) {
            result = {...fixtureProfile, server_time: Math.floor(Date.now() / 1000)};
          } else if (options.url.endsWith('/prompts')) {
            result = {prompts: []};
          } else if (options.url.endsWith('/learning/jobs/create')) {
            result = {id: 'study-sync-job'};
          } else if (options.url.endsWith('/learning/jobs/poll')) {
            result = {state: 'complete', text: fixtureAnswer, response: {status: 'completed', output: [
              {type: 'message', content: [{type: 'output_text', text: fixtureAnswer}]}
            ]}};
          } else if (options.url.endsWith('/study/conversations')) {
            if (failSave) {
              status = 503;
              result = {error: '测试中的服务暂不可用'};
            } else {
              const conversation = JSON.parse(options.data);
              result = {ok: true, conversation: {...conversation, updated: 1}};
            }
          }
          options.onload({status, responseText: JSON.stringify(result)});
        }, 5);
        return {abort() {clearTimeout(timer); options.onabort?.();}};
      };
    });
    await page.addScriptTag({path: 'zhiyun-subtitles.user.js'});
    const ui = page.locator('#zy-subtitle-host');
    const status = ui.locator('#ai-status');
    const saveButton = ui.locator('#ai-cloud-save');
    const cloudCalls = () => page.evaluate(() => calls.filter(call => call.url.endsWith('/study/conversations')));
    const waitForStatus = text => page.waitForFunction(text =>
      document.getElementById('zy-subtitle-host').shadowRoot.getElementById('ai-status').textContent.includes(text), text);

    await ui.locator('#account-open').evaluate(node => node.click());
    await ui.locator('#gateway-email').fill('student@example.test');
    await ui.locator('#gateway-password').fill('PRIVATE_LOGIN_PASSWORD');
    await ui.locator('#gateway-login').click();
    await page.waitForFunction(() =>
      document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-login-form').hidden);
    await ui.locator('#settings-close').click();
    await ui.locator('#web-ask').click();

    // Use the real screenshot attachment flow so exclusion of images is tested on
    // an actual archived image, rather than an empty-history serialization case.
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 240;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fbefcf'; context.fillRect(0, 0, 400, 240);
      context.fillStyle = '#234'; context.font = '26px sans-serif';
      context.fillText('Gradient descent', 30, 90);
      const image = canvas.toDataURL('image/png');
      const file = new File([Uint8Array.from(atob(image.split(',')[1]), char => char.charCodeAt(0))], 'local-slide.png', {type: 'image/png'});
      const clipboardData = new DataTransfer(); clipboardData.items.add(file);
      document.getElementById('zy-subtitle-host').shadowRoot.getElementById('ai-question').dispatchEvent(
        new ClipboardEvent('paste', {clipboardData, bubbles: true, composed: true, cancelable: true})
      );
    });
    await ui.locator('#ai-crop-preview').waitFor({state: 'visible'});
    await ui.locator('#ai-crop-conversation').selectOption('new');
    await ui.locator('#ai-crop-use').click();
    await ui.locator('#ai-attachment').waitFor({state: 'visible'});
    await ui.locator('#ai-question').fill('为什么梯度下降要沿梯度的反方向更新？');
    await ui.locator('#ai-send').click();
    await page.waitForFunction(() => {
      const root = document.getElementById('zy-subtitle-host').shadowRoot;
      return saved['ai-question-index-v1']?.length === 1 && root.getElementById('ai-learning').getAttribute('aria-busy') === 'false';
    });
    assert.match(await ui.locator('#ai-log').textContent(), /沿反方向小步更新/);
    assert.equal(await ui.locator('#ai-log .ai-message[data-role=user] img').count(), 1);
    assert.equal((await cloudCalls()).length, 0, 'answering and local archival must not silently upload to the study endpoint');
    const record = await page.evaluate(() => {
      const id = saved['ai-question-index-v1'][0].id;
      return {id, value: structuredClone(saved['ai-question-v1:' + id])};
    });
    assert.ok(record.value.history.some(turn => turn.image?.startsWith('data:image/')), 'the source screenshot must genuinely exist locally');

    await saveButton.click();
    await waitForStatus('已保存到学习账号');
    let writes = await cloudCalls();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].headers.Authorization, 'Bearer PRIVATE_SESSION_TOKEN', 'identity belongs in authenticated transport');
    const body = JSON.parse(writes[0].data);
    assert.equal(body.id, record.id);
    assert.deepEqual(Object.keys(body).sort(), ['course', 'history', 'id', 'origin', 'source', 'title']);
    assert.deepEqual(body.history.map(turn => turn.role), ['user', 'assistant']);
    for (const turn of body.history) {
      assert.deepEqual(Object.keys(turn).sort(), ['role', 'text'], 'cloud turns contain only role and text');
      assert.equal(typeof turn.text, 'string');
      assert.ok(turn.text.trim());
    }
    assert.doesNotMatch(writes[0].data, /data:image|base64|PRIVATE_SESSION_TOKEN|PRIVATE_LOGIN_PASSWORD|LOCAL_PROVIDER_KEY_MUST_NOT_UPLOAD|OTHER_PAGE_CONTENT_MUST_NOT_UPLOAD/);
    assert.ok(!Object.keys(body).some(key => /user_?id|owner|token|password|api_?key|image|screenshot/i.test(key)), 'the client must not choose a cloud owner or include credentials/attachments');
    await ui.locator('#ai-study-web').waitFor({state: 'visible'});
    const reviewLink = await ui.locator('#ai-study-web').getAttribute('href');
    assert.match(reviewLink, /^https:\/\//);
    assert.equal(reviewLink, 'https://47.77.182.216.sslip.io/gateway/study');
    assert.equal(await ui.locator('#ai-study-web').getAttribute('target'), '_blank');
    assert.match(await ui.locator('#ai-study-web').getAttribute('rel'), /noopener/);

    await saveButton.click();
    await waitForStatus('已保存到学习账号');
    writes = await cloudCalls();
    assert.equal(writes.length, 2);
    assert.equal(JSON.parse(writes[1].data).id, body.id, 'saving again updates the same conversation instead of creating duplicates');

    await page.evaluate(() => failSave = true);
    await saveButton.click();
    await waitForStatus('本机记录仍保留');
    assert.equal((await cloudCalls()).length, 3);
    assert.equal(await saveButton.isEnabled(), true, 'a failed save remains manually retryable');
    const afterFailure = await page.evaluate(id => saved['ai-question-v1:' + id], record.id);
    assert.deepEqual(afterFailure.history, record.value.history, 'a failed remote write must not destroy local text or screenshots');
    assert.deepEqual(afterFailure.lastAnswer, record.value.lastAnswer);
    await ui.locator('#ai-questions-back').click();
    await ui.locator('.ai-question-record').first().click();
    assert.match(await ui.locator('#ai-log').textContent(), /沿反方向小步更新/);
    assert.equal(await ui.locator('#ai-log .ai-message[data-role=user] img').count(), 1, 'failed uploads remain readable from the local archive');

    await ui.locator('#account-open').evaluate(node => node.click());
    await ui.locator('#gateway-logout').click();
    await ui.locator('#gateway-login-form').waitFor({state: 'visible'});
    await ui.locator('#settings-close').click();
    assert.equal(await ui.locator('#ai-learning').isVisible(), false);
    // Even a stale button event after logout must open login, not issue a write.
    await saveButton.evaluate(node => node.click());
    await ui.locator('#gateway-login-form').waitFor({state: 'visible'});
    assert.equal((await cloudCalls()).length, 3, 'logged-out clients must not issue study writes');
    assert.deepEqual(await page.evaluate(id => saved['ai-question-v1:' + id].history, record.id), record.value.history, 'logout preserves the existing local archive');
    assert.deepEqual(errors, []);
    assert.match(await status.textContent(), /本机记录仍保留|已打开历史问题/);
    console.log('PASS: explicit account save only; authenticated text-only payload; real screenshot kept local; repeat-save identity; web review link; failed-save recovery; logout write guard.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
