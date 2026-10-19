const CONFIG_URL = 'https://panda-partners-api.vercel.app/api/auth-config';
const HANDOFF_URL = 'https://panda-partners-api.vercel.app/api/native-auth/handoff';
const FIREBASE_SDK_VERSION = '10.12.2';
const GOOGLE_CLIENT_ID = '361819429468-392737m2vt5d10m0rs09bckka3g1n48j.apps.googleusercontent.com';
const APP_RETURN_URL = 'panda-mobile://auth';
const HEX_64 = /^[a-f0-9]{64}$/i;

const params = new URLSearchParams(window.location.search);
const state = params.get('state') || '';
const codeChallenge = params.get('challenge') || '';
const requestedProvider = params.get('provider') || '';
const statusEl = document.getElementById('status');
const buttons = Array.from(document.querySelectorAll('[data-provider]'));
let authSdk;
let auth;
let googleIdentityLoading;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function providerError(error) {
  const code = String(error?.code || '');
  if (code === 'auth/operation-not-allowed') {
    return 'Apple sign-in is not enabled for Panda yet. Please use Google, or ask the Panda team to finish Apple provider setup.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This sign-in page is not authorised in Panda’s account settings yet.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Sign-in was cancelled. Choose a provider to try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Panda could not reach the sign-in service. Check your connection and try again.';
  }
  return 'Panda could not complete sign-in. Please try again.';
}

async function loadFirebase() {
  const response = await fetch(CONFIG_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error('Panda sign-in configuration is unavailable.');
  const payload = await response.json();
  const config = payload?.config;
  if (!config?.apiKey || !config?.authDomain || !config?.projectId || !config?.appId) {
    throw new Error('Panda sign-in configuration is incomplete.');
  }
  const [appSdk, sdk] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
  ]);
  const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
  const firebaseAuth = sdk.getAuth(app);
  await sdk.setPersistence(firebaseAuth, sdk.browserLocalPersistence);
  authSdk = sdk;
  auth = firebaseAuth;
  return firebaseAuth;
}

async function completeSignIn(user) {
  if (!user) throw new Error('Panda could not read the signed-in account.');
  sessionStorage.removeItem('panda_native_auth_pending');
  setStatus('Verifying your Panda account…');
  const idToken = await user.getIdToken(true);
  const response = await fetch(HANDOFF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ state, codeChallenge, name: user.displayName || user.email?.split('@')[0] || 'Panda member' }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.code) {
    throw new Error(payload.error === 'account_save_failed'
      ? 'Panda could not save your verified sign-in. Please try again.'
      : 'Panda could not finish the secure sign-in handoff. Please try again.');
  }
  await authSdk.signOut(auth);
  const callback = `${APP_RETURN_URL}?${new URLSearchParams({ code: payload.code, state })}`;
  window.location.replace(callback);
}

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (googleIdentityLoading) return googleIdentityLoading;
  googleIdentityLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google);
      else reject(Object.assign(new Error('Google sign-in is unavailable.'), { code: 'auth/google-direct-unavailable' }));
    };
    script.onerror = () => reject(Object.assign(new Error('Google sign-in is unavailable.'), { code: 'auth/google-direct-unavailable' }));
    document.head.appendChild(script);
  }).catch((error) => {
    googleIdentityLoading = null;
    throw error;
  });
  return googleIdentityLoading;
}

async function requestGoogleAccessToken() {
  const google = await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(token);
    };
    const timer = setTimeout(() => {
      finish(Object.assign(new Error('Google sign-in timed out.'), { code: 'auth/google-direct-unavailable' }));
    }, 30000);
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        callback: (result) => {
          if (result?.access_token) finish(null, result.access_token);
          else finish(Object.assign(new Error('Google sign-in did not return an access token.'), { code: 'auth/google-direct-unavailable' }));
        },
        error_callback: (error) => {
          finish(Object.assign(new Error('Google sign-in was cancelled or blocked.'), {
            code: error?.type === 'popup_closed' ? 'auth/popup-closed-by-user' : 'auth/google-direct-unavailable',
          }));
        },
      });
      client.requestAccessToken({ prompt: 'select_account' });
    } catch {
      finish(Object.assign(new Error('Google sign-in is unavailable.'), { code: 'auth/google-direct-unavailable' }));
    }
  });
}

async function recoverRedirect() {
  const pending = sessionStorage.getItem('panda_native_auth_pending');
  const redirect = await authSdk.getRedirectResult(auth);
  if (redirect?.user) {
    sessionStorage.removeItem('panda_native_auth_pending');
    await completeSignIn(redirect.user);
    return true;
  }
  if (pending) {
    sessionStorage.removeItem('panda_native_auth_pending');
    if (typeof auth.authStateReady === 'function') await auth.authStateReady();
    if (auth.currentUser) {
      await completeSignIn(auth.currentUser);
      return true;
    }
    setStatus('Sign-in was cancelled. Choose a provider to try again.', true);
  }
  return false;
}

async function startSignIn(providerName) {
  buttons.forEach((button) => { button.disabled = true; });
  setStatus(`Opening ${providerName}…`);
  try {
    if (!auth) await loadFirebase();
    const provider = providerName === 'Apple'
      ? new authSdk.OAuthProvider('apple.com')
      : new authSdk.GoogleAuthProvider();
    if (providerName === 'Apple') {
      provider.addScope('email');
      provider.addScope('name');
    } else {
      provider.setCustomParameters({ prompt: 'select_account' });
    }
    sessionStorage.setItem('panda_native_auth_pending', providerName);
    if (providerName === 'Google') {
      try {
        const accessToken = await requestGoogleAccessToken();
        const credential = authSdk.GoogleAuthProvider.credential(null, accessToken);
        const result = await authSdk.signInWithCredential(auth, credential);
        await completeSignIn(result.user);
        return;
      } catch (directError) {
        if (directError?.code === 'auth/popup-closed-by-user') throw directError;
      }
    }
    try {
      const result = await authSdk.signInWithPopup(auth, provider);
      await completeSignIn(result.user);
    } catch (popupError) {
      if (popupError?.code === 'auth/popup-closed-by-user' || popupError?.code === 'auth/cancelled-popup-request') {
        throw popupError;
      }
      const fallbackCodes = [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment',
        'auth/web-storage-unsupported',
        'auth/no-user-returned',
      ];
      if (!fallbackCodes.includes(String(popupError?.code || ''))) throw popupError;
      await authSdk.signInWithRedirect(auth, provider);
    }
  } catch (error) {
    sessionStorage.removeItem('panda_native_auth_pending');
    setStatus(providerError(error), true);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

buttons.forEach((button) => {
  button.addEventListener('click', () => startSignIn(button.dataset.provider));
});

if (!HEX_64.test(state) || !HEX_64.test(codeChallenge)) {
  setStatus('This sign-in link has expired. Return to Panda and try again.', true);
  buttons.forEach((button) => { button.disabled = true; });
} else {
  loadFirebase()
    .then(recoverRedirect)
    .catch((error) => {
      const message = error instanceof Error && error.message.startsWith('Panda ')
        ? error.message
        : providerError(error);
      setStatus(message, true);
    });
  if (['Google', 'Apple'].includes(requestedProvider)) {
    setStatus(`Choose Continue with ${requestedProvider} below to sign in.`);
  }
}
