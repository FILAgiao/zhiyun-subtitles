const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

const fragment = [
  'CLK[clk_wiz_0<br/>时钟供电商] -->|时钟信号| MB[microblaze_0<br/>CPU大脑]',
  'CLK -->|时钟信号| UART[axi_uartlite_0<br/>串口办事员]',
  'CLK -->|时钟信号| BRAM_CTRL[axi_bram_ctrl_0<br/>RAM物业管家]',
  'MB <-->|AXI 读写总线<br/>指令/数据通道| BRAM_CTRL',
  'MB <-->|AXI 寄存器访问<br/>收发串口数据| UART',
  'BRAM_CTRL <-->|BRAM 专用接口<br/>真存储数据| BRAM_BLK[bram_block<br/>原生块RAM实体仓库]'
].join('\n');

const origin = 'https://47.77.182.216.sslip.io/gateway';
const fixture = 'https://mermaid-conversation.test/';
const fence = (source, language = 'mermaid') => '```' + language + '\n' + source + '\n```';

async function main() {
  const extension = path.resolve('dist/extension');
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    viewport: {width: 800, height: 850},
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async ({origin, fragment}) => {
      await chrome.storage.local.set({
        'gateway-guide-no-remind-v2': true,
        'gateway-account-v1': {url: origin, token: 'fixture-mermaid'}
      });
      globalThis.fixtureResponse = '时钟与总线\n\n```mermaid\n' + fragment + '\n```';
      globalThis.fixtureRequests = 0;
      globalThis.fetch = async url => {
        const api = String(url).slice(origin.length);
        const headers = {'Content-Type': 'application/json'};
        if (api === '/v1/me') {
          return new Response(JSON.stringify({
            username: '图表测试', permissions: {learning: true}, usage: {requests: 0, request_limit: 20}
          }), {headers});
        }
        if (api === '/v1/prompts') {
          return new Response(JSON.stringify({
            prompts: [{id: 'default', label: '默认讲解', prompt: '准确讲解。', scope: 'official'}]
          }), {headers});
        }
        if (api === '/v1/learning/jobs/create') {
          globalThis.fixtureRequests++;
          return new Response(JSON.stringify({id: 'fixture-job'}), {headers});
        }
        if (api === '/v1/learning/jobs/poll') {
          return new Response(JSON.stringify({
            state: 'complete',
            response: {output: [{type: 'message', content: [{type: 'output_text', text: globalThis.fixtureResponse}]}]}
          }), {headers});
        }
        return new Response('{}', {headers});
      };
    }, {origin, fragment});
    const page = context.pages()[0] || await context.newPage(), errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      if (route.request().url() === fixture) return route.fulfill({
        contentType: 'text/html',
        headers: {'Content-Security-Policy': "script-src 'none'; img-src 'none'"},
        body: '<h1>图表测试课堂</h1>'
      });
      unexpected.push(route.request().url());
      return route.abort();
    });
    await page.goto(fixture);
    const host = page.locator('#zy-subtitle-host');
    await host.waitFor();
    // The content script is isolated from the page. Drive the same assistant API as the launcher.
    const session = await context.newCDPSession(page), contexts = [];
    session.on('Runtime.executionContextCreated', ({context}) => {
      if (!context.auxData?.isDefault) contexts.push(context.id);
    });
    await session.send('Runtime.enable');
    let contextId;
    for (const id of contexts) {
      const result = await session.send('Runtime.evaluate', {contextId: id, expression: 'typeof ZYDiagram', returnByValue: true});
      if (result.result.value === 'object') contextId = id;
    }
    assert.ok(contextId, 'Mermaid is available inside the real MV3 content script');
    const evaluate = async expression => {
      const result = await session.send('Runtime.evaluate', {contextId, expression, awaitPromise: true, returnByValue: true});
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await host.getByRole('button', {name: 'AI对话', exact: true}).click();
    await host.locator('#ai-question').fill('画出时钟与总线的关系');
    await host.locator('#ai-send').click();

    const image = host.locator('#ai-log .ai-diagram img');
    await image.waitFor({timeout: 12000});
    const drawing = await image.evaluate(img => {
      const svg = new DOMParser().parseFromString(decodeURIComponent(img.src.split(',')[1]), 'image/svg+xml');
      return {
        nodes: svg.querySelectorAll('g.node').length,
        edges: svg.querySelectorAll('.flowchart-link').length,
        bothEnds: svg.querySelectorAll('.flowchart-link[marker-start][marker-end]').length,
        text: svg.documentElement.textContent,
        hasLineBreak: [...svg.querySelectorAll('text')].some(node => node.querySelectorAll('tspan').length > 1),
        decoded: img.complete && img.naturalWidth > 0,
        scrollable: img.parentNode.scrollWidth >= img.parentNode.clientWidth
      };
    });
    assert.equal(drawing.nodes, 5);
    assert.equal(drawing.edges, 6);
    assert.equal(drawing.bothEnds, 3);
    assert.match(drawing.text, /时钟供电商/);
    assert.match(drawing.text, /指令\/数据通道/);
    assert.ok(drawing.hasLineBreak && drawing.decoded && drawing.scrollable);
    assert.equal(await worker.evaluate(() => fixtureRequests), 1);
    await host.locator('#ai-questions-back').click();
    await host.locator('.ai-question-record').first().click();
    await image.waitFor({timeout: 12000});
    assert.equal(await worker.evaluate(() => fixtureRequests), 1, 'opening history does not ask the model again');

    const result = await evaluate(`(async () => {
      const host = document.getElementById('zy-subtitle-host').shadowRoot;
      const container = document.createElement('div');
      host.append(container);
      const text = ${JSON.stringify(fence('flowchart TD\nA --> B') + '\n\n' + fence('flowchart LR\nA --> [') + '\n\n' + fence('A --> B', 'text'))};
      await ZhiyunLearning.renderMarkdown(document, container, text);
      const complete = [container.querySelectorAll('.ai-diagram').length, container.querySelectorAll('pre').length, container.innerText];
      await ZhiyunLearning.renderMarkdown(document, container, ${JSON.stringify(fence(fragment))}, {renderDiagrams:false});
      const streaming = [container.querySelectorAll('.ai-diagram').length, container.querySelectorAll('pre').length];
      const stale = ZhiyunLearning.renderMarkdown(document, container, ${JSON.stringify(fence(fragment))});
      await ZhiyunLearning.renderMarkdown(document, container, '新的回答');
      await stale;
      const latest = container.textContent;
      const card = await ZYCardRender.render(document, async (fd, body) => {
        await ZhiyunLearning.renderMarkdown(fd, body, ${JSON.stringify(fence(fragment))}, {fitDiagrams:true});
        if (!body.querySelector('.ai-diagram img')?.naturalWidth) throw Error('Diagram missing from card');
      });
      const cardDrawn = card.canvas.width > 0 && card.height > 48;
      await ZhiyunLearning.renderMarkdown(document, container, ${JSON.stringify(fence('flowchart LR\nA-->B\nclick A "https://diagram-link.test/"'))});
      const svg = decodeURIComponent(container.querySelector('img').src.split(',')[1]);
      const inert = !container.querySelector('a') && !svg.includes('https://diagram-link.test/');
      container.remove();
      return {complete, streaming, latest, inert, cardDrawn};
    })()`);
    assert.deepEqual(result.complete.slice(0, 2), [1, 2]);
    assert.match(result.complete[2], /已保留源码/);
    assert.deepEqual(result.streaming, [0, 1]);
    assert.equal(result.latest, '新的回答');
    assert.ok(result.inert);
    assert.ok(result.cardDrawn);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log('PASS: MV3 AI conversation renders the original Mermaid fragment, preserves Chinese labels and bidirectional links, and falls back safely.');
  } finally {
    await context.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
