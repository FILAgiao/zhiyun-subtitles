const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { parseTime } = require('./zhiyun-subtitles.user.js');
function option(name, fallback) { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; }
const adapterPath = path.resolve(option('--adapter', 'classroom-media.js'));
const reportPath = option('--report', '');
// Structure-only reconstruction. Words, URLs, identifiers and times are synthetic.
// This test never loads the private course snapshot.
const emptyTabs = '<div class="el-tabs__content"><div id="pane-voice" class="el-tab-pane"></div><div id="pane-ppt" class="el-tab-pane" style="display:none"></div></div>';
const row = text => '<div class="trans-item"><!----> <div class="trans-lan"><div>' + text + '</div><div></div></div></div>';
const captions = count => '<div class="trans-contain">' + Array.from({ length: count }, (_, index) => row('Synthetic caption ' + (index + 1))).join('') + '</div>';
const thumb = page => '<div class="student-list"><div class="video-item"><img' + (page ? ' src="https://slides.test/' + page + '.jpg"' : '') + '><div class="user-name">PPT</div><p class="tag"><span>PPT</span></p></div></div>';
const notes = count => '<div class="note-scroll_body">' + Array.from({ length: count }, (_, index) => '<div class="note-ppt_item"><div class="ppt_wrap"><div class="ppt_order">00:' + String(index).padStart(2, '0') + ':01</div><div class="ppt_time">' + (index + 1) + '</div><img lazy="loaded" src="https://slides.test/s_' + (index + 1) + '.jpg"><div class="ppt_mask"></div></div></div>').join('') + '</div>';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext();
  const results = [];
  try {
    await context.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }) : route.abort());
    const page = await context.newPage();
    await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/studentsrs?course_id=synthetic-course&sub_id=synthetic-lesson');
    await page.addScriptTag({ content: 'globalThis.parseCaptionTime = ' + parseTime.toString() + ';\n' + fs.readFileSync(adapterPath, 'utf8') });
    const read = () => page.evaluate(() => {
      const adapter = globalThis.ZYClassroomMedia, pane = adapter.voicePane(), slides = adapter.slides(globalThis.parseCaptionTime);
      return { pane: pane?.className || '', captions: adapter.voiceContent(pane, globalThis.parseCaptionTime).map(({ element, ...content }) => content), timed: adapter.voiceRows(pane, globalThis.parseCaptionTime), slides: slides.entries.map(({ image, ...entry }) => entry), activeIndex: slides.activeIndex, signature: slides.signature };
    });
    const check = async (name, fn) => {
      try { await fn(); results.push({ name, passed: true }); console.log('PASS: ' + name); }
      catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL: ' + name + '\n' + error.message); }
    };
    await check('empty tab shells do not hide 109 untimed sibling captions', async () => {
      await page.setContent(emptyTabs + captions(109)); const actual = await read();
      assert.equal(actual.pane, 'trans-contain'); assert.equal(actual.captions.length, 109); assert.equal(actual.captions.at(-1).original, 'Synthetic caption 109');
      assert.ok(actual.captions.every(caption => Number.isNaN(caption.start)), 'untimed socket text must not gain replay timestamps'); assert.deepEqual(actual.timed, []);
    });
    await check('empty PPT tab does not hide 17 note pages or the current full-size thumbnail', async () => {
      await page.setContent(emptyTabs + thumb(17) + notes(17)); const actual = await read();
      assert.equal(actual.slides.length, 17); assert.equal(actual.activeIndex, 16); assert.equal(actual.slides[16].url, 'https://slides.test/17.jpg');
      assert.deepEqual(actual.slides.map(slide => slide.time), Array.from({ length: 17 }, (_, index) => index * 60 + 1), 'ppt_order contains time; ppt_time contains the page number');
    });
    await check('a live thumbnail remains usable without a populated note list', async () => {
      await page.setContent(emptyTabs + thumb(3) + notes(0)); const actual = await read();
      assert.deepEqual(actual.slides, [{ url: 'https://slides.test/3.jpg', time: null }]); assert.equal(actual.activeIndex, 0);
    });
    await check('socket revisions and teacher page turns use the sibling resources', async () => {
      await page.setContent(emptyTabs + captions(2) + thumb(17) + notes(17)); const before = await read();
      await page.evaluate(() => { document.querySelector('.trans-item:last-child .trans-lan div').textContent = 'Revised current caption'; document.querySelector('.student-list img').src = 'https://slides.test/16.jpg'; });
      const after = await read(); assert.equal(after.captions.at(-1)?.original, 'Revised current caption'); assert.equal(after.activeIndex, 15); assert.equal(after.slides.length, 17); assert.equal(after.slides[15].url, 'https://slides.test/16.jpg'); assert.notEqual(after.signature, before.signature);
      await page.locator('.trans-contain').evaluate((node, html) => node.insertAdjacentHTML('beforeend', html), row('New socket caption')); assert.equal((await read()).captions.at(-1)?.original, 'New socket caption');
    });
    await check('empty placeholders and loading image data never count as PPT pages', async () => {
      await page.setContent(emptyTabs + captions(0) + thumb(0) + '<div class="note-scroll_body"><div class="note-ppt_item"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" lazy="loading"></div></div>'); const actual = await read();
      assert.deepEqual(actual.captions, []); assert.deepEqual(actual.slides, []); assert.equal(actual.activeIndex, -1);
    });
    await check('an empty spoken-language pane never falls through to unrelated search results', async () => {
      await page.setContent('<div class="spoken-language-body"><div class="voice-body_wrap"></div></div><div class="transform-wrapper"><div class="trans-list_wrap">' + row('Unrelated search result') + '</div></div>'); const actual = await read();
      assert.equal(actual.pane, 'voice-body_wrap'); assert.deepEqual(actual.captions, []); assert.deepEqual(actual.timed, []);
    });
    await check('an empty voice tab without live captions never admits unrelated search results', async () => {
      await page.setContent(emptyTabs + '<div class="transform-wrapper"><div class="trans-list_wrap">' + row('Unrelated search result') + '</div></div>'); const actual = await read();
      assert.equal(actual.pane, 'el-tab-pane'); assert.deepEqual(actual.captions, []); assert.deepEqual(actual.timed, []);
    });
    await check('populated replay panes keep priority over sibling resources', async () => {
      await page.setContent('<div id="pane-voice">' + row('Replay source') + '</div><div id="pane-ppt"><div class="tab-ppt"><img src="https://slides.test/replay.jpg"><span class="time">00:00:10</span></div></div>' + captions(2) + thumb(17) + notes(17)); const actual = await read();
      assert.deepEqual(actual.captions.map(caption => caption.original), ['Replay source']); assert.deepEqual(actual.slides, [{ url: 'https://slides.test/replay.jpg', time: 10 }]);
    });
  } finally { await context.close(); await browser.close(); }
  const failed = results.filter(result => !result.passed), report = { adapter: adapterPath, passed: results.length - failed.length, failed: failed.length, results };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ adapter: adapterPath, passed: report.passed, failed: report.failed })); assert.equal(failed.length, 0, failed.length + ' studentsrs DOM regression cases failed');
})().catch(error => { console.error(error); process.exitCode = 1; });
