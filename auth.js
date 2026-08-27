/* Panda consumer authentication — real Firebase Google and Apple sign-in. */
(function () {
  'use strict';
  const CONFIG_ENDPOINT = 'https://panda-partners-api.vercel.app/api/auth-config';
  const SESSION_ENDPOINT = 'https://panda-partners-api.vercel.app/api/auth-session';
  const SDK_VERSION = '10.12.2';
  const GOOGLE_CLIENT_ID = '361819429468-392737m2vt5d10m0rs09bckka3g1n48j.apps.googleusercontent.com';
  let googleIdentityLoading = null;
  let firebase = null;
  let firebaseLoading = null;
  let pendingUser = null;
  let selectedGender = '';
  if (typeof window.openAuth === 'function') window.openAuth = function () {};
  if (typeof window.doAuth === 'function') window.doAuth = function () {};

  function byId(id) { return document.getElementById(id); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function readStoredAccount() { try { return JSON.parse(localStorage.getItem('panda_auth') || 'null') || {}; } catch (error) { return {}; } }
  function verifiedAccount(account) { return !!(account && account.uid && account.email && account.providerVerified === true && account.stored === true); }
  function showLogin() { document.body.classList.add('gated'); window.__authLocked = true; byId('login').classList.add('show'); }
  function hideLogin() { document.body.classList.remove('gated'); window.__authLocked = false; byId('login').classList.remove('show'); }
  function status(message, error) { const el = byId('loginAuthStatus'); if (!el) return; el.textContent = message || ''; el.hidden = !message; el.classList.toggle('error', !!error); }
  function errorMessage(error) { const code = String((error && error.code) || ''); if (code === 'auth/configuration-unavailable' || code === 'auth/configuration-invalid') return 'Sign-in is being set up. Please try again shortly.'; if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled. Choose a provider to try again.'; if (code === 'auth/account-exists-with-different-credential') return 'This email is already linked to another sign-in method.'; if (code === 'auth/unauthorized-domain') return 'This Panda address has not been authorised for sign-in yet.'; if (code === 'auth/network-request-failed') return 'We couldn’t reach the sign-in service. Check your connection and try again.'; return 'We couldn’t complete sign-in. Please try again.'; }
  function setBusy(provider, busy) { all('#login .authbtn').forEach(function (button) { if (!button.dataset.html) button.dataset.html = button.innerHTML; button.disabled = !!busy; button.setAttribute('aria-busy', button.dataset.prov === provider && busy ? 'true' : 'false'); if (button.dataset.prov === provider) button.innerHTML = busy ? 'Opening ' + provider + '…' : button.dataset.html; }); }
  function providerLabel(user, fallback) { const providers = (user && user.providerData ? user.providerData : []).map(function (item) { return item.providerId; }); if (providers.indexOf('apple.com') > -1) return 'Apple'; if (providers.indexOf('google.com') > -1) return 'Google'; return fallback || ''; }
  function closeSheet() { const modal = byId('authModal'); modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); }
  function profileError(message) { let el = byId('authErr'); if (!el) { el = document.createElement('p'); el.id = 'authErr'; el.setAttribute('role', 'alert'); el.style.cssText = 'margin:10px 2px 0;color:#c0483f;font-size:12.5px;font-weight:700;line-height:1.4;text-align:center'; byId('authGo').before(el); } el.textContent = message || ''; }
  function removeListeners(selector, listener) { const old = document.querySelector(selector); if (!old || !old.parentNode) return null; const clone = old.cloneNode(true); old.parentNode.replaceChild(clone, old); clone.removeAttribute('onclick'); clone.removeAttribute('onkeydown'); clone.removeAttribute('onkeypress'); clone.onclick = null; clone.onkeydown = null; clone.onkeypress = null; if (listener) clone.addEventListener('click', listener); return clone; }

  async function getFirebase() {
    if (firebase) return firebase;
    if (firebaseLoading) return firebaseLoading;
    firebaseLoading = (async function () {
      let response;
      try { response = await fetch(CONFIG_ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' }); } catch (error) { const failure = new Error('auth/configuration-unavailable'); failure.code = 'auth/configuration-unavailable'; throw failure; }
      if (!response.ok) { const failure = new Error('auth/configuration-unavailable'); failure.code = 'auth/configuration-unavailable'; throw failure; }
      const payload = await response.json();
      const config = payload && payload.config;
      if (!config || !config.apiKey || !config.authDomain || !config.projectId || !config.appId) { const failure = new Error('auth/configuration-invalid'); failure.code = 'auth/configuration-invalid'; throw failure; }
      const appSdk = await import('https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-app.js');
      const authSdk = await import('https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-auth.js');
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
      const auth = authSdk.getAuth(app);
      try { await authSdk.setPersistence(auth, authSdk.browserLocalPersistence); } catch (error) {}
      firebase = { auth: auth, sdk: authSdk };
      return firebase;
    })().catch(function (error) { firebaseLoading = null; throw error; });
    return firebaseLoading;
  }

  function createProvider(name, sdk) { if (name === 'Apple') { const apple = new sdk.OAuthProvider('apple.com'); apple.addScope('email'); apple.addScope('name'); return apple; } const google = new sdk.GoogleAuthProvider(); google.setCustomParameters({ prompt: 'select_account' }); return google; }
  function loadGoogleIdentity() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve(window.google);
    if (googleIdentityLoading) return googleIdentityLoading;
    googleIdentityLoading = new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = function () {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) resolve(window.google);
        else { const error = new Error('auth/google-direct-unavailable'); error.code = 'auth/google-direct-unavailable'; reject(error); }
      };
      script.onerror = function () { const error = new Error('auth/google-direct-unavailable'); error.code = 'auth/google-direct-unavailable'; reject(error); };
      document.head.appendChild(script);
    }).catch(function (error) { googleIdentityLoading = null; throw error; });
    return googleIdentityLoading;
  }
  async function requestGoogleAccessToken() {
    const google = await loadGoogleIdentity();
    return new Promise(function (resolve, reject) {
      let settled = false;
      const timer = setTimeout(function () { fail('auth/google-direct-unavailable'); }, 30000);
      function succeed(token) { if (settled) return; settled = true; clearTimeout(timer); resolve(token); }
      function fail(code) { if (settled) return; settled = true; clearTimeout(timer); const error = new Error(code); error.code = code; reject(error); }
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile',
          callback: function (response) { if (response && response.access_token) succeed(response.access_token); else fail('auth/google-direct-unavailable'); },
          error_callback: function (error) { fail(error && error.type === 'popup_closed' ? 'auth/popup-closed-by-user' : 'auth/google-direct-unavailable'); }
        });
        client.requestAccessToken({ prompt: 'select_account' });
      } catch (error) { fail('auth/google-direct-unavailable'); }
    });
  }
  async function finishVerifiedUser(user) {
    if (!user) { const error = new Error('auth/no-user-returned'); error.code = 'auth/no-user-returned'; throw error; }
    localStorage.removeItem('panda_auth_pending_provider');
    pendingUser = user;
    const profile = typeof store !== 'undefined' ? (store.lget('panda_profile') || {}) : {};
    selectedGender = profile.gender || '';
    const nameField = byId('authName');
    if (nameField) nameField.value = String(user.displayName || (user.email || '').split('@')[0] || 'Panda Friend').trim();
    await finish();
  }
  function ageFromProfile(profile) {
    const year = Number(profile && profile.dobY);
    const month = Number(profile && profile.dobM);
    const day = Number(profile && profile.dobD);
    if (!year || !month || !day) return null;
    const birth = new Date(year, month - 1, day);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
    if (beforeBirthday) age--;
    return Number.isInteger(age) && age >= 16 && age <= 100 ? age : null;
  }
  function configureSheet(user, provider) {
    if (!user || !user.email) { status('Your sign-in provider did not return an email address. Please try another account.', true); return; }
    pendingUser = user;
    const label = providerLabel(user, provider);
    byId('authProvName').textContent = label;
    const profile = typeof store !== 'undefined' ? (store.lget('panda_profile') || {}) : {};
    byId('authName').value = user.displayName || profile.name || '';
    const email = byId('authEmail'); email.value = user.email; email.readOnly = true; email.setAttribute('aria-readonly', 'true');
    selectedGender = profile.gender || '';
    all('#authGender button').forEach(function (button) { button.classList.toggle('on', button.dataset.g === selectedGender); });
    profileError('');
    const modal = byId('authModal'); modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
    setTimeout(function () { byId('authName').focus(); }, 180);
  }

  async function cancel() { closeSheet(); const user = pendingUser; pendingUser = null; if (user) { try { const current = await getFirebase(); await current.sdk.signOut(current.auth); } catch (error) {} } showLogin(); }
  async function start(provider) {
    if (all('#login .authbtn').some(function (button) { return button.disabled; })) return;
    status('', false); setBusy(provider, true);
    try {
      const current = await getFirebase();
      localStorage.setItem('panda_auth_pending_provider', provider);
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
      if (isMobile) {
        if (provider === 'Google') {
          try {
            const accessToken = await requestGoogleAccessToken();
            const credential = current.sdk.GoogleAuthProvider.credential(null, accessToken);
            const directResult = await current.sdk.signInWithCredential(current.auth, credential);
            await finishVerifiedUser(directResult && directResult.user);
            return;
          } catch (directError) {
            if (String((directError && directError.code) || '') === 'auth/popup-closed-by-user') { status(errorMessage(directError), true); return; }
          }
        }
        try {
          const popupResult = await current.sdk.signInWithPopup(current.auth, createProvider(provider, current.sdk));
          await finishVerifiedUser(popupResult && popupResult.user);
          return;
        } catch (popupError) {
          const popupCode = String((popupError && popupError.code) || '');
          const canFallbackToRedirect = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported', 'auth/no-user-returned', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].indexOf(popupCode) > -1;
          if (!canFallbackToRedirect) { status(errorMessage(popupError), true); return; }
        }
      }
      await current.sdk.signInWithRedirect(current.auth, createProvider(provider, current.sdk));
      return;
    } catch (error) {
      status(errorMessage(error), true);
    } finally { setBusy(provider, false); }
  }
  async function finish() {
    const user = pendingUser;
    if (!user) { profileError('Your secure sign-in has expired. Please choose Google or Apple again.'); return; }
    const name = byId('authName').value.trim();
    if (!name) { byId('fldName').classList.add('bad'); setTimeout(function () { byId('fldName').classList.remove('bad'); }, 400); byId('authName').focus(); profileError('Please enter your name.'); return; }
    const button = byId('authGo'); if (button.dataset.busy === '1') return; button.dataset.busy = '1'; const label = button.textContent; button.textContent = 'Saving your account…'; button.style.opacity = '.7'; profileError('');
    const deviceId = localStorage.getItem('panda_device_id') || ('d_' + Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('panda_device_id', deviceId);
    try {
      const token = await user.getIdToken(true);
      const profile = typeof store !== 'undefined' ? (store.lget('panda_profile') || {}) : {}; const age = ageFromProfile(profile);
      const response = await fetch(SESSION_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name: name, gender: selectedGender, country: typeof PANDA_COUNTRY === 'undefined' ? null : PANDA_COUNTRY, age: age, deviceId: deviceId }) });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !payload.user) { const failure = new Error((payload && payload.error) || 'account-save-failed'); failure.code = 'auth/session-' + ((payload && payload.error) || 'account-save-failed'); throw failure; }
      const account = payload.user;
      if (typeof store !== 'undefined') { store.lset('panda_auth', { uid: account.uid, name: account.name || name, email: account.email, gender: selectedGender, age: age, provider: account.provider, providerVerified: true, stored: true, ts: Date.now() }); const profile = store.lget('panda_profile') || {}; profile.name = account.name || name; profile.email = account.email; if (selectedGender) profile.gender = selectedGender; store.lset('panda_profile', profile); }
      localStorage.setItem('panda_signup_sent', '1'); pendingUser = null; window.__authed = true; if (typeof loadProfile === 'function') loadProfile(); closeSheet(); hideLogin(); if (typeof showWelcome === 'function') showWelcome(account.name || name); if (window.__a2hsRetry) setTimeout(window.__a2hsRetry, 1400);
      try { if (!sessionStorage.getItem('panda_open_sent')) { sessionStorage.setItem('panda_open_sent', '1'); fetch('https://panda-partners-api.vercel.app/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [{ type: 'app_open', deviceId: deviceId, ts: Date.now() }] }), keepalive: true }).catch(function () {}); } } catch (error) {}
    } catch (error) { const code = String((error && error.code) || ''); const message = code === 'auth/session-invalid_or_expired_token' ? 'Google signed in, but Panda could not verify that session. Please try again. (Code: session verification)' : code === 'auth/session-account_save_failed' ? 'Google signed in, but Panda could not save the account yet. Please try again shortly. (Code: account save)' : code.indexOf('auth/session-') === 0 ? 'Google signed in, but Panda could not complete account setup. Please try again. (Code: account setup)' : 'We couldn’t verify your sign-in. Please try again.'; profileError(message); status(message, true); }
    finally { button.dataset.busy = '0'; button.textContent = label; button.style.opacity = ''; }
  }

  async function resolveRedirectUser(current, redirect) {
    if (redirect && redirect.user) return redirect.user;
    try { if (typeof current.auth.authStateReady === 'function') await current.auth.authStateReady(); } catch (error) {}
    if (current.auth.currentUser) return current.auth.currentUser;
    return new Promise(function (resolve) {
      var settled = false;
      var unsubscribe = function () {};
      var timer = setTimeout(function () { finish(current.auth.currentUser || null); }, 8000);
      function finish(user) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user || null);
      }
      try { unsubscribe = current.sdk.onAuthStateChanged(current.auth, function (user) { if (user) finish(user); }); } catch (error) { finish(current.auth.currentUser || null); }
    });
  }
  async function resume() {
    const old = readStoredAccount(); if (!verifiedAccount(old)) { try { localStorage.removeItem('panda_auth'); } catch (error) {} }
    showLogin();
    try { const current = await getFirebase(); const redirect = await current.sdk.getRedirectResult(current.auth); const user = await resolveRedirectUser(current, redirect); if (!user) { const pendingProvider = localStorage.getItem('panda_auth_pending_provider') || ''; if (pendingProvider) { localStorage.removeItem('panda_auth_pending_provider'); status('Sign-in was cancelled. Choose a provider to try again.', false); } return; } const saved = readStoredAccount(); const pendingProvider = localStorage.getItem('panda_auth_pending_provider') || ''; localStorage.removeItem('panda_auth_pending_provider'); if (verifiedAccount(saved) && saved.uid === user.uid) { window.__authed = true; hideLogin(); return; } await finishVerifiedUser(user); }
    catch (error) { status(errorMessage(error), true); }
  }
  async function logout() { try { localStorage.removeItem('panda_auth'); localStorage.removeItem('panda_auth_pending_provider'); } catch (error) {} pendingUser = null; window.__authed = false; closeSheet(); if (typeof closeSettings === 'function') closeSettings(); if (typeof showScreen === 'function') showScreen('home'); if (firebase) { try { await firebase.sdk.signOut(firebase.auth); } catch (error) {} } showLogin(); }
  function wire() {
    const style = document.createElement('style'); style.textContent = '#authModal{position:fixed!important;z-index:300!important}#authModal .auth-close{position:absolute;right:16px;top:14px;width:36px;height:36px;border-radius:50%;background:var(--card-soft);color:var(--ink);font-size:25px;line-height:1;z-index:1}#loginAuthStatus{width:100%;max-width:340px;margin:12px 0 -8px;color:var(--mint-300);font-size:12.5px;font-weight:700;line-height:1.45}#loginAuthStatus.error{color:#ffd0ca}.authbtn[disabled]{cursor:wait;opacity:.72}'; document.head.appendChild(style);
    const statusEl = document.createElement('p'); statusEl.id = 'loginAuthStatus'; statusEl.hidden = true; statusEl.setAttribute('role', 'status'); statusEl.setAttribute('aria-live', 'polite'); const authButtons = document.querySelector('#login .authbtns'); if (authButtons) authButtons.after(statusEl);
    const modal = byId('authModal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'authTitle'); const title = modal.querySelector('h3'); if (title) title.id = 'authTitle'; const close = document.createElement('button'); close.className = 'auth-close'; close.type = 'button'; close.setAttribute('aria-label', 'Cancel sign-in'); close.textContent = '×'; close.addEventListener('click', cancel); modal.querySelector('.card').appendChild(close);
    all('#login .authbtn').forEach(function (old) { const button = old.cloneNode(true); old.parentNode.replaceChild(button, old); button.type = 'button'; button.removeAttribute('onclick'); button.onclick = null; });
    document.addEventListener('click', function (event) { const button = event.target.closest('#login .authbtn'); if (!button) return; event.preventDefault(); event.stopImmediatePropagation(); start(button.dataset.prov); }, true);
    removeListeners('#authGo', finish); const email = removeListeners('#authEmail'); if (email) email.addEventListener('keydown', function (event) { if (event.key === 'Enter') finish(); }); removeListeners('#authBack', cancel); removeListeners('#rowLogout', logout);
    all('#authGender button').forEach(function (button) { button.addEventListener('click', function () { selectedGender = button.dataset.g; all('#authGender button').forEach(function (item) { item.classList.remove('on'); }); button.classList.add('on'); }); });
  }
  function initialiseAuth() { wire(); resume(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialiseAuth, { once: true });
  else initialiseAuth();
})();


