/* ===========================================================
   ELITETRADES - auth.js
   Handles Register + Login using Firebase Authentication.
   Saves user profile to Firestore on registration.
   =========================================================== */

(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */
  function showError(elId, msg) {
    const el = document.getElementById(elId);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function hideError(elId) {
    const el = document.getElementById(elId);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }

  function setLoading(btn, loading, defaultText) {
    btn.disabled     = loading;
    btn.textContent  = loading ? 'Please wait…' : defaultText;
  }

  /* Map Firebase error codes → human-readable messages */
  function friendlyError(code) {
    const MAP = {
      'auth/email-already-in-use':    'An account with this email already exists. Please sign in.',
      'auth/invalid-email':           'Please enter a valid email address.',
      'auth/weak-password':           'Password must be at least 8 characters.',
      'auth/user-not-found':          'No account found with this email address.',
      'auth/wrong-password':          'Incorrect password. Please try again.',
      'auth/invalid-credential':      'Incorrect email or password.',
      'auth/too-many-requests':       'Too many failed attempts. Please wait a moment and try again.',
      'auth/network-request-failed':  'Network error. Please check your connection.',
      'auth/user-disabled':           'This account has been disabled. Please contact support.',
    };
    return MAP[code] || 'Something went wrong. Please try again.';
  }

  /* ── REGISTER FORM ───────────────────────────────────────── */
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('auth-error');

      const btn      = registerForm.querySelector('[type="submit"]');
      const fname    = document.getElementById('reg-firstname')?.value.trim() || '';
      const lname    = document.getElementById('reg-lastname')?.value.trim()  || '';
      const email    = document.getElementById('reg-email')?.value.trim()     || '';
      const phone    = document.getElementById('reg-phone')?.value.trim()     || '';
      const country  = document.getElementById('reg-country')?.value          || '';
      const password = document.getElementById('reg-password')?.value         || '';
      const terms    = document.getElementById('terms-agree')?.checked;
      const name     = [fname, lname].filter(Boolean).join(' ') || email.split('@')[0];

      /* Client-side validation */
      if (!fname || !lname) { showError('auth-error', 'Please enter your full name.'); return; }
      if (!email)            { showError('auth-error', 'Please enter your email address.'); return; }
      if (!phone)            { showError('auth-error', 'Please enter your phone number.'); return; }
      if (!country)          { showError('auth-error', 'Please select your country.'); return; }
      if (password.length < 8) { showError('auth-error', 'Password must be at least 8 characters.'); return; }
      if (!terms)            { showError('auth-error', 'You must agree to the Terms of Service to continue.'); return; }

      setLoading(btn, true, 'Create My Account →');

      try {
        /* 1. Create Firebase Auth account */
        const cred = await auth.createUserWithEmailAndPassword(email, password);

        /* 2. Update display name in Auth */
        await cred.user.updateProfile({ displayName: name });

        /* 3. Save full profile to Firestore */
        await db.collection('users').doc(cred.user.uid).set({
          name,
          email,
          phone,
          country,
          balance:      0,
          transactions: [],
          createdAt:    firebase.firestore.FieldValue.serverTimestamp(),
        });

        /* Sync local cache immediately with the new account's credentials */
        localStorage.setItem('et_uid', cred.user.uid);
        localStorage.setItem('et_user_name', name);
        localStorage.setItem('et_user_email', email);
        localStorage.setItem('et_user_phone', phone);
        localStorage.setItem('et_state_cache', JSON.stringify({
          balance: 0,
          transactions: []
        }));

        /* 4. Redirect to dashboard */
        window.location.href = 'dashboard.html';

      } catch (err) {
        setLoading(btn, false, 'Create My Account →');
        showError('auth-error', friendlyError(err.code));
        console.error('Register error:', err.code, err.message);
      }
    });
  }

  /* ── LOGIN FORM ──────────────────────────────────────────── */
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('auth-error');

      const btn      = loginForm.querySelector('[type="submit"]');
      const email    = document.getElementById('login-email')?.value.trim()    || '';
      const password = document.getElementById('login-password')?.value        || '';
      const remember = document.getElementById('remember-me')?.checked;

      if (!email)    { showError('auth-error', 'Please enter your email address.'); return; }
      if (!password) { showError('auth-error', 'Please enter your password.'); return; }

      setLoading(btn, true, 'Sign In →');

      try {
        /* Set session persistence */
        const persistence = remember
          ? firebase.auth.Auth.Persistence.LOCAL
          : firebase.auth.Auth.Persistence.SESSION;
        await auth.setPersistence(persistence);

        /* Sign in */
        const cred = await auth.signInWithEmailAndPassword(email, password);
        if (cred.user) {
          localStorage.setItem('et_uid', cred.user.uid);
        }

        /* Redirect to dashboard */
        window.location.href = 'dashboard.html';

      } catch (err) {
        setLoading(btn, false, 'Sign In →');
        showError('auth-error', friendlyError(err.code));
        console.error('Login error:', err.code, err.message);
      }
    });
  }

  /* ── If already logged in, skip auth pages ───────────────── */
  auth.onAuthStateChanged((user) => {
    if (user && (loginForm || registerForm)) {
      window.location.href = 'dashboard.html';
    }
  });

  /* ── Password toggle ─────────────────────────────────────── */
  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.togglePassword);
      if (!target) return;
      const isPass    = target.type === 'password';
      target.type     = isPass ? 'text' : 'password';
      btn.textContent = isPass ? 'Hide' : 'Show';
    });
  });

})();
