/* ===========================================================
   ELITETRADES - Express Server for Render / Cloud Hosting
   Serves Frontend + M-Pesa (PayHero) Backend API & Webhooks
   =========================================================== */

require('dotenv').config();
const path    = require('path');
const fs      = require('fs');
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const admin   = require('firebase-admin');

// Initialise Firebase Admin
let firebaseInitialized = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const cred = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : process.env.FIREBASE_SERVICE_ACCOUNT;
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    firebaseInitialized = true;
  } else if (fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))) {
    const cred = require(path.join(__dirname, 'serviceAccountKey.json'));
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    firebaseInitialized = true;
  } else {
    // Project ID fallback (e.g. for Google Cloud environments or rules)
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'elitetrades-693d1' });
    firebaseInitialized = true;
  }
  console.log('Firebase Admin initialised successfully');
} catch (err) {
  console.warn('Firebase Admin init warning:', err.message);
}

const db = admin.firestore();

// PayHero Credentials
const PAYHERO_USERNAME   = process.env.PAYHERO_API_USERNAME   || 'YxVPnp8RxbJ7940WOHtS';
const PAYHERO_PASSWORD   = process.env.PAYHERO_API_PASSWORD   || 'F0Yl8D4LQeleNxzIxE9beTgRPr6R7MpEbkBcvgEf';
const PAYHERO_CHANNEL_ID = parseInt(process.env.PAYHERO_CHANNEL_ID || '11753');
const PAYHERO_URL        = 'https://backend.payhero.co.ke/api/v2/payments';
const KES_RATE           = 130;

function kesToUsd(kes) { return parseFloat((kes / KES_RATE).toFixed(2)); }
function usdToKes(usd) { return Math.round(usd * KES_RATE); }

