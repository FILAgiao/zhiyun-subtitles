/* Same-origin account registration and quota display. */
'use strict';

(() => {
  const portal = window.ZYPortal;
  const $ = id => document.getElementById(id);
  const recharge = new URLSearchParams(location.search).get('tab') === 'recharge';
  const registration = $('email-registration');
  const emailInput = $('register-email');
  const codeInput = $('register-code');
  const passwordInput = $('register-password');
  const sendButton = $('register-send');
  const resendButton = $('register-resend');
  const submitButton = $('register-submit');
  const channelTitle = $('channel-title');
  const channelDescription = $('channel-description');
  const emailDeliveries = new Map();
  let channelGeneration = 0;
  let mailReady = false;
  let step = 'email';
  let registered = false;
  let sending = false;
  let registering = false;
  let resendTimer;

  function safeImage(raw) {
    try {
      if (typeof raw !== 'string' || raw.length > 2048 || /[\s\u0000-\u0020\u007f]/.test(raw)) return '';
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) return '';
      if (!host.includes('.') || host.endsWith('.') || host === 'localhost' || /\.(?:localhost|local|internal|test|invalid)$/.test(host) || host.includes(':') || /^(\d+\.){3}\d+$/.test(host)) return '';
      if (!host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function channelNotice(message = '') {
    $('channel-notice').textContent = message;
  }

  function channelError(message) {
    channelNotice(message);
    $('channel-retry').hidden = false;
  }

  async function channels() {
    const own = ++channelGeneration;
    const image = $('channel-qr');
    mailReady = false;
    renderSession();
    $('channel-retry').hidden = true;
    $('channel-closed').hidden = true;
    $('channel-open').hidden = true;
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    channelNotice('正在核对渠道开放状态…');

    try {
      if (!recharge) {
        const capabilities = await portal.api('/v1/study/capabilities', {auth: ''}).catch(error => {
          if (error.status === 404) return null;
          throw error;
        });
        if (own !== channelGeneration) return;
        if (capabilities?.registration === true && capabilities.mail_configured === true) {
          await portal.ready;
          if (own !== channelGeneration) return;
          mailReady = true;
          channelNotice();
          renderSession();
          return;
        }
        channelDescription.textContent = '查看当前可用的账号办理方式。';
      }

      const data = await portal.api('/v1/account/access', {auth: ''});
      if (own !== channelGeneration) return;
      const info = data[recharge ? 'recharge' : 'registration'];
      const url = safeImage(info?.qr_url);
      if (info?.enabled !== true || !url) {
        $('channel-closed').hidden = false;
        $('channel-retry').hidden = false;
        channelNotice();
        return;
      }

      image.onload = () => {
        if (own !== channelGeneration) return;
        image.onload = image.onerror = null;
        $('channel-instructions').textContent = typeof info.instructions === 'string' ? info.instructions : '';
        $('channel-contact').textContent = typeof info.contact === 'string' ? info.contact : '';
        $('channel-open').hidden = false;
        channelNotice();
      };
      image.onerror = () => {
        if (own === channelGeneration) channelError('暂时无法加载办理信息，请稍后重试。');
      };
      image.src = url;
    } catch {
      if (own === channelGeneration) channelError('暂时无法核对渠道开放状态，请稍后重试。');
    }
  }

  function renderMember(profile) {
    $('account-member').hidden = !profile;
    $('member-name').textContent = profile?.username || profile?.email || '';
    $('member-plan').textContent = '';
    $('member-quota').replaceChildren();
    $('member-expiry').textContent = '';
    if (!profile) return;

    const names = {free: '基础免费', trial: '免费体验', pro: 'PRO', ultra: 'Ultra', legacy: '原有授权'};
    const plan = profile.membership?.plan || profile.permissions?.plan || 'free';
    $('member-plan').textContent = names[plan] || '我的账号';
    const usage = profile.usage || {};
    const rows = [
      ['本月调用剩余', usage.request_limit, usage.requests, '次'],
      ['本月语音剩余', usage.audio_limit, usage.audio_seconds, '秒'],
    ];
    if (usage.translation_limit != null) rows.push(['本月专用字幕翻译剩余', usage.translation_limit, usage.translation_chars, '字符']);
    for (const [label, limit, used, unit] of rows) {
      const row = document.createElement('div');
      const name = document.createElement('dt');
      const value = document.createElement('dd');
      name.textContent = label;
      const ready = Number.isFinite(limit) && limit >= 0 && Number.isFinite(used);
      value.textContent = ready ? Math.max(0, Math.floor(limit - used)).toLocaleString('zh-CN') + ' ' + unit : '待核对';
      row.append(name, value);
      $('member-quota').append(row);
    }
    const expires = Number(profile.membership?.expires || profile.permissions?.expires || 0);
    $('member-expiry').textContent = expires > 0 ? '有效期至 ' + portal.date(expires * 1000) + '（北京时间）' : '未设置到期时间';
  }

  function renderSession() {
    const {profile, pending, notice} = portal.session();
    const signedIn = Boolean(profile);
    $('main').dataset.view = recharge ? 'recharge' : signedIn ? 'member' : 'register';
    $('account-channel').hidden = signedIn && !recharge;
    $('registration-preview').hidden = recharge || signedIn;
    $('account-guest').hidden = signedIn || pending || registered;
    $('account-nav').textContent = signedIn ? '我的额度' : '免费注册';
    $('member-recharge').hidden = recharge;
    $('member-back').hidden = !recharge;
    $('portal-session-notice').textContent = notice || (pending ? '正在恢复登录…' : '');
    if (signedIn && !recharge) {
      if (registered || step === 'verify' || emailInput.value) {
        registered = false;
        registration.reset();
        emailDeliveries.clear();
        showStep('email');
      }
    }
    registration.hidden = recharge || !mailReady || signedIn || pending || registered;
    $('register-success').hidden = !registered || signedIn || pending;
    renderMember(profile);
  }

  function registrationNotice(message = '', error = false) {
    const status = $('register-status');
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function emailAddress() {
    return emailInput.value.trim().toLowerCase();
  }

  function usableDelivery(email) {
    const delivery = emailDeliveries.get(email);
    return delivery?.expiresAt > Date.now() ? delivery : null;
  }

  function updateControls() {
    clearTimeout(resendTimer);
    const delivery = usableDelivery(emailAddress());
    const remaining = Math.max(0, Math.ceil(((delivery?.resendAt || 0) - Date.now()) / 1000));
    sendButton.disabled = sending || registering;
    sendButton.firstChild.textContent = sending ? '发送中… ' : delivery ? '继续验证邮箱 ' : '发送验证码 ';
    resendButton.disabled = sending || registering || remaining > 0;
    resendButton.textContent = sending ? '发送中…' : remaining ? remaining + ' 秒后可重发' : '重新发送';
    submitButton.disabled = sending || registering;
    submitButton.firstChild.textContent = registering ? '注册中… ' : '创建免费账号 ';
    $('register-edit').disabled = sending || registering;
    if (step === 'verify' && remaining) resendTimer = setTimeout(updateControls, 1000);
  }

  function showStep(next) {
    step = next;
    const verifying = next === 'verify';
    $('register-email-step').hidden = verifying;
    $('register-verify-step').hidden = !verifying;
    emailInput.disabled = verifying;
    codeInput.disabled = passwordInput.disabled = !verifying;
    $('register-sent-email').textContent = verifying ? emailAddress() : '';
    channelTitle.textContent = verifying ? '查收邮箱验证码' : '创建免费账号';
    channelDescription.textContent = verifying ? '输入验证码并设置密码，完成免费注册。' : '用邮箱注册，体验课堂 AI。无需充值。';
    registrationNotice();
    updateControls();
  }

  function showVerification() {
    showStep('verify');
    codeInput.focus();
  }

  function stillRegistering(email, generation) {
    return !registration.hidden && generation === portal.session().generation && email === emailAddress();
  }

  async function sendCode(forceResend = false) {
    if (sending || registering || registration.hidden || !mailReady) return;
    const email = emailAddress();
    if (!forceResend && usableDelivery(email)) {
      showVerification();
      return;
    }
    const {generation} = portal.session();
    sending = true;
    registrationNotice();
    updateControls();
    try {
      const result = await portal.api('/v1/auth/register-code', {method: 'POST', auth: '', body: {email}});
      if (generation !== portal.session().generation) return;
      const expires = result.expires_in > 0 ? Number(result.expires_in) : 600;
      const retry = result.retry_after > 0 ? Number(result.retry_after) : 60;
      const sent = Date.now();
      emailDeliveries.set(email, {expiresAt: sent + expires * 1000, resendAt: sent + retry * 1000});
      if (stillRegistering(email, generation)) {
        codeInput.value = '';
        showVerification();
        registrationNotice('验证码已发送，' + Math.ceil(expires / 60) + ' 分钟内有效。');
      }
    } catch (error) {
      if (stillRegistering(email, generation)) registrationNotice(error.message, true);
    } finally {
      sending = false;
      updateControls();
    }
  }

  if (recharge) {
    document.title = '充值与额度 · 浙大上课爽';
    channelTitle.textContent = '充值 / 增加额度';
    channelDescription.textContent = '查看当前开放的额度办理方式。';
    $('channel-closed-copy').textContent = '充值渠道暂未开放，请稍后再试。';
    $('account-nav').removeAttribute('aria-current');
  }

  $('channel-retry').addEventListener('click', channels);
  window.addEventListener('portal-session-change', renderSession);
  portal.ready.then(renderSession);
  channels();
  if (recharge) return;

  $('register-success').addEventListener('click', portal.openLogin);
  emailInput.addEventListener('input', () => {
    registrationNotice();
    updateControls();
  });
  $('register-edit').addEventListener('click', () => {
    codeInput.value = passwordInput.value = '';
    showStep('email');
    emailInput.focus();
  });
  resendButton.addEventListener('click', () => {
    if (!resendButton.disabled && step === 'verify') void sendCode(true);
  });

  registration.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || registering || registration.hidden || !registration.reportValidity()) return;
    if (step === 'email') {
      await sendCode();
      return;
    }
    const email = emailAddress();
    const {generation} = portal.session();
    registering = true;
    registrationNotice();
    updateControls();
    try {
      const body = {email, code: codeInput.value.trim(), password: passwordInput.value};
      await portal.api('/v1/auth/register', {method: 'POST', auth: '', body});
      if (!stillRegistering(email, generation)) return;
      registration.reset();
      emailDeliveries.clear();
      showStep('email');
      registered = true;
      channelTitle.textContent = '账号创建成功';
      channelDescription.textContent = '使用刚注册的邮箱和密码登录，查看账号额度。';
      renderSession();
      $('login-name').value = email;
      portal.openLogin();
      $('login-status').textContent = '邮箱验证完成，请输入密码登录。';
    } catch (error) {
      if (stillRegistering(email, generation)) registrationNotice(error.message, true);
    } finally {
      registering = false;
      updateControls();
    }
  });
})();
