/* ===========================================================
   ELITETRADES - SinTrades-Style Trading Engine & Dashboard
   Real-Time Neon Volatility Charts | Digits Analyzer | Multi-Market
   =========================================================== */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════
     1. CONSTANTS & MARKETS
  ══════════════════════════════════════════════════════ */
  const MIN_STAKE    = 0.35;
  const MIN_WITHDRAW = 1.00;
  const KES_RATE     = 130;

  const MARKETS = [
    { id: 'v100', name: 'Volatility 100 (1s) Index', symbol: 'V100 (1s)', base: 730.03, vol: 0.0006 },
    { id: 'v75',  name: 'Volatility 75 Index',       symbol: 'V75',       base: 12485.20, vol: 0.0004 },
    { id: 'v50',  name: 'Volatility 50 Index',       symbol: 'V50',       base: 5932.10,  vol: 0.0003 },
    { id: 'v25',  name: 'Volatility 25 Index',       symbol: 'V25',       base: 2318.75,  vol: 0.00025 },
    { id: 'v10',  name: 'Volatility 10 Index',       symbol: 'V10',       base: 1045.60,  vol: 0.0002 },
  ];

  /* ══════════════════════════════════════════════════════
     2. STATE MANAGEMENT
  ══════════════════════════════════════════════════════ */
  let state = {
    user:         { name: 'Trader', email: '' },
    balance:      0,
    transactions: [],
  };

  let firestoreUid = null;

  function getUid() {
    if (firestoreUid) return firestoreUid;
    if (typeof auth !== 'undefined' && auth.currentUser) {
      firestoreUid = auth.currentUser.uid;
      return firestoreUid;
    }
    let cached = localStorage.getItem('et_uid');
    if (!cached) {
      cached = 'usr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('et_uid', cached);
    }
    firestoreUid = cached;
    return firestoreUid;
  }

  async function saveState(s) {
    try {
      localStorage.setItem('et_state_cache', JSON.stringify({
        balance: s.balance,
        transactions: s.transactions.slice(-200)
      }));
    } catch (_) {}

    const uid = getUid();
    if (!uid || typeof db === 'undefined') return;
    try {
      await db.collection('users').doc(uid).set({
        balance:      s.balance,
        transactions: s.transactions.slice(-200),
      }, { merge: true });
    } catch (err) {
      console.warn('Firestore write failed:', err.message);
    }
  }

  /* ── Interactive Trading Controls State ── */
  let currentMarketIdx    = 0;
  let currentPrices       = MARKETS.map(m => m.base);
  let marketHighs         = MARKETS.map(m => parseFloat((m.base + m.base * 0.005).toFixed(2)));
  let marketLows          = MARKETS.map(m => parseFloat((m.base - m.base * 0.005).toFixed(2)));
  let selectedBarrier     = 5;
  let currentTradeMode    = 'manual'; // manual, auto, ai
  let currentCategory     = 'digits'; // digits, risefall, multipliers
  let currentDigitSubmode = 'over_under'; // over_under, even_odd, matches_differs
  let currentDuration     = '1m';
  let currentStake        = 10;
  let openPositions       = [];
  let closedPositions     = [];

  // Chart and Digits series
  let chartTicks          = [];
  let lastDigitsHistory   = [];

  // Populate initial realistic history
  (function initHistory() {
    const baseP = MARKETS[0].base;
    for (let i = 0; i < 60; i++) {
      const p = baseP + Math.sin(i * 0.15) * 2 + ((Math.random() - 0.49) * 1.5);
      const fixP = parseFloat(p.toFixed(2));
      chartTicks.push(fixP);
      lastDigitsHistory.push(parseInt(fixP.toFixed(2).slice(-1)));
    }
  })();

  /* ══════════════════════════════════════════════════════
     3. DOM ELEMENTS
  ══════════════════════════════════════════════════════ */
  const balanceEl            = document.getElementById('dashBalance');
  const panelBalanceEl       = document.getElementById('panelAvailableBalance');
  const livePriceEl          = document.getElementById('livePrice');
  const priceChangeEl        = document.getElementById('priceChange');
  const liveLastDigitEl      = document.getElementById('liveLastDigit');
  const statHighEl           = document.getElementById('statHigh');
  const statLowEl            = document.getElementById('statLow');
  const selectedMarketNameEl = document.getElementById('selectedMarketName');
  const marketDropdownBtn    = document.getElementById('marketDropdownTrigger');
  const marketMenuEl         = document.getElementById('marketMenu');
  const digitsGridEl         = document.getElementById('digitsGrid');
  const stakeInputEl         = document.getElementById('stakeInput');
  const stakeMinusBtn        = document.getElementById('stakeMinus');
  const stakePlusBtn         = document.getElementById('stakePlus');
  const stakeKesConversionEl = document.getElementById('stakeKesConversion');
  const selectedBarrierBadge = document.getElementById('selectedBarrierBadge');
  const balanceStatusHint    = document.getElementById('balanceStatusHint');

  // Execution buttons
  const digitsActionsBox     = document.getElementById('digitsActions');
  const riseFallActionsBox   = document.getElementById('riseFallActions');
  const barrierRowEl         = document.getElementById('barrierRow');
  const durationRowEl        = document.getElementById('durationRow');
  const digitsSubmodesBox    = document.getElementById('digitsSubmodes');
  const btnOver              = document.getElementById('btnOver');
  const btnUnder             = document.getElementById('btnUnder');
  const lblOver              = document.getElementById('lblOver');
  const lblUnder             = document.getElementById('lblUnder');
  const pctOver              = document.getElementById('pctOver');
  const pctUnder             = document.getElementById('pctUnder');
  const payoutOver           = document.getElementById('payoutOver');
  const payoutUnder          = document.getElementById('payoutUnder');
  const riseBtn              = document.getElementById('riseBtn');
  const fallBtn              = document.getElementById('fallBtn');

  // Positions Drawer
  const tabOpenPositions     = document.getElementById('tabOpenPositions');
  const tabClosedPositions   = document.getElementById('tabClosedPositions');
  const openCountEl          = document.getElementById('openCount');
  const closedCountEl        = document.getElementById('closedCount');
  const openPositionsEmpty   = document.getElementById('openPositionsEmpty');
  const openPositionsList    = document.getElementById('openPositionsList');
  const closedPositionsEmpty = document.getElementById('closedPositionsEmpty');
  const closedPositionsList  = document.getElementById('closedPositionsList');

  // Canvas
  const canvas               = document.getElementById('marketChart');
  const ctx                  = canvas?.getContext('2d');

  // Modals
  const depositModal         = document.getElementById('depositModal');
  const withdrawModal        = document.getElementById('withdrawModal');
  const resultOverlay        = document.getElementById('tradeResult');
  const depositBtn           = document.querySelectorAll('[data-open-deposit]');
  const withdrawBtn          = document.querySelectorAll('[data-open-withdraw]');

  /* ══════════════════════════════════════════════════════
     4. FORMATTERS & UI SYNCS
  ══════════════════════════════════════════════════════ */
  function fmt(n) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function updateBalanceUI(flash) {
    const b = fmt(state.balance);
    if (balanceEl) balanceEl.textContent = b;
    if (panelBalanceEl) panelBalanceEl.textContent = b;
    const modalBalanceEl = document.getElementById('modalBalance');
    if (modalBalanceEl) modalBalanceEl.textContent = b;

    updateExecutionControls();
  }

  /* ══════════════════════════════════════════════════════
     5. HIGH-FIDELITY LIVE NEON CANVAS CHART
  ══════════════════════════════════════════════════════ */
  function drawRoundedRect(targetCtx, x, y, w, h, r) {
    targetCtx.beginPath();
    targetCtx.moveTo(x + r, y);
    targetCtx.lineTo(x + w - r, y);
    targetCtx.quadraticCurveTo(x + w, y, x + w, y + r);
    targetCtx.lineTo(x + w, y + h - r);
    targetCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    targetCtx.lineTo(x + r, y + h);
    targetCtx.quadraticCurveTo(x, y + h, x, y + h - r);
    targetCtx.lineTo(x, y + r);
    targetCtx.quadraticCurveTo(x, y, x + r, y);
    targetCtx.closePath();
  }

  function resizeCanvas() {
    if (!canvas || !canvas.parentElement) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    renderChart();
  }

  window.addEventListener('resize', resizeCanvas);

  function updateXAxisTimestamps() {
    const xAxisEl = document.getElementById('chartXAxis');
    if (!xAxisEl) return;
    const now = Date.now();
    const count = 9;
    const stepSec = 11;
    let html = '';
    for (let i = count - 1; i >= 0; i--) {
      const t = new Date(now - i * stepSec * 1000);
      const mm = String(t.getMinutes()).padStart(2, '0');
      const ss = String(t.getSeconds()).padStart(2, '0');
      html += `<span class="st-x-time">${mm}:${ss}</span>`;
    }
    xAxisEl.innerHTML = html;
  }

  function renderChart() {
    if (!canvas || !ctx || chartTicks.length < 2) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Padding
    const padTop = 32;
    const padBottom = 35;
    const padRight = 85;
    const padLeft = 15;
    const drawW = w - padLeft - padRight;
    const drawH = h - padTop - padBottom;

    const rawMin = Math.min(...chartTicks);
    const rawMax = Math.max(...chartTicks);
    const rawRange = Math.max(0.2, rawMax - rawMin);
    const margin = rawRange * 0.22;
    const minP = rawMin - margin;
    const maxP = rawMax + margin;
    const range = Math.max(0.1, maxP - minP);

    // Update Y-axis coordinate numbers in DOM
    const yMaxEl = document.getElementById('yLevelMax');
    const yMidHighEl = document.getElementById('yLevelMidHigh');
    const yMidLowEl = document.getElementById('yLevelMidLow');
    const yMinEl = document.getElementById('yLevelMin');
    const currP = chartTicks[chartTicks.length - 1];

    if (yMaxEl) yMaxEl.textContent = (minP + range * 0.92).toFixed(2);
    if (yMidHighEl) yMidHighEl.textContent = (minP + range * 0.65).toFixed(2);
    if (yMidLowEl) yMidLowEl.textContent = (minP + range * 0.35).toFixed(2);
    if (yMinEl) yMinEl.textContent = (minP + range * 0.08).toFixed(2);

    // 1. Draw subtle horizontal grid lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    [0.08, 0.35, 0.65, 0.92].forEach(ratio => {
      const gy = padTop + drawH - ratio * drawH;
      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(w - 20, gy);
      ctx.stroke();
    });
    ctx.restore();

    // 2. Map coordinates
    const points = chartTicks.map((p, i) => {
      const x = padLeft + (i / (chartTicks.length - 1)) * drawW;
      const y = padTop + drawH - ((p - minP) / range) * drawH;
      return { x, y };
    });

    // 3. Smooth Bezier path
    function buildSmoothPath(targetCtx) {
      targetCtx.beginPath();
      targetCtx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? 0 : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        targetCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    }

    // 4. Fill glowing gradient under line
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + drawH);
    grad.addColorStop(0, 'rgba(0, 240, 144, 0.28)');
    grad.addColorStop(0.65, 'rgba(0, 240, 144, 0.04)');
    grad.addColorStop(1, 'rgba(0, 240, 144, 0)');

    ctx.save();
    buildSmoothPath(ctx);
    const lastPt = points[points.length - 1];
    ctx.lineTo(lastPt.x, padTop + drawH);
    ctx.lineTo(points[0].x, padTop + drawH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // 5. Draw neon glowing green line
    ctx.save();
    buildSmoothPath(ctx);
    ctx.strokeStyle = '#00f090';
    ctx.lineWidth = 2.4;
    ctx.shadowColor = '#00f090';
    ctx.shadowBlur = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    // 6. Draw horizontal dashed line across the entire chart width
    const currY = lastPt.y;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(0, 240, 144, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padLeft, currY);
    ctx.lineTo(w - padRight + 12, currY);
    ctx.stroke();
    ctx.restore();

    // 7. Draw solid neon green price pill badge [ 730.03 ]
    const badgeText = currP.toFixed(2);
    ctx.save();
    ctx.font = 'bold 11px Inter, sans-serif';
    const badgeMetrics = ctx.measureText(badgeText);
    const badgeW = Math.max(54, badgeMetrics.width + 12);
    const badgeH = 18;
    const badgeX = w - padRight + 12;
    const badgeY = currY - badgeH / 2;

    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fillStyle = '#00f090';
    ctx.shadowColor = 'rgba(0, 240, 144, 0.5)';
    ctx.shadowBlur = 8;
    ctx.fill();

    ctx.fillStyle = '#0a0d14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, badgeX + badgeW / 2, currY + 0.5);
    ctx.restore();

    // 8. Pulsing head dot on the line
    ctx.save();
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 240, 144, 0.35)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00f090';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();

    // 9. Update rolling X-axis timestamps
    updateXAxisTimestamps();
  }

  /* ══════════════════════════════════════════════════════
     6. DERIV LIVE WEBSOCKET & 1S TICK ENGINE
  ══════════════════════════════════════════════════════ */
  let derivWs = null;
  let derivSubscribedSymbol = null;
  let lastDerivTickTime = 0;

  function onNewTickReceived(nextP) {
    const m = MARKETS[currentMarketIdx];
    currentPrices[currentMarketIdx] = nextP;

    // Track High and Low
    if (nextP > marketHighs[currentMarketIdx]) marketHighs[currentMarketIdx] = nextP;
    if (nextP < marketLows[currentMarketIdx]) marketLows[currentMarketIdx] = nextP;

    // Last Digit
    const lastDigit = parseInt(nextP.toFixed(2).slice(-1));
    lastDigitsHistory.push(lastDigit);
    if (lastDigitsHistory.length > 100) lastDigitsHistory.shift();

    // Add to chart series
    chartTicks.push(nextP);
    if (chartTicks.length > 70) chartTicks.shift();

    // Update Header UI
    if (livePriceEl) livePriceEl.textContent = nextP.toFixed(2);
    if (liveLastDigitEl) liveLastDigitEl.textContent = lastDigit;
    if (statHighEl) statHighEl.textContent = marketHighs[currentMarketIdx].toFixed(2);
    if (statLowEl) statLowEl.textContent = marketLows[currentMarketIdx].toFixed(2);

    const diffPct = (((nextP - m.base) / m.base) * 100).toFixed(2);
    if (priceChangeEl) {
      const isUp = Number(diffPct) >= 0;
      priceChangeEl.textContent = (isUp ? '▲ +' : '▼ ') + diffPct + '%';
      priceChangeEl.className = 'st-price-delta ' + (isUp ? 'up' : 'down');
    }

    renderChart();
    renderDigitsBar(lastDigit);
    stepOpenPositions(nextP, lastDigit);
  }

  function initDerivFeed() {
    const symbolMap = {
      'v100': '1HZ100V',
      'v75':  '1HZ75V',
      'v50':  '1HZ50V',
      'v25':  '1HZ25V',
      'v10':  '1HZ10V'
    };

    const targetSymbol = symbolMap[MARKETS[currentMarketIdx].id] || '1HZ100V';

    try {
      if (derivWs && derivWs.readyState === WebSocket.OPEN) {
        if (derivSubscribedSymbol !== targetSymbol) {
          derivWs.send(JSON.stringify({ forget_all: 'ticks' }));
          derivWs.send(JSON.stringify({ ticks: targetSymbol, subscribe: 1 }));
          derivSubscribedSymbol = targetSymbol;
        }
        return;
      }

      derivWs = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

      derivWs.onopen = () => {
        derivWs.send(JSON.stringify({ ticks: targetSymbol, subscribe: 1 }));
        derivSubscribedSymbol = targetSymbol;
      };

      derivWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.msg_type === 'tick' && data.tick) {
            lastDerivTickTime = Date.now();
            onNewTickReceived(parseFloat(Number(data.tick.quote).toFixed(2)));
          }
        } catch (_) {}
      };

      derivWs.onerror = () => {};
      derivWs.onclose = () => {
        derivWs = null;
      };
    } catch (_) {}
  }

  // Authentic 1s Deriv Stochastic Engine (continuous fallback)
  function tickEngine() {
    // If Deriv WebSocket is streaming recent ticks (< 1.5s old), let WS drive
    if (Date.now() - lastDerivTickTime < 1500) {
      return;
    }

    const m = MARKETS[currentMarketIdx];
    const old = currentPrices[currentMarketIdx];
    const meanReversion = (m.base - old) * 0.015;
    const randomWalk = (Math.random() - 0.495) * (m.base * m.vol);
    const nextP = parseFloat(Math.max(1, old + randomWalk + meanReversion).toFixed(2));

    onNewTickReceived(nextP);
  }

  setInterval(tickEngine, 1000);
  initDerivFeed();

  /* ══════════════════════════════════════════════════════
     7. LIVE LAST DIGITS ANALYSIS BAR
  ══════════════════════════════════════════════════════ */
  function renderDigitsBar(activeDigit) {
    if (!digitsGridEl) return;

    // Calculate percentage frequency for digits 0 - 9 over lastDigitsHistory
    const counts = Array(10).fill(0);
    lastDigitsHistory.forEach(d => {
      if (d >= 0 && d <= 9) counts[d]++;
    });
    const total = Math.max(1, lastDigitsHistory.length);

    const circumference = 2 * Math.PI * 16; // ~100.53

    let html = '';
    for (let i = 0; i <= 9; i++) {
      const pct = Math.round((counts[i] / total) * 100);
      const isCurr = (i === activeDigit) ? 'is-current' : '';
      const isSelected = (i === selectedBarrier) ? 'selected-barrier' : '';
      const offset = circumference - (circumference * pct) / 100;

      html += `
        <div class="st-digit-card ${isCurr} ${isSelected}" data-digit="${i}" title="Set barrier to ${i}">
          <div class="st-digit-indicator">${isCurr ? '&#9660;' : ''}</div>
          <div class="st-digit-gauge-wrap">
            <svg class="st-digit-gauge-svg" viewBox="0 0 38 38">
              <circle class="st-digit-gauge-track" cx="19" cy="19" r="16" />
              <circle
                class="st-digit-gauge-fill"
                cx="19"
                cy="19"
                r="16"
                stroke-dasharray="${circumference.toFixed(2)}"
                stroke-dashoffset="${offset.toFixed(2)}"
              />
            </svg>
            <span class="st-digit-num-center">${i}</span>
          </div>
          <span class="st-digit-pct">${pct}%</span>
        </div>
      `;
    }

    digitsGridEl.innerHTML = html;

    // Attach click listeners to set barrier directly
    digitsGridEl.querySelectorAll('.st-digit-card').forEach(card => {
      card.addEventListener('click', () => {
        const digit = parseInt(card.dataset.digit);
        selectedBarrier = digit;
        if (selectedBarrierBadge) selectedBarrierBadge.textContent = digit;
        renderDigitsBar(activeDigit);
        updateExecutionControls();
      });
    });
  }

  /* ══════════════════════════════════════════════════════
     8. MARKET DROPDOWN SELECTOR
  ══════════════════════════════════════════════════════ */
  if (marketDropdownBtn && marketMenuEl) {
    marketDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      marketMenuEl.style.display = (marketMenuEl.style.display === 'none') ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!marketMenuEl.contains(e.target) && e.target !== marketDropdownBtn) {
        marketMenuEl.style.display = 'none';
      }
    });

    marketMenuEl.querySelectorAll('.st-market-opt').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        marketMenuEl.querySelectorAll('.st-market-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        marketMenuEl.style.display = 'none';

        currentMarketIdx = idx;
        const m = MARKETS[idx];
        if (selectedMarketNameEl) selectedMarketNameEl.textContent = m.name;

        // Reset series for new market
        chartTicks = [];
        for (let i = 0; i < 50; i++) {
          chartTicks.push(parseFloat((m.base + (Math.random() - 0.49) * 2).toFixed(2)));
        }
        initDerivFeed();
        renderChart();
        updateExecutionControls();
      });
    });
  }

  /* ══════════════════════════════════════════════════════
     9. TRADING CONTROLS & DYNAMIC PAYOUTS
  ══════════════════════════════════════════════════════ */
  // Mode switcher: Manual / Auto / AI
  document.querySelectorAll('.st-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTradeMode = btn.dataset.mode;
      if (currentTradeMode === 'ai') {
        showToast('AI Market Analysis mode engaged.', 'info');
      }
    });
  });

  // Category switcher: Rise/Fall | Digits | Multipliers
  document.querySelectorAll('.st-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.category;

      if (currentCategory === 'risefall') {
        if (digitsActionsBox) digitsActionsBox.style.display = 'none';
        if (riseFallActionsBox) riseFallActionsBox.style.display = 'grid';
        if (barrierRowEl) barrierRowEl.style.display = 'none';
        if (durationRowEl) durationRowEl.style.display = 'flex';
        if (digitsSubmodesBox) digitsSubmodesBox.style.display = 'none';
      } else {
        if (digitsActionsBox) digitsActionsBox.style.display = 'grid';
        if (riseFallActionsBox) riseFallActionsBox.style.display = 'none';
        if (barrierRowEl) barrierRowEl.style.display = 'flex';
        if (durationRowEl) durationRowEl.style.display = 'none';
        if (digitsSubmodesBox) digitsSubmodesBox.style.display = 'grid';
      }

      updateExecutionControls();
    });
  });

  // Digits submodes: Over/Under | Even/Odd | Matches/Differs
  document.querySelectorAll('.st-submode-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.st-submode-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentDigitSubmode = pill.dataset.digitMode;
      updateExecutionControls();
    });
  });

  // Duration pills for Rise/Fall
  document.querySelectorAll('.st-dur-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.st-dur-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentDuration = pill.dataset.dur;
    });
  });

  // Stake input & Steppers
  function setStake(amount) {
    currentStake = Math.max(MIN_STAKE, parseFloat(Number(amount).toFixed(2)));
    if (stakeInputEl) stakeInputEl.value = currentStake;
    updateExecutionControls();
  }

  if (stakeMinusBtn) stakeMinusBtn.addEventListener('click', () => setStake(currentStake - 1));
  if (stakePlusBtn) stakePlusBtn.addEventListener('click', () => setStake(currentStake + 1));
  if (stakeInputEl) {
    stakeInputEl.addEventListener('input', (e) => setStake(parseFloat(e.target.value) || 0));
  }

  // Quick Chips
  document.querySelectorAll('.st-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.st-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      setStake(parseFloat(chip.dataset.stake));
    });
  });

  function updateExecutionControls() {
    // 1. KES Conversion
    const kes = Math.round(currentStake * KES_RATE);
    if (stakeKesConversionEl) {
      stakeKesConversionEl.textContent = `~ KES ${kes.toLocaleString()}`;
    }

    // 2. Digits Payout Calculation (SinTrades matching formula)
    const B = selectedBarrier;
    const overWinningDigits  = Math.max(1, 9 - B);
    const underWinningDigits = Math.max(1, B);

    // Dynamic Payouts matching SinTrades reference (Barrier 5 -> +138% Over / +90% Under)
    const overPctVal  = Math.max(10, Math.round(((10 / overWinningDigits) * 0.95 - 1) * 100));
    const underPctVal = Math.max(10, Math.round(((10 / underWinningDigits) * 0.95 - 1) * 100));

    const payoutOverVal  = (currentStake * (1 + overPctVal / 100)).toFixed(2);
    const payoutUnderVal = (currentStake * (1 + underPctVal / 100)).toFixed(2);

    if (lblOver) lblOver.textContent = `OVER ${B}`;
    if (pctOver) pctOver.textContent = `+${overPctVal}%`;
    if (payoutOver) payoutOver.textContent = `Payout $${payoutOverVal}`;

    if (lblUnder) lblUnder.textContent = `UNDER ${B}`;
    if (pctUnder) pctUnder.textContent = `+${underPctVal}%`;
    if (payoutUnder) payoutUnder.textContent = `Payout $${payoutUnderVal}`;

    // Rise/Fall Payouts
    const risePayoutVal = (currentStake * 1.95).toFixed(2);
    const payoutRiseEl = document.getElementById('payoutRise');
    const payoutFallEl = document.getElementById('payoutFall');
    if (payoutRiseEl) payoutRiseEl.textContent = `Payout $${risePayoutVal}`;
    if (payoutFallEl) payoutFallEl.textContent = `Payout $${risePayoutVal}`;

    // 3. Balance verification hint
    if (balanceStatusHint) {
      if (currentStake > state.balance) {
        balanceStatusHint.style.display = 'block';
      } else {
        balanceStatusHint.style.display = 'none';
      }
    }
  }

  /* ══════════════════════════════════════════════════════
     10. EXECUTION & POSITIONS DRAWER
  ══════════════════════════════════════════════════════ */
  function placeContract(type, title, winCondition, profitVal) {
    if (currentStake > state.balance) {
      showToast('Insufficient balance. Please deposit funds.', 'error');
      openModal(depositModal);
      return;
    }

    // Deduct stake
    state.balance = parseFloat((state.balance - currentStake).toFixed(2));
    updateBalanceUI('lose');

    const m = MARKETS[currentMarketIdx];
    const pos = {
      id: 'POS-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      market: m.symbol,
      type: title,
      stake: currentStake,
      profit: parseFloat(profitVal),
      entrySpot: currentPrices[currentMarketIdx],
      entryDigit: parseInt(currentPrices[currentMarketIdx].toFixed(2).slice(-1)),
      winCondition: winCondition,
      ticksRemaining: 5,
      createdAt: Date.now(),
    };

    openPositions.push(pos);
    renderPositions();
    showToast(`${title} contract placed on ${m.symbol}!`, 'info');
  }

  function stepOpenPositions(currPrice, currDigit) {
    if (openPositions.length === 0) return;

    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      pos.ticksRemaining--;

      if (pos.ticksRemaining <= 0) {
        // Contract settled
        const won = pos.winCondition(currPrice, currDigit);
        openPositions.splice(i, 1);

        if (won) {
          const payout = pos.stake + pos.profit;
          state.balance = parseFloat((state.balance + payout).toFixed(2));
          updateBalanceUI('win');
          showResultOverlay(true, pos.stake, pos.profit, state.balance);
        } else {
          showResultOverlay(false, pos.stake, pos.profit, state.balance);
          updateBalanceUI('lose');
        }

        // Add to closed positions
        closedPositions.unshift({
          ...pos,
          result: won ? 'win' : 'lose',
          closedPrice: currPrice,
          closedDigit: currDigit,
          closedAt: Date.now()
        });

        // Record in transactions
        state.transactions.push({
          type: 'trade',
          market: pos.market,
          direction: pos.type,
          stake: pos.stake,
          profit: won ? pos.profit : -pos.stake,
          result: won ? 'win' : 'lose',
          ts: Date.now()
        });

        saveState(state);
      }
    }

    renderPositions();
  }

  function renderPositions() {
    if (openCountEl) openCountEl.textContent = openPositions.length;
    if (closedCountEl) closedCountEl.textContent = closedPositions.length;

    // Open positions
    if (openPositions.length === 0) {
      if (openPositionsEmpty) openPositionsEmpty.style.display = 'block';
      if (openPositionsList) openPositionsList.style.display = 'none';
    } else {
      if (openPositionsEmpty) openPositionsEmpty.style.display = 'none';
      if (openPositionsList) {
        openPositionsList.style.display = 'block';
        openPositionsList.innerHTML = openPositions.map(p => `
          <div class="st-position-card">
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;font-weight:700;">
              <span>${p.type}</span>
              <span style="color:#a78bfa;">${p.ticksRemaining} ticks</span>
            </div>
            <div style="font-size:0.75rem;color:var(--st-text-dim);margin-top:4px;">
              ${p.market} &bull; Stake: ${fmt(p.stake)}
            </div>
          </div>
        `).join('');
      }
    }

    // Closed positions
    if (closedPositions.length === 0) {
      if (closedPositionsEmpty) closedPositionsEmpty.style.display = 'block';
      if (closedPositionsList) closedPositionsList.style.display = 'none';
    } else {
      if (closedPositionsEmpty) closedPositionsEmpty.style.display = 'none';
      if (closedPositionsList) {
        closedPositionsList.style.display = 'block';
        closedPositionsList.innerHTML = closedPositions.slice(0, 15).map(p => `
          <div class="st-position-card ${p.result}">
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;font-weight:700;">
              <span>${p.type}</span>
              <span style="color:${p.result === 'win' ? 'var(--st-neon-green)' : 'var(--st-red)'};">
                ${p.result === 'win' ? '+' + fmt(p.profit) : '−' + fmt(p.stake)}
              </span>
            </div>
            <div style="font-size:0.74rem;color:var(--st-text-dim);margin-top:4px;">
              ${p.market} &bull; Final Digit: ${p.closedDigit}
            </div>
          </div>
        `).join('');
      }
    }
  }

  // Position tabs toggling
  if (tabOpenPositions && tabClosedPositions) {
    tabOpenPositions.addEventListener('click', () => {
      tabOpenPositions.classList.add('active');
      tabClosedPositions.classList.remove('active');
      if (openPositionsList) openPositionsList.style.display = openPositions.length ? 'block' : 'none';
      if (openPositionsEmpty) openPositionsEmpty.style.display = openPositions.length ? 'none' : 'block';
      if (closedPositionsList) closedPositionsList.style.display = 'none';
      if (closedPositionsEmpty) closedPositionsEmpty.style.display = 'none';
    });

    tabClosedPositions.addEventListener('click', () => {
      tabClosedPositions.classList.add('active');
      tabOpenPositions.classList.remove('active');
      if (openPositionsList) openPositionsList.style.display = 'none';
      if (openPositionsEmpty) openPositionsEmpty.style.display = 'none';
      if (closedPositionsList) closedPositionsList.style.display = closedPositions.length ? 'block' : 'none';
      if (closedPositionsEmpty) closedPositionsEmpty.style.display = closedPositions.length ? 'none' : 'block';
    });
  }

  // Execution Listeners
  if (btnOver) {
    btnOver.addEventListener('click', () => {
      const B = selectedBarrier;
      const overWinningDigits = Math.max(1, 9 - B);
      const overPctVal = Math.max(10, Math.round(((10 / overWinningDigits) * 0.95 - 1) * 100));
      const profit = (currentStake * (overPctVal / 100)).toFixed(2);
      placeContract('OVER', `OVER ${B}`, (p, digit) => digit > B, profit);
    });
  }

  if (btnUnder) {
    btnUnder.addEventListener('click', () => {
      const B = selectedBarrier;
      const underWinningDigits = Math.max(1, B);
      const underPctVal = Math.max(10, Math.round(((10 / underWinningDigits) * 0.95 - 1) * 100));
      const profit = (currentStake * (underPctVal / 100)).toFixed(2);
      placeContract('UNDER', `UNDER ${B}`, (p, digit) => digit < B, profit);
    });
  }

  if (riseBtn) {
    riseBtn.addEventListener('click', () => {
      const entrySpot = currentPrices[currentMarketIdx];
      const profit = (currentStake * 0.95).toFixed(2);
      placeContract('RISE', 'RISE', (exitP) => exitP > entrySpot, profit);
    });
  }

  if (fallBtn) {
    fallBtn.addEventListener('click', () => {
      const entrySpot = currentPrices[currentMarketIdx];
      const profit = (currentStake * 0.95).toFixed(2);
      placeContract('FALL', 'FALL', (exitP) => exitP < entrySpot, profit);
    });
  }

  /* ══════════════════════════════════════════════════════
     11. TOAST & TRADE RESULT OVERLAY
  ══════════════════════════════════════════════════════ */
  const toastContainer = document.getElementById('toastContainer');

  function showToast(msg, type = 'info') {
    if (!toastContainer) return;
    const icons = {
      success: '<i data-lucide="check-circle-2" class="lucide-sm" style="color:var(--st-neon-green);"></i>',
      error:   '<i data-lucide="alert-circle" class="lucide-sm" style="color:var(--st-red);"></i>',
      info:    '<i data-lucide="info" class="lucide-sm" style="color:#a78bfa;"></i>',
    };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type === 'success' ? 'success' : type === 'error' ? 'error' : 'info'}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-text">${msg}</span>`;
    toastContainer.appendChild(toast);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => toast.remove(), 4000);
  }

  /* ══════════════════════════════════════════════════════
     12. TRADE RESULT OVERLAY
  ══════════════════════════════════════════════════════ */
  function showResultOverlay(won, stake, profit, newBalance) {
    if (!resultOverlay) return;

    const iconEl    = resultOverlay.querySelector('#resultIcon');
    const titleEl   = resultOverlay.querySelector('#resultTitle');
    const subEl     = resultOverlay.querySelector('#resultSub');
    const amountEl  = resultOverlay.querySelector('#resultAmount');
    const labelEl   = resultOverlay.querySelector('#resultAmountLabel');
    const balanceEl2 = resultOverlay.querySelector('#resultNewBalance');

    if (won) {
      if (iconEl)   { iconEl.innerHTML = '<i data-lucide="award" class="lucide-xl" style="color:var(--positive);"></i>'; }
      if (titleEl)  { titleEl.textContent = 'You Won!'; titleEl.className = 'result-title win'; }
      if (subEl)    subEl.textContent    = 'Your prediction was correct.';
      if (labelEl)  labelEl.textContent  = 'Profit Credited';
      if (amountEl) { amountEl.textContent = '+' + fmt(profit); amountEl.className = 'result-amount-value win'; }
    } else {
      if (iconEl)   { iconEl.innerHTML = '<i data-lucide="trending-down" class="lucide-xl" style="color:var(--negative);"></i>'; }
      if (titleEl)  { titleEl.textContent = 'Better Luck Next Time'; titleEl.className = 'result-title lose'; }
      if (subEl)    subEl.textContent    = 'The market moved against you.';
      if (labelEl)  labelEl.textContent  = 'Stake Lost';
      if (amountEl) { amountEl.textContent = '−' + fmt(stake); amountEl.className = 'result-amount-value lose'; }
    }

    if (window.lucide) lucide.createIcons();

    if (balanceEl2) balanceEl2.innerHTML = `New balance: <strong>${fmt(newBalance)}</strong>`;

    resultOverlay.classList.add('show');
  }

  // Close result overlay
  document.getElementById('closeResult')?.addEventListener('click', () => {
    resultOverlay?.classList.remove('show');
  });

  resultOverlay?.addEventListener('click', (e) => {
    if (e.target === resultOverlay) resultOverlay.classList.remove('show');
  });

  /* ══════════════════════════════════════════════════════
     11. DEPOSIT MODAL
  ══════════════════════════════════════════════════════ */
  function openModal(modal) { modal?.classList.add('show'); }
  function closeModal(modal) { modal?.classList.remove('show'); }

  depositBtn.forEach(b => b.addEventListener('click', () => openModal(depositModal)));
  withdrawBtn.forEach(b => b.addEventListener('click', () => openModal(withdrawModal)));

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(depositModal);
      closeModal(withdrawModal);
    });
  });

  // Close on backdrop click
  [depositModal, withdrawModal].forEach(modal => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  /* ─── Method field configs per payment method ─────────── */
  const METHOD_FIELDS = {
    'M-Pesa': {
      label:       'M-Pesa Number',
      placeholder: '07xx xxx xxx',
      hint:        'Accepted: 07xxxxxxxx \u00a0|\u00a0 01xxxxxxxx \u00a0|\u00a0 +2547xxxxxxxx \u00a0|\u00a0 +2541xxxxxxxx',
      type:        'tel',
    },
    'PayPal': {
      label:       'PayPal Email Address',
      placeholder: 'you@example.com',
      hint:        'Enter the email address linked to your PayPal account.',
      type:        'email',
    },
    'USDT': {
      label:       'USDT Wallet Address (TRC20)',
      placeholder: 'T...',
      hint:        'Enter your TRC20 USDT wallet address. Double-check before submitting.',
      type:        'text',
    },
  };

  function applyMethodField(methodName) {
    const cfg       = METHOD_FIELDS[methodName] || METHOD_FIELDS['M-Pesa'];
    const labelEl   = document.getElementById('withdrawAccountLabel');
    const inputEl   = document.getElementById('withdrawAccount');
    const hintEl    = document.getElementById('withdrawAccountHint');
    const errorEl   = document.getElementById('withdrawAccountError');
    if (labelEl)   labelEl.textContent   = cfg.label;
    if (inputEl) {
      inputEl.placeholder = cfg.placeholder;
      inputEl.type        = cfg.type === 'email' ? 'email' : 'text';
      inputEl.value       = '';
    }
    if (hintEl)    hintEl.textContent    = cfg.hint;
    if (errorEl) { errorEl.textContent   = ''; errorEl.style.display = 'none'; }
  }

  // Method pill selection: deposit and withdraw
  document.querySelectorAll('.method-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const grid = pill.closest('.method-grid');
      grid.querySelectorAll('.method-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      // If this pill is inside the withdraw modal, update account field
      if (pill.closest('#withdrawModal')) {
        const method = pill.querySelector('.method-name')?.textContent.trim();
        applyMethodField(method);
      }
    });
  });

  /* ════════════════════════════════════════════════════════════
     11b. DEPOSIT METHOD PANELS: show/hide based on selection
  ════════════════════════════════════════════════════════════ */
  function showDepositPanel(method) {
    ['mpesa', 'paypal', 'usdt'].forEach(m => {
      const el = document.getElementById('panel-' + m);
      if (el) el.style.display = (m === method) ? '' : 'none';
    });

    // Render PayPal buttons when PayPal panel is shown
    if (method === 'paypal') initPayPalButtons();
  }

  // Wire deposit method pills
  document.querySelectorAll('#depositMethodGrid .method-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#depositMethodGrid .method-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      showDepositPanel(pill.dataset.method);
    });
  });

  // KES quick-amount buttons
  document.querySelectorAll('[data-mpesa-amount]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('mpesaAmount');
      if (input) { input.value = btn.dataset.mpesaAmount; input.dispatchEvent(new Event('input')); }
    });
  });

  // PayPal quick-amount buttons
  document.querySelectorAll('[data-paypal-amount]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('paypalAmount');
      if (input) input.value = btn.dataset.paypalAmount;
    });
  });

  // Live KES → USD conversion hint
  document.getElementById('mpesaAmount')?.addEventListener('input', (e) => {
    const kes    = parseFloat(e.target.value) || 0;
    const usd    = (kes / KES_RATE).toFixed(2);
    const hint   = document.getElementById('mpesaConversion');
    if (hint) hint.textContent = `Equivalent: ~$${usd} USD (rate: 1 USD = ${KES_RATE} KES)`;
  });

  // USDT copy address
  document.getElementById('copyUsdtAddress')?.addEventListener('click', () => {
    const addr = document.getElementById('usdtWalletAddress')?.textContent?.trim();
    if (addr && navigator.clipboard) {
      navigator.clipboard.writeText(addr).then(() => showToast('Wallet address copied!', 'success'));
    }
  });

  // M-Pesa cancel waiting
  document.getElementById('mpesaCancelWait')?.addEventListener('click', () => {
    document.getElementById('mpesaWaiting').style.display  = 'none';
    document.getElementById('mpesaDepositForm').style.display = '';
    if (mpesaUnsubscribe) { mpesaUnsubscribe(); mpesaUnsubscribe = null; }
  });

  function showDepositError(msg) {
    const el = document.getElementById('depositError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function hideDepositError() {
    const el = document.getElementById('depositError');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }

  /* ═══════════════════════════════════════════════════════════
     11c. M-PESA DEPOSIT: PayHero STK Push via Cloud Function
  ═══════════════════════════════════════════════════════════ */
  let mpesaUnsubscribe = null; // Firestore listener cleanup

  document.getElementById('mpesaDepositForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideDepositError();

    const phone    = document.getElementById('mpesaPhone')?.value.trim();
    const kes      = parseInt(document.getElementById('mpesaAmount')?.value);
    const btn      = document.getElementById('mpesaDepositBtn');

    if (!phone || !/^(\+?254[17]\d{8}|0[17]\d{8})$/.test(phone.replace(/\s/g, ''))) {
      showDepositError('Enter a valid M-Pesa number (07xx, 01xx, +2547xx or +2541xx).'); return;
    }
    if (!kes || kes < 130) {
      showDepositError('Minimum deposit is $1.00 (KES 130).'); return;
    }

    btn.textContent = 'Sending prompt…';
    btn.disabled    = true;

    try {
      const activeUid = getUid();
      const apiRes = await fetch('/api/initiate-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_kes: kes, phone, uid: activeUid })
      });

      const resData = await apiRes.json().catch(() => null);

      if (!apiRes.ok || !resData || !resData.success) {
        const errMsg = (resData && resData.error) || 'Failed to initiate deposit. Please try again.';
        throw new Error(errMsg);
      }

      const result = { data: resData };
      const ref = result.data.reference;

      // Switch to waiting UI
      document.getElementById('mpesaDepositForm').style.display = 'none';
      document.getElementById('mpesaWaiting').style.display     = '';

      // Listen for Firestore status change (updated by PayHero callback)
      if (typeof db !== 'undefined') {
        mpesaUnsubscribe = db.collection('pending_deposits').doc(ref)
          .onSnapshot((snap) => {
            const data = snap.data();
            if (!data) return;

            if (data.status === 'completed') {
              if (mpesaUnsubscribe) { mpesaUnsubscribe(); mpesaUnsubscribe = null; }

              // Reload user balance from Firestore
              db.collection('users').doc(activeUid).get().then(userDoc => {
                if (userDoc.exists) {
                  const d = userDoc.data();
                  state.balance      = d.balance || 0;
                  state.transactions = d.transactions || [];
                  updateBalanceUI('win');
                  updateStats();
                  renderHistory();
                }
              }).catch(() => {});

              closeModal(depositModal);
              document.getElementById('mpesaWaiting').style.display     = 'none';
              document.getElementById('mpesaDepositForm').style.display  = '';
              document.getElementById('mpesaDepositForm').reset();
              btn.textContent = 'Send M-Pesa Prompt';
              btn.disabled    = false;
              showToast(`Deposit of KES ${kes} (~$${data.amount_usd}) confirmed!`, 'success');

            } else if (data.status === 'failed' || data.status === 'cancelled') {
              if (mpesaUnsubscribe) { mpesaUnsubscribe(); mpesaUnsubscribe = null; }
              document.getElementById('mpesaWaiting').style.display     = 'none';
              document.getElementById('mpesaDepositForm').style.display  = '';
              btn.textContent = 'Send M-Pesa Prompt';
              btn.disabled    = false;
              showDepositError('Payment was ' + data.status + '. Please try again.');
            }
          }, (err) => {
            console.warn('Firestore pending_deposits listener:', err.message);
          });
      }

    } catch (err) {
      btn.textContent = 'Send M-Pesa Prompt';
      btn.disabled    = false;
      showDepositError(err.message || 'Could not initiate M-Pesa payment. Try again.');
      console.error('M-Pesa deposit error:', err);
    }
  });

  /* ═══════════════════════════════════════════════════════════
     11d. PAYPAL DEPOSIT: PayPal JS SDK + Cloud Function capture
  ═══════════════════════════════════════════════════════════ */
  let paypalButtonsRendered = false;

  function initPayPalButtons() {
    const container = document.getElementById('paypal-button-container');
    if (!container || paypalButtonsRendered) return;

    // Load PayPal SDK if not already loaded
    if (typeof paypal === 'undefined') {
      const clientId = (typeof PAYPAL_CLIENT_ID !== 'undefined') ? PAYPAL_CLIENT_ID : 'test';
      const script   = document.createElement('script');
      script.src     = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
      script.onload  = renderPayPalButtons;
      document.body.appendChild(script);
    } else {
      renderPayPalButtons();
    }
  }

  function renderPayPalButtons() {
    const container = document.getElementById('paypal-button-container');
    if (!container || paypalButtonsRendered) return;
    paypalButtonsRendered = true;

    paypal.Buttons({
      style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },

      createOrder: (data, actions) => {
        const amount = parseFloat(document.getElementById('paypalAmount')?.value);
        if (!amount || amount < 1) {
          showDepositError('Enter an amount (minimum $1.00) before clicking PayPal.');
          return Promise.reject(new Error('Missing amount'));
        }
        hideDepositError();
        return actions.order.create({
          purchase_units: [{ amount: { value: amount.toFixed(2), currency_code: 'USD' } }],
        });
      },

      onApprove: async (data) => {
        showToast('Processing PayPal payment…', 'info');
        try {
          const capturePayPalOrder = firebase.functions().httpsCallable('capturePayPalOrder');
          const result = await capturePayPalOrder({ orderID: data.orderID });

          if (result.data.success) {
            // Reload balance from Firestore
            const userDoc = await db.collection('users').doc(firestoreUid).get();
            if (userDoc.exists) {
              const d = userDoc.data();
              state.balance      = d.balance || 0;
              state.transactions = d.transactions || [];
              updateBalanceUI('win');
              updateStats();
              renderHistory();
            }
            closeModal(depositModal);
            showToast(`PayPal deposit of $${result.data.amount_usd} confirmed!`, 'success');
          }
        } catch (err) {
          showDepositError('PayPal payment capture failed: ' + (err.message || 'Try again.'));
          console.error('PayPal capture error:', err);
        }
      },

      onError: (err) => {
        showDepositError('PayPal error. Please try again or use a different method.');
        console.error('PayPal error:', err);
      },

      onCancel: () => {
        showToast('PayPal payment cancelled.', 'info');
      },
    }).render('#paypal-button-container');
  }

  /* ─── M-Pesa number validator ──────────────────────── */
  // Accepts all Kenyan M-Pesa formats: 07xxxxxxxx, 01xxxxxxxx, +2547..., +2541...
  function validateMpesa(num) {
    const n = num.replace(/\s+/g, '');
    return /^(\+?254[17]\d{8}|0[17]\d{8})$/.test(n);
  }

  /* ═══════════════════════════════════════════════════════════
     11e. WITHDRAWAL: PayHero B2C via Cloud Function
  ═══════════════════════════════════════════════════════════ */
  const withdrawForm = document.getElementById('withdrawForm');
  withdrawForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount   = parseFloat(document.getElementById('withdrawAmount')?.value);
    const method   = withdrawModal?.querySelector('.method-pill.active')?.querySelector('.method-name')?.textContent?.trim();
    const account  = document.getElementById('withdrawAccount')?.value.trim();
    const errorEl  = document.getElementById('withdrawAccountError');

    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }

    if (!method) { showToast('Please select a withdrawal method.', 'error'); return; }
    if (!account) {
      if (errorEl) { errorEl.textContent = 'This field is required.'; errorEl.style.display = 'block'; }
      showToast('Please enter your account details.', 'error'); return;
    }
    if (method === 'M-Pesa' && !validateMpesa(account)) {
      const msg = 'Invalid M-Pesa number. Use: 07xxxxxxxx, 01xxxxxxxx, +2547xxxxxxxx or +2541xxxxxxxx';
      if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
      showToast('Invalid M-Pesa number format.', 'error'); return;
    }
    if (isNaN(amount) || amount < MIN_WITHDRAW) {
      showToast(`Minimum withdrawal is ${fmt(MIN_WITHDRAW)}`, 'error'); return;
    }
    if (amount > state.balance) {
      showToast('Insufficient balance.', 'error'); return;
    }

    const btn = withdrawForm.querySelector('[type="submit"]');
    btn.textContent = 'Processing…';
    btn.disabled    = true;

    try {
      if (method === 'M-Pesa') {
        const activeUid = getUid();
        const apiRes = await fetch('/api/initiate-withdrawal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount_usd: amount, phone: account, uid: activeUid })
        });
        const resData = await apiRes.json().catch(() => null);
        if (!apiRes.ok || !resData || !resData.success) {
          throw new Error((resData && resData.error) || 'Failed to initiate withdrawal');
        }

        // Reload balance from Firestore
        if (typeof db !== 'undefined') {
          db.collection('users').doc(activeUid).get().then(userDoc => {
            if (userDoc.exists) {
              const d = userDoc.data();
              state.balance      = d.balance || 0;
              state.transactions = d.transactions || [];
              updateBalanceUI('lose');
              updateStats();
              renderHistory();
            }
          }).catch(() => {});
        }
        closeModal(withdrawModal);
        showToast(resData.message || `Withdrawal of ${fmt(amount)} processed instantly.`, 'success');

      } else {
        // PayPal / USDT: manual processing (no B2C API yet)
        state.balance = parseFloat((state.balance - amount).toFixed(2));
        state.transactions.push({ type: 'withdrawal', amount: -amount, method, account, status: 'processing', ts: Date.now() });
        await saveState(state);
        updateBalanceUI('lose');
        updateStats();
        renderHistory();
        closeModal(withdrawModal);
        showToast(`Withdrawal of ${fmt(amount)} via ${method} processed instantly.`, 'success');
      }

    } catch (err) {
      showToast(err.message || 'Withdrawal failed. Please try again.', 'error');
      console.error('Withdrawal error:', err);
    } finally {
      btn.textContent = 'Confirm Withdrawal';
      btn.disabled    = false;
      withdrawForm.reset();
    }
  });


  /* ══════════════════════════════════════════════════════
     12. MOBILE MENU
  ══════════════════════════════════════════════════════ */
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
    });
  }

  /* ══════════════════════════════════════════════════════
     13. USER GREETING
  ══════════════════════════════════════════════════════ */
  const greetEl = document.getElementById('userGreeting');
  if (greetEl) {
    const u = state.user || {};
    greetEl.textContent = 'Hello, ' + (u.name || 'Trader');
  }

  /* ══════════════════════════════════════════════════════
     14. INITIALISE & AUTH
  ══════════════════════════════════════════════════════ */
  updateBalanceUI();
  updateExecutionControls();

  // Load cached state if available
  try {
    const cached = JSON.parse(localStorage.getItem('et_state_cache') || '{}');
    if (typeof cached.balance === 'number') state.balance = cached.balance;
    if (Array.isArray(cached.transactions)) {
      state.transactions = cached.transactions;
      closedPositions = cached.transactions
        .filter(t => t.type === 'trade')
        .map(t => ({
          id: 'POS-' + (t.ts || Date.now()).toString(36).toUpperCase(),
          type: t.direction || 'Trade',
          market: t.market || 'V100 (1s)',
          stake: t.stake || 0,
          profit: t.profit || 0,
          result: t.result || (t.profit > 0 ? 'win' : 'lose'),
          closedDigit: t.closedDigit !== undefined ? t.closedDigit : '-',
          closedAt: t.ts || Date.now()
        }));
      renderPositions();
    }
    updateBalanceUI();
  } catch (_) {}

  // Hook Firebase Auth listener
  if (typeof auth !== 'undefined') {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        firestoreUid = user.uid;
        localStorage.setItem('et_uid', user.uid);

        if (typeof db !== 'undefined') {
          db.collection('users').doc(user.uid).onSnapshot((doc) => {
            if (doc.exists) {
              const d = doc.data();
              state.user = {
                name: d.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Trader'),
                email: d.email || user.email || '',
              };
              if (typeof d.balance === 'number') state.balance = d.balance;
              if (Array.isArray(d.transactions)) state.transactions = d.transactions;

              updateBalanceUI();
              if (Array.isArray(d.transactions)) {
                closedPositions = d.transactions
                  .filter(t => t.type === 'trade')
                  .map(t => ({
                    id: 'POS-' + (t.ts || Date.now()).toString(36).toUpperCase(),
                    type: t.direction || 'Trade',
                    market: t.market || 'V100 (1s)',
                    stake: t.stake || 0,
                    profit: t.profit || 0,
                    result: t.result || (t.profit > 0 ? 'win' : 'lose'),
                    closedDigit: t.closedDigit !== undefined ? t.closedDigit : '-',
                    closedAt: t.ts || Date.now()
                  }));
                renderPositions();
              }
              const greetEl = document.getElementById('userGreeting');
              if (greetEl) greetEl.textContent = 'Hello, ' + state.user.name;
            }
          }, (err) => console.warn('Firestore snapshot error:', err.message));
        }
      } else {
        firestoreUid = getUid();
      }
    });
  } else {
    firestoreUid = getUid();
  }

  // Sign out listener
  document.querySelectorAll('[data-signout]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        if (typeof auth !== 'undefined') await auth.signOut();
      } catch (_) {}
      localStorage.removeItem('et_state_cache');
      window.location.href = 'login.html';
    });
  });

  // Initial Boot Calls
  resizeCanvas();
  renderDigitsBar(parseInt(currentPrices[currentMarketIdx].toFixed(2).slice(-1)));
  updateExecutionControls();
  renderPositions();
  updateBalanceUI();
  if (window.lucide) lucide.createIcons();

  // Show onboarding toast if balance is 0
  if (state.balance === 0) {
    setTimeout(() => {
      showToast('Welcome! Make your first deposit to start trading.', 'info');
    }, 1000);
  }

})();