function payheroAuth() {
  const token = Buffer.from(`${PAYHERO_USERNAME}:${PAYHERO_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// In-memory cache for fast tracking and fallback
const inMemoryDeposits = new Map();
const inMemoryUsers    = new Map();

/* ─── Health Check ───────────────────────────────────────── */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'EliteTrades API', time: new Date().toISOString() });
});

/* ─── 1. Initiate Deposit (STK Push) ─────────────────────── */
app.post('/api/initiate-deposit', async (req, res) => {
  try {
    let { amount_kes, phone, uid } = req.body;

    const cleanPhone = (phone || '').replace(/\s/g, '');
    if (!cleanPhone || !/^(\+?254[17]\d{8}|0[17]\d{8})$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Enter a valid M-Pesa number (07xx, 01xx, +2547xx or +2541xx).' });
    }

    if (!amount_kes || Number(amount_kes) < 130) {
      return res.status(400).json({ success: false, error: 'Minimum deposit is $1.00 (KES 130).' });
    }

    // Ensure uid is never null or empty even if client is not authenticated
    if (!uid || uid === 'null' || uid === 'undefined') {
      const cleanDigits = cleanPhone.replace(/\D/g, '');
      uid = 'usr_' + (cleanDigits ? cleanDigits.slice(-9) : Date.now());
    }

    let normPhone = cleanPhone;
    if (normPhone.startsWith('+254')) normPhone = '0' + normPhone.slice(4);
    if (normPhone.startsWith('254'))  normPhone = '0' + normPhone.slice(3);

    const extRef = `ET-DEP-${uid.slice(0, 8)}-${Date.now()}`;
    const amount_usd = kesToUsd(amount_kes);

    // Track in-memory immediately
    inMemoryDeposits.set(extRef, {
      uid,
      amount_kes: Number(amount_kes),
      amount_usd,
      phone: normPhone,
      method: 'M-Pesa',
      status: 'pending',
      createdAt: Date.now(),
    });

    // Store pending deposit in Firestore
    try {
      await db.collection('pending_deposits').doc(extRef).set({
        uid,
        amount_kes: Number(amount_kes),
        amount_usd,
        phone: normPhone,
        method: 'M-Pesa',
        status: 'pending',
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (dbErr) {
      console.warn('Could not store pending deposit in Firestore:', dbErr.message);
    }

    // Callback URL on Render or custom domain
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
    const callbackUrl = `${baseUrl}/api/payhero-callback`;

    console.log(`Sending PayHero STK push to ${normPhone} for KES ${amount_kes}, callback: ${callbackUrl}`);

    const response = await fetch(PAYHERO_URL, {
      method: 'POST',
      headers: {
        'Authorization': payheroAuth(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(Number(amount_kes)),
        phone_number: normPhone,
        channel_id: PAYHERO_CHANNEL_ID,
        provider: 'm-pesa',
        external_reference: extRef,
        callback_url: callbackUrl,
      }),
    });

    const payheroRes = await response.json();

    if (!payheroRes.success) {
      const msg = payheroRes.message || 'PayHero rejected the request.';
      inMemoryDeposits.set(extRef, { ...inMemoryDeposits.get(extRef), status: 'error', error: msg });
      try {
        await db.collection('pending_deposits').doc(extRef).update({ status: 'error', error: msg });
      } catch (_) {}
      return res.status(400).json({ success: false, error: msg });
    }

    console.log(`STK Push queued successfully: ${extRef} (${normPhone})`);

    return res.json({
      success: true,
      reference: extRef,
      status: payheroRes.status,
      amount_kes,
      amount_usd,
    });
  } catch (err) {
    console.error('initiateDeposit error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

/* ─── 2. PayHero Webhook Callback ────────────────────────── */
app.post('/api/payhero-callback', async (req, res) => {
  try {
    console.log('PayHero Callback received:', JSON.stringify(req.body));
    const body = req.body || {};
    const resp = body.response || body.data || body;

    const external_reference = body.external_reference || resp.ExternalReference || resp.external_reference || body.ExternalReference || resp.reference || body.reference;
    const rawStatus = (resp.Status || resp.status || body.Status || body.status || '').toString().toUpperCase();
    const amountVal = Number(resp.Amount || resp.amount || body.Amount || body.amount || 0);
    const phoneVal  = resp.Phone || resp.phone || resp.phone_number || body.phone_number || body.Phone || '';

    if (!external_reference) {
      return res.status(400).send('Missing external_reference');
    }

    let pending = inMemoryDeposits.get(external_reference);
    const pendingRef = db.collection('pending_deposits').doc(external_reference);

    if (!pending) {
      try {
        const pendingDoc = await pendingRef.get();
        if (pendingDoc.exists) pending = pendingDoc.data();
      } catch (_) {}
    }

    if (!pending) {
      console.warn('No pending deposit found for ref:', external_reference);
      return res.status(200).send('OK');
    }

    if (pending.status === 'completed') {
      return res.status(200).send('Already processed');
    }

    const isSuccess = rawStatus === 'SUCCESS' || rawStatus === 'SUCCESSFUL' || rawStatus === 'COMPLETED' || rawStatus === 'COMPLETE';

    if (isSuccess) {
      const amount_kes = amountVal || pending.amount_kes;
      const amount_usd = kesToUsd(amount_kes);

      const targetUid = pending.uid;
      const currentInMem = inMemoryUsers.get(targetUid) || 0;
      const newInMemBal = parseFloat((currentInMem + amount_usd).toFixed(2));
      inMemoryUsers.set(targetUid, newInMemBal);

      // Update in-memory
      inMemoryDeposits.set(external_reference, {
        ...pending,
        status: 'completed',
        amount_usd,
        balance: newInMemBal,
        completedAt: Date.now(),
      });

      // Update Firestore user balance
      let newBalance = newInMemBal;
      try {
        const userRef = db.collection('users').doc(targetUid);
        await db.runTransaction(async (tx) => {
          const userDoc = await tx.get(userRef);
          const currentBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;
          const currentTxns    = userDoc.exists ? (userDoc.data().transactions || []) : [];
          newBalance = parseFloat((currentBalance + amount_usd).toFixed(2));
          inMemoryUsers.set(targetUid, newBalance);

          tx.set(userRef, {
            balance: newBalance,
            transactions: [
              ...currentTxns,
              {
                type: 'deposit',
                amount: amount_usd,
                amount_kes,
                method: 'M-Pesa',
                reference: external_reference,
                phone: phoneVal || pending.phone,
                ts: Date.now(),
              },
            ].slice(-200),
          }, { merge: true });
        });

        await pendingRef.update({
          status: 'completed',
          amount_usd,
          completed_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (errDb) {
        console.warn('Firestore update in callback warning:', errDb.message);
      }

      console.log(`Deposit confirmed: ${external_reference} → +$${amount_usd} for uid ${targetUid} (New Bal: $${newBalance})`);
    } else {
      inMemoryDeposits.set(external_reference, {
        ...pending,
        status: rawStatus.toLowerCase() || 'failed',
        failedAt: Date.now(),
      });
      try {
        await pendingRef.update({
          status: (rawStatus || 'failed').toLowerCase(),
          failed_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (_) {}
      console.log(`Deposit ${rawStatus}: ${external_reference}`);
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send('Error processing callback');
  }
});

/* ─── 3. Check Deposit Status (Polling Endpoint) ─────────── */
app.get('/api/check-deposit-status', async (req, res) => {
  try {
    const { reference, uid } = req.query;
    if (!reference) return res.status(400).json({ success: false, error: 'Missing reference' });

    let pending = inMemoryDeposits.get(reference);
    const pendingRef = db.collection('pending_deposits').doc(reference);

    if (!pending) {
      try {
        const doc = await pendingRef.get();
        if (doc.exists) pending = doc.data();
      } catch (_) {}
    }

    if (!pending) {
      return res.status(404).json({ success: false, error: 'Deposit record not found' });
    }

    const targetUid = uid || pending.uid;

    // If completed, return latest balance immediately
    if (pending.status === 'completed') {
      let latestBal = pending.amount_usd || 0;
      try {
        const userDoc = await db.collection('users').doc(targetUid).get();
        if (userDoc.exists && typeof userDoc.data().balance === 'number') {
          latestBal = userDoc.data().balance;
        }
      } catch (_) {}

      return res.json({
        success: true,
        status: 'completed',
        amount_usd: pending.amount_usd,
        amount_kes: pending.amount_kes,
        balance: latestBal,
      });
    }

    // If still pending, query PayHero API directly to check if STK push finished
    try {
      const phCheckUrl = `https://backend.payhero.co.ke/api/v2/payments?external_reference=${encodeURIComponent(reference)}`;
      const phRes = await fetch(phCheckUrl, {
        headers: { 'Authorization': payheroAuth() },
      });

      if (phRes.ok) {
        const phData = await phRes.json();
        const payment = (phData.data && phData.data[0]) || phData.response || phData;
        const phStatus = ((payment && (payment.status || payment.Status)) || '').toString().toUpperCase();

        if (phStatus === 'SUCCESS' || phStatus === 'SUCCESSFUL' || phStatus === 'COMPLETED') {
          const amount_kes = Number(payment.amount || payment.Amount || pending.amount_kes);
          const amount_usd = kesToUsd(amount_kes);

          let newBal = amount_usd;
          try {
            const userRef = db.collection('users').doc(targetUid);
            await db.runTransaction(async (tx) => {
              const userDoc = await tx.get(userRef);
              const currentBal = userDoc.exists ? (userDoc.data().balance || 0) : 0;
              const currentTx  = userDoc.exists ? (userDoc.data().transactions || []) : [];
              newBal = parseFloat((currentBal + amount_usd).toFixed(2));

              tx.set(userRef, {
                balance: newBal,
                transactions: [
                  ...currentTx,
                  {
                    type: 'deposit',
                    amount: amount_usd,
                    amount_kes,
                    method: 'M-Pesa',
                    reference,
                    phone: payment.phone_number || payment.Phone || pending.phone,
                    ts: Date.now(),
                  },
                ].slice(-200),
              }, { merge: true });
            });

            await pendingRef.update({
              status: 'completed',
              amount_usd,
              completed_at: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (_) {}

          inMemoryDeposits.set(reference, {
            ...pending,
            status: 'completed',
            amount_usd,
            completedAt: Date.now(),
          });

          return res.json({
            success: true,
            status: 'completed',
            amount_usd,
            amount_kes,
            balance: newBal,
          });
        }
      }
    } catch (e) {
      console.warn('PayHero direct verification error:', e.message);
    }

    return res.json({
      success: true,
      status: pending.status || 'pending',
      amount_usd: pending.amount_usd,
      amount_kes: pending.amount_kes,
    });
  } catch (err) {
    console.error('checkDepositStatus error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const creditedTransactions = new Set();

/* ─── 4. Sync Recent Deposits (Last 30 - 45 Minutes) ────── */
app.get('/api/sync-recent-deposits', async (req, res) => {
  try {
    const { uid, phone, window } = req.query;
    const now = Date.now();
    const windowMinutes = parseInt(window) || 45; // Default 45 mins to safely cover 30 mins
    const windowMs = windowMinutes * 60 * 1000;

    const phRes = await fetch('https://backend.payhero.co.ke/api/v2/transactions', {
      headers: { 'Authorization': payheroAuth() },
    });

    if (!phRes.ok) {
      return res.status(500).json({ success: false, error: 'Could not fetch PayHero transactions' });
    }

    const phData = await phRes.json();
    const allTxs = phData.transactions || [];

    // Filter inbound payments in the time window
    const recentInbound = allTxs.filter(t => {
      if (t.transaction_type !== 'inbound_payment') return false;
      const tTime = new Date(t.created_at).getTime();
      return (now - tTime) <= windowMs;
    });

    const cleanUserPhone = (phone || '').replace(/\D/g, '').slice(-9);
    const userUidPrefix = (uid || '').slice(0, 8);

    const matchedDeposits = [];

    for (const tx of recentInbound) {
      const txPhone = (tx.beneficiary_number || tx.phone || '').replace(/\D/g, '').slice(-9);
      const extRef = tx.external_reference || '';

      // Match if extRef matches UID prefix, or phone matches, or if only 1 recent deposit in channel, or if no filter
      const matchesUid = userUidPrefix && extRef.includes(userUidPrefix);
      const matchesPhone = cleanUserPhone && txPhone && cleanUserPhone === txPhone;
      const isCandidate = matchesUid || matchesPhone || (!cleanUserPhone && !userUidPrefix) || (!matchesUid && !matchesPhone && recentInbound.length === 1);

      if (isCandidate) {
        const amount_kes = Number(tx.amount || 0);
        const amount_usd = kesToUsd(amount_kes);
        const targetUid = uid || (extRef.split('-')[2] ? 'usr_' + extRef.split('-')[2] : 'current_user');
        const txKey = (tx.provider_reference || extRef || String(tx.id)).trim();

        // Update in-memory deposit state
        inMemoryDeposits.set(extRef || txKey, {
          uid: targetUid,
          amount_kes,
          amount_usd,
          phone: tx.beneficiary_number || tx.phone,
          status: 'completed',
          mpesaReceipt: tx.provider_reference,
          completedAt: new Date(tx.created_at).getTime(),
        });

        // Idempotent balance credit
        const alreadyCredited = creditedTransactions.has(txKey);
        if (!alreadyCredited) {
          creditedTransactions.add(txKey);
          const curBal = inMemoryUsers.get(targetUid) || 0;
          const newBal = parseFloat((curBal + amount_usd).toFixed(2));
          inMemoryUsers.set(targetUid, newBal);
        }

        // Update Firestore if available
        try {
          const userRef = db.collection('users').doc(targetUid);
          await db.runTransaction(async (txDb) => {
            const userDoc = await txDb.get(userRef);
            const dbBal = userDoc.exists ? (userDoc.data().balance || 0) : 0;
            const dbTx = userDoc.exists ? (userDoc.data().transactions || []) : [];
            const alreadyLogged = dbTx.some(x => (extRef && x.reference === extRef) || (tx.provider_reference && x.mpesaReceipt === tx.provider_reference) || (tx.id && x.payheroId === tx.id));
            if (!alreadyLogged) {
              const updatedBal = parseFloat((dbBal + amount_usd).toFixed(2));
              txDb.set(userRef, {
                balance: updatedBal,
                transactions: [
                  ...dbTx,
                  {
                    type: 'deposit',
                    amount: amount_usd,
                    amount_kes,
                    method: 'M-Pesa',
                    reference: extRef,
                    mpesaReceipt: tx.provider_reference,
                    payheroId: tx.id,
                    phone: tx.beneficiary_number,
                    ts: new Date(tx.created_at).getTime(),
                  }
                ].slice(-200)
              }, { merge: true });
            }
          });

          if (extRef) {
            await db.collection('pending_deposits').doc(extRef).set({
              uid: targetUid,
              amount_kes,
              amount_usd,
              status: 'completed',
              mpesaReceipt: tx.provider_reference,
              completed_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        } catch (_) {}

        matchedDeposits.push({
          id: tx.id,
          amount_kes,
          amount_usd,
          mpesaReceipt: tx.provider_reference,
          reference: extRef,
          phone: tx.beneficiary_number,
          createdAt: tx.created_at,
          alreadyCredited,
        });
      }
    }

    return res.json({
      success: true,
      count: matchedDeposits.length,
      deposits: matchedDeposits,
      total_credited_usd: matchedDeposits.reduce((acc, d) => acc + d.amount_usd, 0),
    });
  } catch (err) {
    console.error('syncRecentDeposits error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ─── 5. Initiate Withdrawal ─────────────────────────────── */
app.post('/api/initiate-withdrawal', async (req, res) => {
  try {
    let { amount_usd, phone, uid } = req.body;

    const cleanPhone = (phone || '').replace(/\s/g, '');
    if (!cleanPhone || !/^(\+?254[17]\d{8}|0[17]\d{8})$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Invalid M-Pesa phone number.' });
    }

    if (!uid || uid === 'null' || uid === 'undefined') {
      const cleanDigits = cleanPhone.replace(/\D/g, '');
      uid = 'usr_' + (cleanDigits ? cleanDigits.slice(-9) : Date.now());
    }

    const amount_kes = usdToKes(amount_usd);
    const extRef = `ET-WD-${uid.slice(0, 8)}-${Date.now()}`;

    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists) throw new Error('User not found');
      const balance = userDoc.data().balance || 0;
      if (amount_usd > balance) throw new Error(`Insufficient balance. Available: $${balance.toFixed(2)}`);

      const currentTxns = userDoc.data().transactions || [];
      tx.update(userRef, {
        balance: parseFloat((balance - amount_usd).toFixed(2)),
        transactions: [
          ...currentTxns,
          {
            type: 'withdrawal',
            amount: -amount_usd,
            amount_kes,
            method: 'M-Pesa',
            reference: extRef,
            phone: cleanPhone,
            status: 'processing',
            ts: Date.now(),
          },
        ].slice(-200),
      });
    });

    await db.collection('pending_withdrawals').doc(extRef).set({
      uid,
      amount_usd: Number(amount_usd),
      amount_kes,
      phone: cleanPhone,
      status: 'processing',
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      message: `Withdrawal of $${amount_usd} (KES ${amount_kes}) to ${cleanPhone} processed instantly.`,
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// HTML page routing fallback
app.get('/:page', (req, res, next) => {
  const pagePath = path.join(__dirname, `${req.params.page}.html`);
  if (fs.existsSync(pagePath)) {
    return res.sendFile(pagePath);
  }
  next();
});

app.listen(PORT, () => {
  console.log(`EliteTrades server running on port ${PORT}`);
});
