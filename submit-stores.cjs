const { execFileSync } = require('node:child_process');
const { sign } = require('node:crypto');
const { mkdirSync, readFileSync, rmdirSync } = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { parseArgs } = require('node:util');
const { version } = require('./package.json');

const chromeItemId = 'pjmmkpggbckfmdcfbhfgajgkbhjelafp';
const chromeItem = 'publishers/c7c2a977-d5b2-4e76-97f3-1c27ce05f93c/items/' + chromeItemId;
const chromeApi = 'https://chromewebstore.googleapis.com';
const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const edgeClientId = 'a1b2d2ab-542d-41f3-9e20-59f1e46a8c8a';
const edgeSubmissions = 'https://api.addons.microsoftedge.microsoft.com/v1/products/e4272bd7-6350-421a-a185-b1fbbcdd2b07/submissions';

async function request(label, url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45_000) });
  } catch {
    throw new Error(label + '请求未完成，请先核对后台状态再重试。');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body.errorCode || body.error?.status;
    if (code === 'InProgressSubmission') throw new Error('Edge 有提交正在审核，需在 Partner Center 撤回后再重试。');
    const suffix = typeof code === 'string' && /^[\w.-]{1,80}$/.test(code) ? ' ' + code : '';
    throw new Error(label + '返回 HTTP ' + response.status + suffix);
  }
  return { body, response };
}

async function waitForOperation(readStatus, pending, completed, label) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = await readStatus();
    if (status === completed) return;
    if (status !== pending) throw new Error(label + '未成功，状态为 ' + (status || '未知') + '。');
    await delay(5_000);
  }
  throw new Error(label + '仍在处理，请先核对操作状态再重试。');
}

async function chromeToken(env) {
  if (env.CHROME_WEB_STORE_ACCESS_TOKEN) return env.CHROME_WEB_STORE_ACCESS_TOKEN;
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('缺少可用的 Chrome 发布授权。');
  let account;
  try {
    account = JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  } catch {
    throw new Error('无法读取 Google 服务账号凭据。');
  }
  if (account.type !== 'service_account' || !account.client_email || !account.private_key) {
    throw new Error('Google 凭据不是服务账号密钥。使用身份联合时，请由发布环境传入短期访问令牌。');
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/chromewebstore',
    aud: googleTokenUrl,
    iat: now,
    exp: now + 3600,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode(claims);
  const assertion = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const { body } = await request('Chrome 获取令牌', googleTokenUrl, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!body.access_token) throw new Error('Google 没有返回访问令牌。');
  return body.access_token;
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function submitChrome(zip, env) {
  const headers = { Authorization: 'Bearer ' + await chromeToken(env) };
  const itemUrl = chromeApi + '/v2/' + chromeItem;
  const status = async () => (await request('Chrome 查询状态', itemUrl + ':fetchStatus', { headers })).body;
  const current = await status();
  if (current.itemId !== chromeItemId || current.takenDown) throw new Error('Chrome 条目身份或状态异常。');
  const online = current.publishedItemRevisionStatus?.distributionChannels ?? [];
  if (online.some((channel) => compareVersions(channel.crxVersion, version) >= 0)) return '当前或更新版本已发布';
  const submitted = current.submittedItemRevisionStatus;
  if (['PENDING_REVIEW', 'STAGED'].includes(submitted?.state)) {
    if (submitted.distributionChannels?.some((channel) => channel.crxVersion === version)) return '已提交，状态 ' + submitted.state;
    throw new Error('Chrome 已有在审或待发布的版本，请先核对开发者后台。');
  }
  if (current.lastAsyncUploadState === 'IN_PROGRESS') throw new Error('Chrome 仍在处理之前的上传。');

  const { body: upload } = await request('Chrome 上传', chromeApi + '/upload/v2/' + chromeItem + ':upload', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/zip' },
    body: zip,
  });
  if (upload.itemId !== chromeItemId || (upload.crxVersion && upload.crxVersion !== version)) {
    throw new Error('Chrome 上传返回的条目或版本与送审包不符。');
  }
  if (upload.uploadState === 'IN_PROGRESS') {
    await waitForOperation(async () => (await status()).lastAsyncUploadState, 'IN_PROGRESS', 'SUCCEEDED', 'Chrome 上传');
  } else if (upload.uploadState !== 'SUCCEEDED') {
    throw new Error('Chrome 上传未成功。');
  }
  const { body: result } = await request('Chrome 提审', itemUrl + ':publish', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  });
  if (result.itemId !== chromeItemId || !['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(result.state)) {
    throw new Error('Chrome 提审结果未得到确认，请先核对开发者后台。');
  }
  return '提交已受理，状态 ' + result.state;
}

async function submitEdge(zip, env) {
  if (!env.EDGE_API_KEY) throw new Error('缺少可用的 Edge 发布授权。');
  const headers = { Authorization: 'ApiKey ' + env.EDGE_API_KEY, 'X-ClientID': edgeClientId };
  async function runOperation(label, url, contentType, body) {
    const { response } = await request(label, url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': contentType },
      body,
    });
    const location = response.headers.get('location');
    const operationId = location?.trim().match(/(?:^|\/)([a-zA-Z0-9-]{1,100})\/?$/)?.[1];
    if (response.status !== 202 || !operationId) throw new Error(label + '未返回可查验的操作编号。');
    console.log(label + '操作编号 ' + operationId);
    await waitForOperation(async () => {
      const { body: operation } = await request(label + '状态', url + '/operations/' + operationId, { headers });
      if (operation.errorCode === 'InProgressSubmission') {
        throw new Error('Edge 有提交正在审核，需在 Partner Center 撤回后再重试。');
      }
      if (operation.status === 'Failed' && /^[\w.-]{1,80}$/.test(operation.errorCode || '')) {
        throw new Error(label + '失败，错误代码 ' + operation.errorCode + '。');
      }
      return operation.status;
    }, 'InProgress', 'Succeeded', label);
  }
  await runOperation('Edge 上传', edgeSubmissions + '/draft/package', 'application/zip', zip);
  const notes = env.EDGE_CERTIFICATION_NOTES;
  await runOperation('Edge 提审', edgeSubmissions, 'application/json', JSON.stringify(notes ? { notes } : {}));
  return '已创建送审提交';
}

