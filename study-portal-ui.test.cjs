const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

// Every gateway request is mocked. This test never needs live accounts or email.
const BASE_URL = process.env.ZY_STUDY_TEST_URL || 'http://127.0.0.1:5173';
const TOKEN = 'fixture-personal-study-session';
const unsafeText = '<script>window.__studyXss = 1</script><img src=x onerror="window.__studyXss=2">';
const created = Date.UTC(2026, 9, 20, 8);
const ownRecords = [
  { id: 'own-1', title: '虚函数：我的笔记', course: '程序设计', source: 'PPT 提问', origin: '', questionCount: 1, updated: created, created, history: [{role:'user',text:'虚函数为什么能实现多态？ '+unsafeText},{role:'assistant',text:'动态绑定会选择实际对象的方法。\n'+unsafeText+'\n```cpp\nvirtual void speak();\n```'}] },
  { id: 'own-2', title: '梯度下降复习', course: '机器学习', source: '文字提问', origin: '', questionCount: 1, updated: created - 1000, created, history: [{role:'user',text:'学习率太大时会怎样？'},{role:'assistant',text:'可能越过低点。'}] },
  { id: 'own-3', title: '接口与继承', course: '程序设计', source: '文字提问', origin: '', questionCount: 1, updated: created - 2000, created, history: [{role:'user',text:'接口和继承的关系？'},{role:'assistant',text:'接口约定可调用的方法。'}] }
];

