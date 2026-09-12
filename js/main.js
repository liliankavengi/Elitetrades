/* ===========================================================
   ELITETRADES — main.js
   Live ticker | Rotating headline | Price widget ticker | Scroll animations
   =========================================================== */

(function () {
  'use strict';

  /* ── 1. Mobile Menu ────────────────────────────────────── */
  const hamburger   = document.getElementById('hamburger');
  const mobileMenu  = document.getElementById('mobileMenu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    // Close on link click
    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => mobileMenu.classList.remove('open'));
    });
  }

  /* ── 2. Active Nav Link ─────────────────────────────────── */
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });

  /* ── 3. Rotating Headline Words ─────────────────────────── */
  const rotatingEl = document.getElementById('rotatingWord');
  if (rotatingEl) {
    const words    = ['Precision.', 'Confidence.', 'Speed.', 'Clarity.', 'Trust.'];
    let   wordIdx  = 0;

    function nextWord() {
      rotatingEl.style.opacity = '0';
      rotatingEl.style.transform = 'translateY(-8px)';

      setTimeout(() => {
        wordIdx = (wordIdx + 1) % words.length;
        rotatingEl.textContent = words[wordIdx];
        rotatingEl.style.transition = 'none';
        rotatingEl.style.transform = 'translateY(8px)';
        rotatingEl.style.opacity = '0';

        requestAnimationFrame(() => {
          rotatingEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
          rotatingEl.style.opacity = '1';
          rotatingEl.style.transform = 'translateY(0)';
        });
      }, 300);
    }

    rotatingEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    setInterval(nextWord, 2200);
  }

  /* ── 4. Live Price Widget ───────────────────────────────── */
  const MARKETS = [
    { name: 'Volatility 75 Index',  type: 'V75',  base: 12485.20, decimals: 2 },
    { name: 'Volatility 100 Index', type: 'V100', base: 8842.50,  decimals: 2 },
    { name: 'Volatility 50 Index',  type: 'V50',  base: 5932.10,  decimals: 2 },
    { name: 'Volatility 25 Index',  type: 'V25',  base: 2318.75,  decimals: 2 },
    { name: 'Volatility 10 Index',  type: 'V10',  base: 1045.60,  decimals: 2 },
  ];

  const prices     = MARKETS.map(m => m.base);
  const priceEls   = document.querySelectorAll('[data-price-row]');
  const pillEls    = document.querySelectorAll('[data-pill]');

  function tick(base, current, volatility) {
    const change = (Math.random() - 0.49) * volatility;
    return parseFloat((current + change).toFixed(2));
  }

  function fmtPrice(val, dec) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  function updatePrices() {
    MARKETS.forEach((m, i) => {
      const oldPrice = prices[i];
      prices[i] = tick(m.base, oldPrice, m.base * 0.0003);
      const diff    = prices[i] - oldPrice;
      const pct     = ((diff / oldPrice) * 100).toFixed(3);
      const isUp    = diff >= 0;

      // Update hero widget rows
      const row = document.querySelector(`[data-price-row="${i}"]`);
      if (row) {
        const valEl  = row.querySelector('.price-value');
        const chgEl  = row.querySelector('.price-change');
        if (valEl) {
          valEl.textContent = fmtPrice(prices[i], m.decimals);
          valEl.closest('.price-row').classList.add(isUp ? 'flash-green' : 'flash-red');
          setTimeout(() => valEl.closest('.price-row').classList.remove('flash-green', 'flash-red'), 500);
        }
        if (chgEl) {
          chgEl.textContent = (isUp ? '+' : '') + pct + '%';
          chgEl.className = 'price-change ' + (isUp ? 'up' : 'down');
        }
      }

      // Update market pills
      const pill = document.querySelector(`[data-pill="${i}"]`);
      if (pill) {
        const priceEl = pill.querySelector('.pill-price');
        if (priceEl) {
          priceEl.textContent = fmtPrice(prices[i], m.decimals);
          priceEl.className = 'pill-price ' + (isUp ? 'up' : 'down');
        }
      }

      // Update markets table
      const tableRow = document.querySelector(`[data-table-row="${i}"]`);
      if (tableRow) {
        const tp = tableRow.querySelector('.table-price');
        const tc = tableRow.querySelector('.table-change');
        if (tp) tp.textContent = fmtPrice(prices[i], m.decimals);
        if (tc) {
          tc.textContent = (isUp ? '+' : '') + pct + '%';
          tc.className = 'table-change ' + (isUp ? 'up' : 'down');
        }
      }
    });
  }

  setInterval(updatePrices, 800);

  /* ── 5. Live Activity Ticker ────────────────────────────── */
  const ACTIVITY = [
    { user: 'John M.', market: 'V75 Index',  action: 'Rise', amount: '$285.00' },
    { user: 'Fatima A.', market: 'V100 Index', action: 'Fall', amount: '$420.50' },
    { user: 'Kevin O.', market: 'V50 Index',  action: 'Rise', amount: '$165.00' },
    { user: 'Mary T.', market: 'V75 Index',  action: 'Rise', amount: '$310.25' },
    { user: 'Rashid K.', market: 'V25 Index', action: 'Fall', amount: '$95.00' },
    { user: 'Chen W.',  market: 'V100 Index', action: 'Rise', amount: '$540.00' },
    { user: 'Sofia P.', market: 'V50 Index',  action: 'Rise', amount: '$210.75' },
    { user: 'Ahmed B.', market: 'V10 Index',  action: 'Fall', amount: '$48.00' },
    { user: 'Grace L.', market: 'V75 Index',  action: 'Rise', amount: '$375.50' },
    { user: 'David N.', market: 'V100 Index', action: 'Fall', amount: '$680.00' },
    { user: 'Amina S.', market: 'V25 Index',  action: 'Rise', amount: '$130.25' },
    { user: 'Pablo R.', market: 'V50 Index',  action: 'Rise', amount: '$250.00' },
  ];

  const track = document.getElementById('tickerTrack');
  if (track) {
    const renderItems = () =>
      ACTIVITY.map(a => {
        const won = Math.random() > 0.35;
        return `
          <div class="ticker-item">
            <span>🎉</span>
            <span class="winner">${a.user}</span>
            <span>${won ? 'won' : 'placed'}</span>
            <span class="amount">${a.amount}</span>
            <span>on ${a.market}</span>
          </div>`;
      }).join('');

    // Duplicate for seamless loop
    track.innerHTML = renderItems() + renderItems();
  }

  /* ── 6. Intersection Observer (Fade In Animations) ─────── */
  const fadeEls = document.querySelectorAll('.fade-in-up');
  if (fadeEls.length && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          setTimeout(() => e.target.classList.add('visible'), i * 60);
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });

    fadeEls.forEach(el => obs.observe(el));
  } else {
    fadeEls.forEach(el => el.classList.add('visible'));
  }

  /* ── 7. Scroll Counter Animation ───────────────────────── */
  function animateCounter(el) {
    const target = parseFloat(el.dataset.target);
    const isFloat = target % 1 !== 0;
    const suffix  = el.dataset.suffix || '';
    const prefix  = el.dataset.prefix || '';
    const duration = 1600;
    const steps    = 60;
    const step     = target / steps;
    let   current  = 0;

    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        current = target;
        clearInterval(timer);
      }
      el.textContent = prefix + (isFloat ? current.toFixed(1) : Math.floor(current).toLocaleString()) + suffix;
    }, duration / steps);
  }

  const counters = document.querySelectorAll('[data-target]');
  if (counters.length && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          animateCounter(e.target);
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.3 });

    counters.forEach(c => obs.observe(c));
  }

  /* ── 8. Password Visibility Toggle ─────────────────────── */
  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target  = document.getElementById(btn.dataset.togglePassword);
      const isPass  = target.type === 'password';
      target.type   = isPass ? 'text' : 'password';
      btn.textContent = isPass ? '🙈' : '👁️';
    });
  });

  /* ── 9. Form Submission → Save user & redirect to dashboard ── */
  document.querySelectorAll('[data-auth-form]').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn  = form.querySelector('[type="submit"]');
      const orig = btn.textContent;
      btn.textContent = 'Processing…';
      btn.disabled = true;

      // Collect user info and persist to localStorage
      const emailEl  = form.querySelector('[type="email"]');
      const fnameEl  = form.querySelector('[id*="firstname"]') || form.querySelector('[id*="name"]');
      const lnameEl  = form.querySelector('[id*="lastname"]');
      const email    = emailEl?.value?.trim() || '';
      const fname    = fnameEl?.value?.trim() || '';
      const lname    = lnameEl?.value?.trim() || '';
      const name     = [fname, lname].filter(Boolean).join(' ') || email.split('@')[0] || 'Trader';

      // Load existing state or create fresh
      let state;
      try { state = JSON.parse(localStorage.getItem('et_state') || '{}'); }
      catch { state = {}; }

      if (!state.balance)      state.balance = 0;
      if (!state.transactions) state.transactions = [];
      state.user = { name, email };

      localStorage.setItem('et_state', JSON.stringify(state));

      setTimeout(() => {
        // Redirect to dashboard
        window.location.href = 'dashboard.html';
      }, 1200);
    });
  });

  /* ── 10. Market Pill Active State ───────────────────────── */
  document.querySelectorAll('.market-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.market-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

})();