async function main() {
  const { values } = parseArgs({ options: {
    prepare: { type: 'boolean' },
    store: { type: 'string', default: 'both' },
  } });
  const stores = { chrome: submitChrome, edge: submitEdge };
  if (values.store !== 'both' && !Object.hasOwn(stores, values.store)) {
    throw new Error('--store 仅支持 chrome、edge 或 both。');
  }
  const targets = values.store === 'both' ? Object.keys(stores) : [values.store];
  const dist = path.join(__dirname, 'dist');
  const lock = path.join(dist, '.store-release.lock');
  mkdirSync(dist, { recursive: true });
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('已有商店发布任务占用构建目录，请检查该任务状态。');
  }
  try {
    const { EDGE_API_KEY, EDGE_CERTIFICATION_NOTES, CHROME_WEB_STORE_ACCESS_TOKEN, GOOGLE_APPLICATION_CREDENTIALS, ...buildEnv } = process.env;
    execFileSync(process.execPath, ['release.test.cjs'], { cwd: __dirname, env: buildEnv, stdio: 'inherit' });
    const channels = targets.map((store) => store + '-store');
    execFileSync(process.execPath, ['build-extension.cjs', '--store-only', ...channels], {
      cwd: __dirname, env: buildEnv, stdio: 'inherit',
    });
    if (values.prepare) return;
    for (const store of targets) {
      try {
        const zip = readFileSync(path.join(dist, 'zhiyun-subtitles-' + version + '-' + store + '-store.zip'));
        console.log(store + ' ' + version + ' ' + await stores[store](zip, process.env));
      } catch (error) {
        console.error(store + ' ' + version + ' ' + error.message);
        process.exitCode = 1;
      }
    }
  } finally {
    rmdirSync(lock);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { submitChrome, submitEdge };
