const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://ai-summary.test/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>程序设计课堂</title>'
    }));
    await page.goto('https://ai-summary.test/');
    await page.setContent('<!doctype html><style>body{margin:0;background:#edf3f2;font:18px sans-serif}.course{padding:48px;color:#254d50}#host{position:fixed;inset:0;pointer-events:none}</style><main class="course"><h1>程序设计 · 多态与继承</h1><p>问题摘要与对话恢复测试</p></main><div id="host"></div>');
    await page.addScriptTag({ path: 'ai-learning.js' });
    await page.evaluate(() => {
      const shadow = document.getElementById('host').attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>[hidden]{display:none!important}</style>';
      window.values = {};
      window.exchanges = [];
      window.aborts = 0;
      window.mount = () => ZhiyunLearning.mountLearningAssistant({
        shadow,
        getApiKey: () => 'summary-test-key',
        getCourseId: () => 'summary-course',
        getCourseTitle: () => '程序设计 · 多态与继承',
        getContext: () => '虚函数用于运行时多态。',
        getValue: (key, fallback) => values[key] ?? fallback,
        setValue: (key, value) => { values[key] = value; },
        request: options => {
          const exchange = { options, body: JSON.parse(options.data), raw: '', text: '' };
          exchanges.push(exchange);
          window.active = exchange;
          return { abort() { aborts++; options.onabort?.(); } };
        }
      });
      window.emit = delta => {
        active.text += delta;
        active.raw += 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta }) + '\n\n';
        active.options.onprogress({ status: 200, responseText: active.raw });
      };
      window.finish = (text = active.text) => {
        active.raw += 'data: ' + JSON.stringify({
          type: 'response.completed',
          response: { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
        }) + '\n\n';
        active.options.onprogress({ status: 200, responseText: active.raw });
      };
      window.assistant = mount();
      assistant.open();
    });

    const host = page.locator('#host');
    const log = host.locator('#ai-log');
    const records = host.locator('.ai-question-record');
    const short = text => Array.from(text).slice(0, 24).join('') + (Array.from(text).length > 24 ? '…' : '');
    const send = async (question, requestCount) => {
      await host.locator('#ai-question').fill(question);
      await host.locator('#ai-send').click();
      await page.waitForFunction(count => exchanges.length === count, requestCount);
    };
    const idle = () => page.waitForFunction(() => document.getElementById('host').shadowRoot.getElementById('ai-learning').getAttribute('aria-busy') === 'false');
    const snapshot = () => page.evaluate(() => {
      const index = values['ai-question-index-v1'];
      return { index, saved: values['ai-question-v1:' + index[0].id], session: JSON.parse(sessionStorage.getItem('zhiyun-ai-tab-v1:summary-course')) };
    });

    const question = '想请你用最简单的话说明虚函数如何实现运行时多态，以及边界条件与虚析构函数之间有什么关系？';
    const title = '虚函数与运行时多态';
    await send(question, 1);
    assert.match(await page.evaluate(() => exchanges[0].body.input[0].content), /首行只写 \{"title":"问题摘要"\}/);
    let state = await snapshot();
    assert.equal(state.index[0].title, short(question), 'before receiving a title, show a short local fallback');
    assert.equal(state.index[0].questions, question, 'retain the complete question for search');

    // A JSON header may arrive over several SSE deltas. Never flash it in the answer.
    await page.evaluate(() => emit('{"ti'));
    await page.waitForTimeout(110);
    assert.equal(await log.locator('[data-role="assistant"]').count(), 0);
    await page.evaluate(title => emit('tle":' + JSON.stringify(title) + '}\n'), title);
    await page.waitForTimeout(110);
    assert.equal(await log.locator('[data-role="assistant"]').count(), 0, 'a title alone is metadata, not an answer');
    await page.evaluate(() => emit('多态让同一个调用呈现不同实现。\n\n'));
    await page.waitForFunction(() => document.getElementById('host').shadowRoot.querySelector('.ai-stream-text')?.textContent.includes('不同实现'));
    assert.doesNotMatch(await log.textContent(), /"title"|虚函数与运行时多态/);
    await page.evaluate(() => emit('**例子**：基类指针调用派生类的虚函数。'));
    await page.waitForFunction(() => !!document.getElementById('host').shadowRoot.querySelector('.ai-stream-text strong'));
    await page.evaluate(() => finish());
    await idle();
    state = await snapshot();
    assert.equal(state.index[0].title, title);
    assert.equal(state.saved.title, title);
    assert.equal(state.session.conversationTitle, title);
    assert.doesNotMatch(state.saved.history.at(-1).text, /"title"/);
    assert.doesNotMatch(state.saved.lastAnswer.text, /"title"/);
    const firstId = state.index[0].id;

    await host.locator('#ai-questions-back').click();
    assert.equal(await records.locator('strong').textContent(), title);
    assert.equal(await records.getAttribute('title'), question, 'hover retains the original complete question');
    await host.locator('#ai-questions-search').fill('边界条件与虚析构函数');
    assert.equal(await records.count(), 1, 'words omitted from the title remain searchable');
    await records.click();

    await send('用一个最小 C++ 例子再解释一下', 2);
    assert.doesNotMatch(await page.evaluate(() => exchanges[1].body.input[0].content), /首行只写/);
    assert.doesNotMatch(await page.evaluate(() => exchanges[1].body.input.filter(turn => turn.role === 'assistant').map(turn => turn.content).join('\n')), /"title"/);
    await page.evaluate(() => { emit('通过基类指针调用虚函数，会选择实际对象的实现。'); finish(); });
    await idle();
    state = await snapshot();
    assert.equal(state.index[0].id, firstId);
    assert.equal(state.index[0].title, title);
    assert.equal(state.index[0].questionCount, 2);
    assert.equal(await page.evaluate(() => exchanges.length), 2, 'each question uses one model request, with no extra summary call');

    await page.evaluate(() => { assistant.destroy(); assistant = mount(); });
    assert.match(await log.textContent(), /实际对象的实现/);
    await send('再用一句话帮助我记忆', 3);
    assert.doesNotMatch(await page.evaluate(() => exchanges[2].body.input[0].content), /首行只写/);
    await page.evaluate(() => { emit('看实际对象，选对应实现。'); finish(); });
    await idle();
    assert.equal((await snapshot()).saved.title, title, 'remount restores the existing title without summarizing again');

    await host.locator('#ai-clear').click();
    await send('请解释虚析构函数为什么与继承有关，什么时候必须使用它？', 4);
    assert.match(await page.evaluate(() => exchanges[3].body.input[0].content), /首行只写/);
    await page.evaluate(() => emit('{"title":"继承中的虚析构函数"}\n停止前已经收到的部分回答。'));
    await page.waitForFunction(() => document.getElementById('host').shadowRoot.querySelector('.ai-stream-text')?.textContent.includes('停止前'));
    await host.locator('#ai-stop').click();
    await idle();
    state = await snapshot();
    assert.equal(state.saved.title, '继承中的虚析构函数');
    assert.equal(state.saved.history.at(-1).text, '停止前已经收到的部分回答。');
    assert.equal(await page.evaluate(() => aborts), 1);
    await page.evaluate(() => finish('{"title":"迟到标题"}\n迟到的正文。'));
    assert.doesNotMatch(await log.textContent(), /迟到|"title"/);

    await host.locator('#ai-clear').click();
    const interruptedQuestion = '这个问题只收到一部分标题就停止，应继续显示原问题的简短预览文字';
    await send(interruptedQuestion, 5);
    await page.evaluate(() => emit('{"title":"尚未完成'));
    await host.locator('#ai-stop').click();
    await idle();
    state = await snapshot();
    assert.equal(state.saved.title, '');
    assert.equal(state.index[0].title, short(interruptedQuestion));
    assert.equal(await log.locator('[data-role="assistant"]').count(), 0);

    // Legacy records do not have a saved title and must keep working with old replies.
    const legacyQuestion = '旧记录中的非常长的问题：我想知道模板与继承各自有什么适用场景，并保留搜索末尾独特关键词';
    await page.evaluate(legacyQuestion => {
      values['ai-question-v1:legacy'] = {
        history: [{ role: 'user', text: legacyQuestion }, { role: 'assistant', text: '旧版回答，仍可继续追问。' }],
        source: '文字提问', course: '程序设计 · 多态与继承', origin: 'summary-course', lastAnswer: null
      };
      values['ai-question-index-v1'].unshift({ id: 'legacy', title: legacyQuestion, questions: legacyQuestion, source: '文字提问', course: '程序设计 · 多态与继承', updated: Date.now() });
    }, legacyQuestion);
    await host.locator('#ai-questions-back').click();
    await host.locator('#ai-questions-search').fill('末尾独特关键词');
    assert.equal(await records.count(), 1);
    assert.equal(await records.locator('strong').textContent(), short(legacyQuestion));
    await records.click();
    assert.match(await log.textContent(), /旧版回答/);
    await send('现在换一个例子', 6);
    assert.match(await page.evaluate(() => exchanges[5].body.input[0].content), /首行只写/);
    await page.evaluate(() => { emit('旧式纯 Markdown 回答也可以继续显示。'); finish(); });
    await idle();
    assert.match(await log.textContent(), /旧式纯 Markdown/);
    state = await snapshot();
    assert.equal(state.index[0].id, 'legacy');
    assert.equal(state.index[0].title, short(legacyQuestion));
    assert.equal(await page.evaluate(() => exchanges.length), 6);

    await host.locator('#ai-questions-back').click();
    await host.locator('#ai-questions-search').fill('');
    fs.mkdirSync('.test-media', { recursive: true });
    await page.screenshot({ path: '.test-media/question-summary-preview.png' });
    assert.deepEqual(errors, []);
    await page.evaluate(() => assistant.destroy());
    console.log('PASS: streamed summary headers stay hidden; short searchable titles persist and restore; follow-ups use one request; legacy records, new conversations and stopping remain usable.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
