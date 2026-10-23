const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { parseTime } = require('./zhiyun-subtitles.user.js');

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}
const adapterPath = path.resolve(option('--adapter', 'classroom-media.js'));
const reportPath = option('--report', '');
const time = (value, cls = 'item-time') => `<p class="${cls}"><img alt="">${value}</p>`;
const card = (text, innerTime = '') => `<div class="trans-item">${innerTime}<div class="item-origin">${text}</div><div class="item-tanslate-En">Translation: ${text}</div></div>`;
const pane = html => `<div class="spoken-language-body"><div class="voice-body_wrap"><div class="trans-list_wrap">${html}</div></div></div>`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext();
  const results = [];
  try {
    // All page requests are handled locally. No authenticated browser or live course is used.
    await context.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
      : route.abort());
    const page = await context.newPage();
    const read = () => page.evaluate(() => {
      const adapter = globalThis.ZYClassroomMedia;
      const scope = adapter.voicePane();
      return {
        content: adapter.voiceContent(scope, globalThis.parseCaptionTime).map(({ element, ...row }) => row),
        rows: adapter.voiceRows(scope, globalThis.parseCaptionTime)
      };
    });
    const check = async (name, fn) => {
      try { await fn(); results.push({ name, passed: true }); console.log('PASS: ' + name); }
      catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL: ' + name + '\n' + error.message); }
    };
    for (const route of ['livingroom', 'livingpage']) {
      await page.goto(`https://classroom.zju.edu.cn/${route}?course_id=89629&sub_id=2023146&tenant_code=112`);
      await page.addScriptTag({ content: 'globalThis.parseCaptionTime = ' + parseTime.toString() + ';\n' + fs.readFileSync(adapterPath, 'utf8') });
      await check(route + ': shared school sibling timestamps skip whitespace and comments', async () => {
        await page.setContent(pane(time('00:10:21') + '\n \t<!-- Vue boundary -->\n' + card('Calculate an average score.') + time('00:10:31') + '\n<!-- another boundary -->\n' + card('All members receive the same score.')));
        const actual = await read();
        assert.deepEqual(actual.rows, [
          { start: 621, original: 'Calculate an average score.', translation: 'Translation: Calculate an average score.' },
          { start: 631, original: 'All members receive the same score.', translation: 'Translation: All members receive the same score.' }
        ]);
      });
      await check(route + ': nested timestamps and legacy trans-lan remain supported', async () => {
        await page.setContent(pane(card('Nested', time('00:00:10')) + '<div class="trans-item"><p class="item-title">00:00:20</p><div class="trans-lan"><p>Legacy original</p><p>Legacy translation</p></div></div>'));
        assert.deepEqual((await read()).rows, [
          { start: 10, original: 'Nested', translation: 'Translation: Nested' },
          { start: 20, original: 'Legacy original', translation: 'Legacy translation' }
        ]);
      });
      await check(route + ': item-title siblings remain supported', async () => {
        await page.setContent(pane(time('00:00:30', 'item-title') + card('Sibling title')));
        assert.equal((await read()).rows[0]?.start, 30);
      });
      await check(route + ': missing, invalid, and separated timestamps never inherit another row', async () => {
        await page.setContent(pane(time('00:00:10') + card('Valid') + card('Missing') + time('not a timestamp') + card('Invalid') + time('00:00:40') + '<div class="separator">Other content</div>' + card('Separated')));
        const actual = await read();
        assert.equal(actual.content.length, 4);
        assert.deepEqual(actual.rows.map(row => [row.start, row.original]), [[10, 'Valid']]);
        for (const row of actual.content.slice(1)) assert.ok(Number.isNaN(row.start), row.original + ' must remain untimed');
      });
      await check(route + ': internal timestamp has priority, including an invalid internal timestamp', async () => {
        await page.setContent(pane(time('00:00:05') + card('Internal wins', time('00:00:10')) + time('00:00:20') + card('Internal invalid', time('not a timestamp'))));
        const actual = await read();
        assert.deepEqual(actual.rows.map(row => [row.start, row.original]), [[10, 'Internal wins']]);
        assert.ok(Number.isNaN(actual.content[1].start));
      });
      await check(route + ': independent search results are excluded from the spoken-language pane', async () => {
        await page.setContent('<div class="search-results">' + time('00:00:01') + card('Search hit') + '</div><div class="transform-wrapper"><div class="trans-list_wrap">' + time('00:00:02') + card('Alternate search result') + '</div></div>' + pane(time('00:00:10') + card('Lesson caption')));
        assert.deepEqual((await read()).rows.map(row => row.original), ['Lesson caption']);
      });
      await check(route + ': dynamic append, timestamp correction, and row removal are read fresh', async () => {
        await page.setContent(pane(time('00:00:10') + card('First')));
        assert.deepEqual((await read()).rows.map(row => row.start), [10]);
        await page.locator('.trans-list_wrap').evaluate((element, html) => element.insertAdjacentHTML('beforeend', html), time('00:00:30') + '\n<!-- appended boundary -->\n' + card('Appended'));
        assert.deepEqual((await read()).rows.map(row => [row.start, row.original]), [[10, 'First'], [30, 'Appended']]);
        await page.locator('.item-time').last().evaluate(element => { element.textContent = '00:00:35'; });
        assert.deepEqual((await read()).rows.map(row => row.start), [10, 35]);
        await page.locator('.trans-item').last().evaluate(element => { element.remove(); });
        assert.deepEqual((await read()).rows.map(row => row.original), ['First']);
      });
    }
  } finally {
    await context.close();
    await browser.close();
  }
  const failed = results.filter(result => !result.passed);
  const report = { adapter: adapterPath, passed: results.length - failed.length, failed: failed.length, results };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ adapter: adapterPath, passed: report.passed, failed: report.failed }));
  assert.equal(failed.length, 0, failed.length + ' caption DOM regression cases failed');
})().catch(error => { console.error(error); process.exitCode = 1; });