(async () => {
  let browser, page;
  const calls = [], pageErrors = [], unexpected = [];
  let records = structuredClone(ownRecords);
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.ZY_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const origin = new URL(BASE_URL).origin;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const prefix = '/api/gateway/v1/';
      if (!url.pathname.startsWith(prefix)) {
        // Local assets are allowed; no remote account server is contacted.
        if (url.origin !== origin && /^https?:$/.test(url.protocol)) return route.abort('blockedbyclient');
        return route.continue();
      }
      const endpoint = url.pathname.slice(prefix.length), method = request.method();
      let body;
      try { body = request.postDataJSON(); } catch {}
      const call = {endpoint, method, query:url.search, body, auth:request.headers().authorization || ''};
      calls.push(call);
      const reply = (status, data) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if (endpoint === 'auth/login' && method === 'POST') return reply(200,{token:TOKEN});
      if (call.auth !== 'Bearer ' + TOKEN) {
        unexpected.push('missing personal token: '+method+' '+endpoint+url.search);
        return reply(401,{error:'未登录'});
      }
      if (endpoint === 'me') return reply(200,{username:'我的体验账号',email:'study-owner@example.test',membership:{plan:'free'},usage:{requests:0,request_limit:0}});
      if (endpoint === 'auth/logout' && method === 'POST') return reply(200,{ok:true});
      if (endpoint === 'study/conversations') {
        assert.equal(url.searchParams.has('user_id'),false,'the portal must use the authenticated account, not a caller-supplied owner');
        const id = url.searchParams.get('id');
        if (method === 'DELETE') {
          const exists = records.some(item => item.id === id);
          if (!exists) return reply(404,{error:'记录不存在'});
          records = records.filter(item => item.id !== id);
          return reply(200,{ok:true});
        }
        if (id) {
          const conversation = records.find(item => item.id === id);
          return conversation ? reply(200,{conversation}) : reply(404,{error:'记录不存在'});
        }
        return reply(200,{items:records.map(({history,...item})=>item),next_offset:null});
      }
      unexpected.push(method+' '+endpoint);
      return reply(501,{error:'Unexpected mocked route'});
    });
    await context.addInitScript(() => { window.__studyXss = 0; });
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE_URL,{waitUntil:'networkidle'});
    const fits = async label => assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label);
    await page.getByRole('heading',{name:'上课时，弄懂。 下课后，记得住。'}).waitFor({state:'visible'});
    await fits('desktop landing page overflow');
    assert.equal(await page.getByRole('navigation',{name:'主导航'}).getByRole('button').count(),2);
    assert.match(await page.locator('.hero-foot').textContent(),/基础看课免费/);
    await page.screenshot({path:path.join(__dirname,'site-landing-preview.png')});

    // Demo mode is clearly identified and must not contact the account API.
    await page.getByRole('button',{name:'我的问答',exact:true}).click();
    await page.getByRole('heading',{name:'你的问题，值得留下。'}).waitFor({state:'visible'});
    const beforeDemo = calls.length;
    await page.getByRole('button',{name:'看看示例',exact:true}).click();
    await page.locator('.demo-banner').waitFor({state:'visible'});
    assert.match(await page.locator('.demo-banner').textContent(),/示例模式/);
    await page.locator('.reader .turns').waitFor({state:'visible'});
    await page.getByRole('button',{name:'删除云端记录',exact:true}).click();
    await page.getByRole('status').filter({hasText:'这里是示例'}).waitFor({state:'visible'});
    assert.equal(calls.length,beforeDemo,'demo mode must not send gateway requests');
    await page.getByRole('button',{name:'登录查看我的记录 ↗',exact:true}).click();
    let dialog = page.getByRole('dialog');
    await dialog.waitFor({state:'visible'});
    assert.match(await dialog.locator('h2').textContent(),/欢迎回来/);
    const applyLink = dialog.getByRole('link',{name:'申请账号 ↗',exact:true});
    assert.equal(await applyLink.getAttribute('href'),'/account?tab=register');
    assert.equal(await dialog.locator('input[autocomplete="one-time-code"],input[autocomplete="new-password"]').count(),0,'manual account registration must not leave an email-code or new-password form');
    assert.equal(await dialog.getByRole('button',{name:'发送验证码',exact:true}).count(),0);
    await dialog.getByLabel('邮箱',{exact:true}).fill('study-owner@example.test');
    await dialog.getByLabel('密码',{exact:true}).fill('fixture-study-password');
    await dialog.getByRole('button',{name:'登录学习账号 ↗',exact:true}).click();
    await dialog.waitFor({state:'hidden'});

    // Logged-in reads use only the current account token and its records.
    const list = page.getByRole('complementary',{name:'问答列表'}), reader = page.getByRole('article',{name:'问答详情'});
    await list.getByRole('button').filter({hasText:'虚函数：我的笔记'}).waitFor({state:'visible'});
    assert.equal(await page.locator('.demo-banner').count(),0);
    assert.equal(await list.locator('.record').count(),3);
    assert.doesNotMatch(await list.textContent(),/他人的记录|another-owner/);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('zy-study-session-v1')),TOKEN);
    await list.getByRole('button').filter({hasText:'虚函数：我的笔记'}).click();
    await reader.getByRole('heading',{name:'虚函数：我的笔记',exact:true}).waitFor({state:'visible'});
    assert.match(await reader.locator('.turns').textContent(),/<script>window\.__studyXss/);
    assert.equal(await reader.locator('.turns img, .turns script').count(),0,'answer HTML must be text, not active markup');
    assert.equal(await page.evaluate(()=>window.__studyXss),0);
    assert.match(await reader.textContent(),/仅当前账号可见/);
    await list.getByRole('button').filter({hasText:'梯度下降复习'}).click();
    await reader.getByRole('heading',{name:'梯度下降复习',exact:true}).waitFor({state:'visible'});
    await page.screenshot({path:path.join(__dirname,'site-study-desktop-preview.png')});
    const search = page.getByRole('searchbox',{name:'搜索问题标题或课程'}), course = page.getByLabel('筛选课程',{exact:true});
    await search.fill('梯度');
    assert.equal(await list.locator('.record').count(),1);
    assert.match(await list.textContent(),/梯度下降复习/);
    await search.fill('找不到的标题');
    await list.getByRole('heading',{name:'还没找到这段问答'}).waitFor({state:'visible'});
    await search.fill('');
    await course.selectOption({label:'程序设计'});
    assert.equal(await list.locator('.record').count(),2);
    assert.doesNotMatch(await list.textContent(),/梯度下降复习/);
    await course.selectOption({label:'全部课程'});

    // Both mobile widths keep controls in the viewport and provide list/back navigation.
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      await fits('study workspace overflow at '+width);
      await reader.getByRole('button',{name:'← 问答列表',exact:true}).click();
      await list.getByRole('button').filter({hasText:'梯度下降复习'}).waitFor({state:'visible'});
      await list.getByRole('button').filter({hasText:'梯度下降复习'}).click();
      await reader.getByRole('heading',{name:'梯度下降复习',exact:true}).waitFor({state:'visible'});
      await fits('study detail overflow at '+width);
      if (width===390) await page.screenshot({path:path.join(__dirname,'site-study-mobile-preview.png')});
    }
    await page.setViewportSize({width:1440,height:1000});
    await list.getByRole('button').filter({hasText:'虚函数：我的笔记'}).click();
    await reader.getByRole('heading',{name:'虚函数：我的笔记',exact:true}).waitFor({state:'visible'});
    page.once('dialog',dialog=>dialog.accept());
    await reader.getByRole('button',{name:'删除云端记录',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.record-list .record').length===2);
    assert.doesNotMatch(await list.textContent(),/虚函数：我的笔记/);
    assert.equal(await reader.locator('.turns').count(),0,'deleted detail is cleared');
    assert.equal(calls.filter(call=>call.method==='DELETE'&&call.query==='?id=own-1').length,1);
    await list.getByRole('button').filter({hasText:'梯度下降复习'}).click();
    await reader.getByRole('heading',{name:'梯度下降复习',exact:true}).waitFor({state:'visible'});
    await page.getByRole('button',{name:'退出',exact:true}).click();
    await page.getByRole('heading',{name:'你的问题，值得留下。'}).waitFor({state:'visible'});
    assert.equal(await page.locator('.record').count(),0,'logout clears record list');
    assert.equal(await page.locator('.turns').count(),0,'logout clears active answer');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('zy-study-session-v1')),null);
    assert.equal(calls.filter(call=>call.endpoint==='auth/logout').length,1);

    // Recheck the public landing and registration layout on narrow screens.
    await page.getByRole('button',{name:'探索插件',exact:true}).click();
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      await fits('landing overflow at '+width);
      await page.getByRole('button',{name:'登录 / 申请账号 ↗',exact:true}).click();
      dialog = page.getByRole('dialog');
      assert.equal(await dialog.getByRole('link',{name:'申请账号 ↗',exact:true}).getAttribute('href'),'/account?tab=register');
      await fits('login and account application entry overflow at '+width);
      assert.equal(await dialog.evaluate(element=>element.getBoundingClientRect().right<=innerWidth&&element.getBoundingClientRect().left>=0),true,'registration dialog fits '+width);
      await dialog.getByRole('button',{name:'关闭登录窗口',exact:true}).click();
    }
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(pageErrors,[]);
    assert.equal(calls.some(call=>call.endpoint.startsWith('auth/register')),false,'manual application entry must not send registration or email requests');
    console.log('PASS: public navigation, isolated demo, manual application link, normal login, token-scoped records, text-only answers, search/course/delete/logout, 390/320 px layouts; no email or payment requests.');
  } catch (error) {
    if (page) {
      fs.mkdirSync(path.join(__dirname,'.test-media'),{recursive:true});
      fs.writeFileSync(path.join(__dirname,'.test-media','study-portal-api-trace.json'),JSON.stringify(calls,null,2));
      await page.screenshot({path:path.join(__dirname,'.test-media','study-portal-failure.png')}).catch(()=>{});
    }
    throw error;
  } finally { await browser?.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
