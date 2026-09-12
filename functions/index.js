/* ===========================================================
   ELITETRADES - Firebase Cloud Functions
   Payment backend: M-Pesa only via PayHero API
   =========================================================== */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const fetch     = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

/* ─── Credentials (loaded from functions/.env) ───────────── */
const PAYHERO_USERNAME   = process.env.PAYHERO_API_USERNAME;
const PAYHERO_PASSWORD   = process.env.PAYHERO_API_PASSWORD;
const PAYHERO_CHANNEL_ID = parseInt(process.env.PAYHERO_CHANNEL_ID || '11753');
const PAYHERO_URL        = 'https://backend.payhero.co.ke/api/v2/payments';
const PAYHERO_WITHDRAW   = 'https://backend.payhero.co.ke/api/v2/withdraw';

const KES_RATE = 130; // 1 USD = 130 KES (update as needed)

function kesToUsd(kes) { return parseFloat((kes / KES_RATE).toFixed(2)); }
function usdToKes(usd) { return Math.round(usd * KES_RATE); }

function payheroAuth() {
  const token = Buffer.from(`${PAYHERO_USERNAME}:${PAYHERO_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

/* ───────────────────────────────────────────────────────────
   1. INITIATE M-PESA DEPOSIT  (STK Push)
   Called from dashboard.js via firebase.functions().httpsCallable()
─────────────────────────────────────────────────────────── */
exports.initiateDeposit = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in to deposit.');
  }

  const { amount_kes, phone } = data;
  const uid = context.auth.uid;

  /* Validate */
  if (!amount_kes || amount_kes < 130) {
    throw new functions.https.HttpsError('invalid-argument', 'Minimum M-Pesa deposit is $1.00 (KES 130).');
  }
  const cleanPhone = (phone || '').replace(/\s/g, '');
  if (!/^(\+?254[17]\d{8}|0[17]\d{8})$/.test(cleanPhone)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid M-Pesa phone number.');
  }

  /* Normalise to 07xx / 01xx */
  let normPhone = cleanPhone;
  if (normPhone.startsWith('+254')) normPhone = '0' + normPhone.slice(4);
  if (normPhone.startsWith('254'))  normPhone = '0' + normPhone.slice(3);

  const extRef = `ET-DEP-${uid.slice(0, 8)}-${Date.now()}`;

  /* Store pending deposit: frontend listens to this doc */
  await db.collection('pending_deposits').doc(extRef).set({
    uid,
    amount_kes,
    amount_usd: kesToUsd(amount_kes),
    phone: normPhone,
    method: 'M-Pesa',
    status: 'pending',
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });

  /* Build callback URL */
  const project     = process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG
    ? JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId
    : 'elitetrades';
  const callbackUrl = `https://us-central1-${project}.cloudfunctions.net/payheroCallback`;

  /* Call PayHero */
  let payheroRes;
  try {
    const res = await fetch(PAYHERO_URL, {
      method:  'POST',
      headers: { 'Authorization': payheroAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:             Math.round(amount_kes),
        phone_number:       normPhone,
        channel_id:         PAYHERO_CHANNEL_ID,
        provider:           'm-pesa',
        external_reference: extRef,
        callback_url:       callbackUrl,
      }),
    });
    payheroRes = await res.json();
  } catch (err) {
    await db.collection('pending_deposits').doc(extRef).update({ status: 'error', error: err.message });
    throw new functions.https.HttpsError('internal', 'Could not reach PayHero. Check your internet and try again.');
  }

  if (!payheroRes.success) {
    const msg = payheroRes.message || 'PayHero rejected the request.';
    await db.collection('pending_deposits').doc(extRef).update({ status: 'error', error: msg });
    throw new functions.https.HttpsError('internal', msg);
  }

  console.log(`STK Push queued: ${extRef} → ${normPhone} KES ${amount_kes}`);

  return {
    success:    true,
    reference:  extRef,
    status:     payheroRes.status,
    amount_kes,
    amount_usd: kesToUsd(amount_kes),
  };
});


