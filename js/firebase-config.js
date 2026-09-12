/* ===========================================================
   ELITETRADES — firebase-config.js
   Replace the placeholder values below with your actual
   Firebase project credentials from:
   Firebase Console → Project Settings → Your Apps → Web App
   =========================================================== */

// ⚠️  PASTE YOUR FIREBASE CONFIG HERE  ⚠️
const firebaseConfig = {
  apiKey:            "AIzaSyBdWZE4W5NF7JoPJHlCW2zml2RIEQKLKyo",
  authDomain:        "elitetrades-693d1.firebaseapp.com",
  projectId:         "elitetrades-693d1",
  storageBucket:     "elitetrades-693d1.firebasestorage.app",
  messagingSenderId: "785084809140",
  appId:             "1:785084809140:web:eaca03f178cffa4d103ce1",
  measurementId:     "G-4TS7PN00ZQ"
};

// ⚠️  PASTE YOUR PAYPAL CLIENT ID HERE  ⚠️
// From: https://developer.paypal.com → My Apps → your app → Client ID
const PAYPAL_CLIENT_ID = "PASTE_YOUR_PAYPAL_CLIENT_ID_HERE";

// Initialise Firebase (only once across all pages)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Shared handles used by auth.js and dashboard.js
const auth = firebase.auth();
const db   = firebase.firestore();

// Keep Firestore data fresh when tab regains focus
db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(() => {});
