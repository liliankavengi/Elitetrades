/* ===========================================================
   ELITETRADES — dashboard.js
   Wallet | Deposit | Withdraw | Trading Engine (35% payout)
   =========================================================== */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════
     CONSTANTS & CONFIG
  ══════════════════════════════════════════════════════ */
  const PAYOUT_RATE    = 0.35;   // Win $0.35 per $1 staked
  const WIN_CHANCE     = 0.47;   // 47% chance of winning per trade
  const MIN_STAKE      = 0.35;
  const MIN_WITHDRAW   = 1.00;

  const MARKETS = [
    { id: 'v100', name: 'Volatility 100 Index', symbol: 'V100', base: 8842.50,  vol: 0.0005 },
    { id: 'v75',  name: 'Volatility 75 Index',  symbol: 'V75',  base: 12485.20, vol: 0.0004 },
    { id: 'v50',  name: 'Volatility 50 Index',  symbol: 'V50',  base: 5932.10,  vol: 0.0003 },
    { id: 'v25',  name: 'Volatility 25 Index',  symbol: 'V25',  base: 2318.75,  vol: 0.00025 },
    { id: 'v10',  name: 'Volatility 10 Index',  symbol: 'V10',  base: 1045.60,  vol: 0.0002 },
  ];

  const DURATIONS = ['15s', '30s', '1m', '2m', '5m'];

  /* ══════════════════════════════════════════════════════
     FIRESTORE STATE MANAGEMENT
  ══════════════════════════════════════════════════════ */

  // In-memory state — populated from Firestore after auth
  let state = {
    user:         { name: 'Trader', email: '' },
    balance:      0,
    transactions: [],
  };

  let firestoreUid = null;   // set after auth resolves

  /** Write state back to Firestore (keep last 200 transactions) */
  async function saveState(s) {
    // Always keep a local cache for instant UI updates
    try { localStorage.setItem('et_state_cache', JSON.stringify({ balance: s.balance, transactions: s.transactions.slice(-200) })); } catch (_) {}

    if (!firestoreUid) return;  // not yet authenticated
    try {
      await db.collection('users').doc(firestoreUid).update({
        balance:      s.balance,
        transactions: s.transactions.slice(-200), // keep last 200
      });
    } catch (err) {
      console.warn('Firestore write failed:', err.message);
    }
  }

  let currentMarketIdx = 0;
  let currentDuration  = '1m';
  let currentPrices    = MARKETS.map(m => m.base);
  let tradeInProgress  = false;
  let currentTab       = 'all';

  /* ══════════════════════════════════════════════════════
     DOM REFERENCES
  ══════════════════════════════════════════════════════ */
  const balanceEl     = document.getElementById('dashBalance');
  const stakeInput    = document.getElementById('stakeInput');
  const marketSelect  = document.getElementById('marketSelect');
  const livePriceEl   = document.getElementById('livePrice');
  const priceChangeEl = document.getElementById('priceChange');
  const potWinEl      = document.getElementById('potentialWin');
  const potReturnEl   = document.getElementById('potentialReturn');
  const stakeLabelEl  = document.getElementById('stakeBalanceLabel');

  // Stats
  const statBalance  = document.getElementById('statBalance');
  const statWins     = document.getElementById('statWins');
  const statLosses   = document.getElementById('statLosses');
  const statProfit   = document.getElementById('statProfit');

  // History
  const historyList  = document.getElementById('historyList');

  // Buttons
  const riseBtn   = document.getElementById('riseBtn');
  const fallBtn   = document.getElementById('fallBtn');
  const depositBtn  = document.querySelectorAll('[data-open-deposit]');
  const withdrawBtn = document.querySelectorAll('[data-open-withdraw]');

  // Modals
  const depositModal  = document.getElementById('depositModal');
  const withdrawModal = document.getElementById('withdrawModal');

  // Result overlay
  const resultOverlay = document.getElementById('tradeResult');

  /* ══════════════════════════════════════════════════════
     1. BALANCE & UI
  ══════════════════════════════════════════════════════ */
  function fmt(n) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function fmtPrice(n) {
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function updateBalanceUI(flash) {
    const b = fmt(state.balance);
    if (balanceEl) balanceEl.textContent = b;
    if (stakeLabelEl) stakeLabelEl.textContent = fmt(state.balance);
    if (statBalance) statBalance.textContent = b;
    // sync withdrawal modal balance label
    const modalBalanceEl = document.getElementById('modalBalance');
    if (modalBalanceEl) modalBalanceEl.textContent = fmt(state.balance);

    if (flash && balanceEl) {
      balanceEl.classList.remove('flash-win', 'flash-lose');
      void balanceEl.offsetWidth; // reflow
      balanceEl.classList.add(flash === 'win' ? 'flash-win' : 'flash-lose');
      setTimeout(() => balanceEl.classList.remove('flash-win', 'flash-lose'), 1000);
    }
  }

  function updateStats() {
    const trades  = state.transactions.filter(t => t.type === 'trade');
    const wins    = trades.filter(t => t.result === 'win');
    const losses  = trades.filter(t => t.result === 'lose');
    const profit  = wins.reduce((a, t) => a + t.profit, 0)
                  - losses.reduce((a, t) => a + Math.abs(t.profit), 0);

    if (statWins)   statWins.textContent   = wins.length;
    if (statLosses) statLosses.textContent = losses.length;
    if (statProfit) {
      statProfit.textContent = fmt(profit);
      statProfit.className   = 'dash-stat-value ' + (profit >= 0 ? 'positive' : 'negative');
    }
  }

  /* ══════════════════════════════════════════════════════
     2. PAYOUT PREVIEW
  ══════════════════════════════════════════════════════ */
  function updatePayoutPreview() {
    const stake = parseFloat(stakeInput?.value) || 0;
    const win   = parseFloat((stake * PAYOUT_RATE).toFixed(2));
    const total = parseFloat((stake + win).toFixed(2));
    const previewStakeEl = document.getElementById('previewStake');
    const potLossEl      = document.getElementById('potentialLoss');
    if (previewStakeEl)  previewStakeEl.textContent  = fmt(stake);
    if (potWinEl)        potWinEl.textContent         = '+' + fmt(win);
    if (potReturnEl)     potReturnEl.textContent      = fmt(total);
    if (potLossEl)       potLossEl.textContent        = '−' + fmt(stake);
  }

  /* ══════════════════════════════════════════════════════
     3. LIVE PRICE ENGINE
  ══════════════════════════════════════════════════════ */
  function tickPrice(idx) {
    const m   = MARKETS[idx];
    const old = currentPrices[idx];
    const chg = (Math.random() - 0.49) * m.base * m.vol;
    currentPrices[idx] = parseFloat((old + chg).toFixed(2));
    return { old, current: currentPrices[idx] };
  }

  function refreshLivePrice() {
    const { old, current } = tickPrice(currentMarketIdx);
    const isUp = current >= old;
    const diff = ((current - MARKETS[currentMarketIdx].base) / MARKETS[currentMarketIdx].base * 100).toFixed(3);

    if (livePriceEl) {
      livePriceEl.textContent = fmtPrice(current);
      livePriceEl.classList.remove('tick-up', 'tick-down');
      void livePriceEl.offsetWidth;
      livePriceEl.classList.add(isUp ? 'tick-up' : 'tick-down');
      setTimeout(() => livePriceEl.classList.remove('tick-up', 'tick-down'), 400);
    }

    if (priceChangeEl) {
      priceChangeEl.textContent = (diff >= 0 ? '+' : '') + diff + '%';
      priceChangeEl.className   = 'live-price-change ' + (diff >= 0 ? 'up' : 'down');
    }
  }

  setInterval(refreshLivePrice, 900);

  /* ══════════════════════════════════════════════════════
     4. MARKET SELECTOR
  ══════════════════════════════════════════════════════ */
  if (marketSelect) {
    MARKETS.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = m.name + ' (' + m.symbol + ')';
      marketSelect.appendChild(opt);
    });

    marketSelect.addEventListener('change', () => {
      currentMarketIdx = parseInt(marketSelect.value);
      if (livePriceEl) livePriceEl.textContent = fmtPrice(currentPrices[currentMarketIdx]);
    });
  }

  /* ══════════════════════════════════════════════════════
     5. DURATION PILLS
  ══════════════════════════════════════════════════════ */
  document.querySelectorAll('.duration-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.duration-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentDuration = pill.dataset.duration;
    });
  });

  /* ══════════════════════════════════════════════════════
     6. STAKE QUICK BUTTONS
  ══════════════════════════════════════════════════════ */
  document.querySelectorAll('.stake-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!stakeInput) return;
      const val = btn.dataset.value;
      if (val === 'all') {
        stakeInput.value = Math.max(0, state.balance).toFixed(2);
      } else {
        stakeInput.value = (parseFloat(stakeInput.value || 0) + parseFloat(val)).toFixed(2);
      }
      updatePayoutPreview();
    });
  });

  if (stakeInput) {
    stakeInput.addEventListener('input', updatePayoutPreview);
  }

  /* ══════════════════════════════════════════════════════
     7. TOAST NOTIFICATIONS
  ══════════════════════════════════════════════════════ */
  const toastContainer = document.getElementById('toastContainer');

  function showToast(msg, type = 'info') {
    if (!toastContainer) return;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', win: '🎉', lose: '😔' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type === 'win' || type === 'success' ? 'success' : type === 'lose' || type === 'error' ? 'error' : 'info'}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-text">${msg}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  /* ══════════════════════════════════════════════════════
     8. TRANSACTION HISTORY RENDERER
  ══════════════════════════════════════════════════════ */
  function timeAgo(ts) {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)   return 'Just now';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
    return new Date(ts).toLocaleDateString();
  }

  function renderHistory() {
    if (!historyList) return;

    const txns = state.transactions.filter(t => {
      if (currentTab === 'all')      return true;
      if (currentTab === 'trades')   return t.type === 'trade';
      if (currentTab === 'deposits') return t.type === 'deposit';
      if (currentTab === 'withdrawals') return t.type === 'withdraw';
      return true;
    }).slice().reverse(); // newest first

    if (txns.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <div class="empty-icon">📋</div>
          <p>No transactions yet.<br>Make a deposit to start trading.</p>
        </div>`;
      return;
    }

    historyList.innerHTML = txns.map(t => {
      if (t.type === 'deposit') {
        return `
          <div class="history-item">
            <div class="history-icon deposit">💳</div>
            <div class="history-info">
              <h4>Deposit — ${t.method}</h4>
              <span>${timeAgo(t.ts)}</span>
            </div>
            <div class="history-amount positive">+${fmt(t.amount)}</div>
          </div>`;
      }

      if (t.type === 'withdraw') {
        return `
          <div class="history-item">
            <div class="history-icon withdraw">🏧</div>
            <div class="history-info">
              <h4>Withdrawal — ${t.method}</h4>
              <span>${timeAgo(t.ts)} · ${t.status === 'pending' ? '<span style="color:var(--warning)">Pending</span>' : 'Completed'}</span>
            </div>
            <div class="history-amount negative">−${fmt(t.amount)}</div>
          </div>`;
      }

      if (t.type === 'trade') {
        const isWin = t.result === 'win';
        return `
          <div class="history-item">
            <div class="history-icon ${isWin ? 'win' : 'lose'}">${isWin ? '🏆' : '📉'}</div>
            <div class="history-info">
              <h4>${t.direction} — ${t.market} · ${t.duration}</h4>
              <span>${timeAgo(t.ts)} · Stake: ${fmt(t.stake)}</span>
            </div>
            <div class="history-amount ${isWin ? 'positive' : 'negative'}">
              ${isWin ? '+' + fmt(t.profit) : '−' + fmt(t.stake)}
            </div>
          </div>`;
      }

      return '';
    }).join('');
  }

  // Tab switching
  document.querySelectorAll('.history-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderHistory();
    });
  });

  /* ══════════════════════════════════════════════════════
     9. TRADE ENGINE
  ══════════════════════════════════════════════════════ */
  function executeTrade(direction) {
    if (tradeInProgress) return;

    const stake = parseFloat(stakeInput?.value);

    if (isNaN(stake) || stake < MIN_STAKE) {
      showToast(`Minimum stake is ${fmt(MIN_STAKE)}`, 'error');
      return;
    }

    if (stake > state.balance) {
      showToast('Insufficient balance. Please deposit first.', 'error');
      return;
    }

    tradeInProgress = true;
    if (riseBtn) riseBtn.disabled = true;
    if (fallBtn) fallBtn.disabled = true;

    // Deduct stake immediately
    state.balance = parseFloat((state.balance - stake).toFixed(2));
    updateBalanceUI();
    saveState(state);

    const market   = MARKETS[currentMarketIdx];
    const duration = currentDuration;

    // Show "waiting" for contract duration
    showToast(`${direction} contract on ${market.symbol} — waiting ${duration}…`, 'info');

    // Duration map → ms
    const durMs = { '15s': 3000, '30s': 5000, '1m': 7000, '2m': 9000, '5m': 12000 };
    const wait  = durMs[duration] || 5000;

    setTimeout(() => {
      const won    = Math.random() < WIN_CHANCE;
      const profit = parseFloat((stake * PAYOUT_RATE).toFixed(2));

      if (won) {
        const payout = stake + profit;
        state.balance = parseFloat((state.balance + payout).toFixed(2));
        updateBalanceUI('win');
        showResultOverlay(true, stake, profit, state.balance);
      } else {
        // Already deducted, show result
        showResultOverlay(false, stake, profit, state.balance);
        updateBalanceUI('lose');
      }

      // Record transaction
      state.transactions.push({
        type: 'trade',
        market: market.symbol,
        direction,
        stake,
        profit: won ? profit : -stake,
        result: won ? 'win' : 'lose',
        duration,
        ts: Date.now(),
      });

      saveState(state);
      updateStats();
      renderHistory();

      tradeInProgress = false;
      if (riseBtn) riseBtn.disabled = false;
      if (fallBtn) fallBtn.disabled = false;
    }, wait);
  }

  if (riseBtn) riseBtn.addEventListener('click', () => executeTrade('Rise'));
  if (fallBtn) fallBtn.addEventListener('click', () => executeTrade('Fall'));

  /* ══════════════════════════════════════════════════════
     10. TRADE RESULT OVERLAY
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
      if (iconEl)   iconEl.textContent   = '🏆';
      if (titleEl)  { titleEl.textContent = 'You Won!'; titleEl.className = 'result-title win'; }
      if (subEl)    subEl.textContent    = 'Your prediction was correct.';
      if (labelEl)  labelEl.textContent  = 'Profit Credited';
      if (amountEl) { amountEl.textContent = '+' + fmt(profit); amountEl.className = 'result-amount-value win'; }
    } else {
      if (iconEl)   iconEl.textContent   = '📉';
      if (titleEl)  { titleEl.textContent = 'Better Luck Next Time'; titleEl.className = 'result-title lose'; }
      if (subEl)    subEl.textContent    = 'The market moved against you.';
      if (labelEl)  labelEl.textContent  = 'Stake Lost';
      if (amountEl) { amountEl.textContent = '−' + fmt(stake); amountEl.className = 'result-amount-value lose'; }
    }

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

  // Method pill selection — deposit and withdraw
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
     11b. DEPOSIT METHOD PANELS — show/hide based on selection
  ════════════════════════════════════════════════════════════ */
  const KES_RATE = 130;

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
     11c. M-PESA DEPOSIT — PayHero STK Push via Cloud Function
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
      let result;
      try {
        const apiRes = await fetch('/api/initiate-deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount_kes: kes, phone, uid: firestoreUid })
        });
        const resData = await apiRes.json();
        if (!resData.success) throw new Error(resData.error || 'Failed to initiate deposit');
        result = { data: resData };
      } catch (fetchErr) {
        if (typeof firebase !== 'undefined' && firebase.functions) {
          const initiateDeposit = firebase.functions().httpsCallable('initiateDeposit');
          result = await initiateDeposit({ amount_kes: kes, phone });
        } else {
          throw fetchErr;
        }
      }

      if (result.data.success) {
        const ref = result.data.reference;

        // Switch to waiting UI
        document.getElementById('mpesaDepositForm').style.display = 'none';
        document.getElementById('mpesaWaiting').style.display     = '';

        // Listen for Firestore status change (updated by PayHero callback)
        mpesaUnsubscribe = db.collection('pending_deposits').doc(ref)
          .onSnapshot((snap) => {
            const data = snap.data();
            if (!data) return;

            if (data.status === 'completed') {
              mpesaUnsubscribe && mpesaUnsubscribe();
              mpesaUnsubscribe = null;

              // Reload user balance from Firestore
              db.collection('users').doc(firestoreUid).get().then(userDoc => {
                if (userDoc.exists) {
                  const d = userDoc.data();
                  state.balance      = d.balance || 0;
                  state.transactions = d.transactions || [];
                  updateBalanceUI('win');
                  updateStats();
                  renderHistory();
                }
              });

              closeModal(depositModal);
              document.getElementById('mpesaWaiting').style.display     = 'none';
              document.getElementById('mpesaDepositForm').style.display  = '';
              document.getElementById('mpesaDepositForm').reset();
              btn.textContent = 'Send M-Pesa Prompt';
              btn.disabled    = false;
              showToast(`Deposit of KES ${kes} (~$${data.amount_usd}) confirmed!`, 'success');

            } else if (data.status === 'failed' || data.status === 'cancelled') {
              mpesaUnsubscribe && mpesaUnsubscribe();
              mpesaUnsubscribe = null;
              document.getElementById('mpesaWaiting').style.display     = 'none';
              document.getElementById('mpesaDepositForm').style.display  = '';
              btn.textContent = 'Send M-Pesa Prompt';
              btn.disabled    = false;
              showDepositError('Payment was ' + data.status + '. Please try again.');
            }
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
     11d. PAYPAL DEPOSIT — PayPal JS SDK + Cloud Function capture
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
     11e. WITHDRAWAL — PayHero B2C via Cloud Function
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
        let result;
        try {
          const apiRes = await fetch('/api/initiate-withdrawal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount_usd: amount, phone: account, uid: firestoreUid })
          });
          const resData = await apiRes.json();
          if (!resData.success) throw new Error(resData.error || 'Failed to initiate withdrawal');
          result = { data: resData };
        } catch (fetchErr) {
          if (typeof firebase !== 'undefined' && firebase.functions) {
            const initiateWithdrawal = firebase.functions().httpsCallable('initiateWithdrawal');
            result = await initiateWithdrawal({ amount_usd: amount, phone: account });
          } else {
            throw fetchErr;
          }
        }

        // Reload balance from Firestore
        const userDoc = await db.collection('users').doc(firestoreUid).get();
        if (userDoc.exists) {
          const d = userDoc.data();
          state.balance      = d.balance || 0;
          state.transactions = d.transactions || [];
          updateBalanceUI('lose');
          updateStats();
          renderHistory();
        }
        closeModal(withdrawModal);
        showToast(result.data.message || `Withdrawal of ${fmt(amount)} submitted.`, 'success');

      } else {
        // PayPal / USDT — manual processing (no B2C API yet)
        state.balance = parseFloat((state.balance - amount).toFixed(2));
        state.transactions.push({ type: 'withdrawal', amount: -amount, method, account, status: 'processing', ts: Date.now() });
        await saveState(state);
        updateBalanceUI('lose');
        updateStats();
        renderHistory();
        closeModal(withdrawModal);
        showToast(`Withdrawal of ${fmt(amount)} via ${method} submitted. Processing within 24h.`, 'success');
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
    greetEl.textContent = 'Hello, ' + (u.name || 'Trader') + ' 👋';
  }

  /* ══════════════════════════════════════════════════════
     14. INITIALISE
  ══════════════════════════════════════════════════════ */
  updateBalanceUI();
  updateStats();
  updatePayoutPreview();
  renderHistory();

  // Initial price display
  if (livePriceEl) livePriceEl.textContent = fmtPrice(currentPrices[0]);

  // Show onboarding toast if balance is 0
  if (state.balance === 0) {
    setTimeout(() => {
      showToast('Welcome! Make your first deposit to start trading.', 'info');
    }, 1000);
  }

})();
