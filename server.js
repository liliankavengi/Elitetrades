/* ===========================================================
   ELITETRADES — Express Server for Render / Cloud Hosting
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

/* ─── Health Check ───────────────────────────────────────── */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'EliteTrades API', time: new Date().toISOString() });
});

/* ─── 1. Initiate Deposit (STK Push) ─────────────────────── */
app.post('/api/initiate-deposit', async (req, res) => {
  try {
    const { amount_kes, phone, uid } = req.body;

    if (!uid) {
      return res.status(401).json({ success: false, error: 'User must be signed in.' });
    }
    if (!amount_kes || amount_kes < 10) {
      return res.status(400).json({ success: false, error: 'Minimum deposit is KES 10.' });
    }

    const cleanPhone = (phone || '').replace(/\s/g, '');
    if (!/^(\+?254[17]\d{8}|0[17]\d{8})$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Invalid M-Pesa phone number.' });
    }

    let normPhone = cleanPhone;
    if (normPhone.startsWith('+254')) normPhone = '0' + normPhone.slice(4);
    if (normPhone.startsWith('254'))  normPhone = '0' + normPhone.slice(3);

    const extRef = `ET-DEP-${uid.slice(0, 8)}-${Date.now()}`;

    // Store pending deposit
    await db.collection('pending_deposits').doc(extRef).set({
      uid,
      amount_kes: Number(amount_kes),
      amount_usd: kesToUsd(amount_kes),
      phone: normPhone,
      method: 'M-Pesa',
      status: 'pending',
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });

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
      await db.collection('pending_deposits').doc(extRef).update({ status: 'error', error: msg });
      return res.status(400).json({ success: false, error: msg });
    }

    console.log(`STK Push queued successfully: ${extRef} (${normPhone})`);

    return res.json({
      success: true,
      reference: extRef,
      status: payheroRes.status,
      amount_kes,
      amount_usd: kesToUsd(amount_kes),
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
    const { external_reference, status, amount, phone_number } = req.body || {};

    if (!external_reference) {
      return res.status(400).send('Missing external_reference');
    }

    const pendingRef = db.collection('pending_deposits').doc(external_reference);
    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      console.warn('No pending deposit found for ref:', external_reference);
      return res.status(200).send('OK');
    }

    const pending = pendingDoc.data();
    if (pending.status === 'completed') {
      return res.status(200).send('Already processed');
    }

    if (status === 'SUCCESS') {
      const amount_kes = amount || pending.amount_kes;
      const amount_usd = kesToUsd(amount_kes);

      const userRef = db.collection('users').doc(pending.uid);
      await db.runTransaction(async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;
        const currentTxns    = userDoc.exists ? (userDoc.data().transactions || []) : [];

        tx.update(userRef, {
          balance: parseFloat((currentBalance + amount_usd).toFixed(2)),
          transactions: [
            ...currentTxns,
            {
              type: 'deposit',
              amount: amount_usd,
              amount_kes,
              method: 'M-Pesa',
              reference: external_reference,
              phone: phone_number || pending.phone,
              ts: Date.now(),
            },
          ].slice(-200),
        });
      });

      await pendingRef.update({
        status: 'completed',
        amount_usd,
        completed_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Deposit confirmed: ${external_reference} → +$${amount_usd} for uid ${pending.uid}`);
    } else {
      await pendingRef.update({
        status: (status || 'failed').toLowerCase(),
        failed_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Deposit ${status}: ${external_reference}`);
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send('Error processing callback');
  }
});

/* ─── 3. Initiate Withdrawal ─────────────────────────────── */
app.post('/api/initiate-withdrawal', async (req, res) => {
  try {
    const { amount_usd, phone, uid } = req.body;

    if (!uid) {
      return res.status(401).json({ success: false, error: 'User must be signed in.' });
    }
    if (!amount_usd || amount_usd < 1) {
      return res.status(400).json({ success: false, error: 'Minimum withdrawal is $1.00.' });
    }

    const cleanPhone = (phone || '').replace(/\s/g, '');
    if (!/^(\+?254[17]\d{8}|0[17]\d{8})$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Invalid M-Pesa phone number.' });
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
      message: `Withdrawal of $${amount_usd} (KES ${amount_kes}) to ${cleanPhone} is being processed.`,
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