/* ───────────────────────────────────────────────────────────
   2. PAYHERO CALLBACK  (Webhook: PayHero calls this after payment)
─────────────────────────────────────────────────────────── */
exports.payheroCallback = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { external_reference, status, amount, phone_number } = req.body || {};
  console.log('PayHero callback:', JSON.stringify(req.body));

  if (!external_reference) return res.status(400).send('Missing external_reference');

  const pendingRef = db.collection('pending_deposits').doc(external_reference);
  const pendingDoc = await pendingRef.get();

  if (!pendingDoc.exists) {
    console.warn('No pending deposit for ref:', external_reference);
    return res.status(200).send('OK'); // Return 200 so PayHero stops retrying
  }

  const pending = pendingDoc.data();
  if (pending.status === 'completed') return res.status(200).send('Already processed');

  if (status === 'SUCCESS') {
    const amount_kes = amount || pending.amount_kes;
    const amount_usd = kesToUsd(amount_kes);

    /* Credit balance in a Firestore transaction */
    try {
      const userRef = db.collection('users').doc(pending.uid);
      await db.runTransaction(async (tx) => {
        const userDoc     = await tx.get(userRef);
        const current     = userDoc.exists ? (userDoc.data().balance      || 0) : 0;
        const currentTxns = userDoc.exists ? (userDoc.data().transactions || []) : [];

        tx.update(userRef, {
          balance: parseFloat((current + amount_usd).toFixed(2)),
          transactions: [
            ...currentTxns,
            {
              type:      'deposit',
              amount:    amount_usd,
              amount_kes,
              method:    'M-Pesa',
              reference: external_reference,
              phone:     phone_number || pending.phone,
              ts:        Date.now(),
            },
          ].slice(-200),
        });
      });

      await pendingRef.update({
        status:       'completed',
        amount_usd,
        completed_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Deposit confirmed: ${external_reference} → +$${amount_usd} for uid ${pending.uid}`);

    } catch (err) {
      console.error('Balance credit failed:', err);
      await pendingRef.update({ status: 'error', error: err.message });
      return res.status(500).send('Database error');
    }

  } else {
    /* FAILED / CANCELLED / TIMEOUT */
    await pendingRef.update({
      status:    (status || 'failed').toLowerCase(),
      failed_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Deposit ${status}: ${external_reference}`);
  }

  return res.status(200).send('OK');
});


/* ───────────────────────────────────────────────────────────
   3. INITIATE M-PESA WITHDRAWAL  (B2C via PayHero)
   Called from withdraw form
─────────────────────────────────────────────────────────── */
exports.initiateWithdrawal = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  }

  const { amount_usd, phone } = data;
  const uid = context.auth.uid;

  if (!amount_usd || amount_usd < 1) {
    throw new functions.https.HttpsError('invalid-argument', 'Minimum withdrawal is $1.00.');
  }
  const cleanPhone = (phone || '').replace(/\s/g, '');
  if (!/^(\+?254[17]\d{8}|0[17]\d{8})$/.test(cleanPhone)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid M-Pesa phone number.');
  }

  const amount_kes = usdToKes(amount_usd);
  const extRef     = `ET-WD-${uid.slice(0, 8)}-${Date.now()}`;

  /* Deduct balance immediately (held pending) */
  const userRef = db.collection('users').doc(uid);
  try {
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
            type:      'withdrawal',
            amount:    -amount_usd,
            amount_kes,
            method:    'M-Pesa',
            reference: extRef,
            phone:     cleanPhone,
            status:    'processing',
            ts:        Date.now(),
          },
        ].slice(-200),
      });
    });
  } catch (err) {
    throw new functions.https.HttpsError('invalid-argument', err.message);
  }

  /* Log withdrawal (actual B2C payout when enabled on PayHero account) */
  await db.collection('pending_withdrawals').doc(extRef).set({
    uid, amount_usd, amount_kes, phone: cleanPhone,
    status: 'processing',
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Withdrawal queued: ${extRef} → ${cleanPhone} $${amount_usd} (KES ${amount_kes})`);

  return {
    success: true,
    message: `Withdrawal of $${amount_usd} (KES ${amount_kes}) to ${cleanPhone} is being processed.`,
  };
});
