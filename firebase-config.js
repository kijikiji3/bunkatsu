// Firebase config placeholder. Create a Firebase project, enable Google sign-in and Firestore, then replace these values.
// Example: https://console.firebase.google.com/

const firebaseConfig = {
  apiKey: "AIzaSyC5Li_ZUexTuoW5tc0omGTbHOfcF9sYtME",
  authDomain: "bunkatsu-fire.firebaseapp.com",
  projectId: "bunkatsu-fire",
  storageBucket: "bunkatsu-fire.firebasestorage.app",
  messagingSenderId: "269908619663",
  appId: "1:269908619663:web:303c001aff92a5c8285bfa",
  measurementId: "G-V2NNQSYFSC"
};

// Using compat CDN scripts (included before timeline.js) — initialize here
if(window.firebase && !firebase.apps.length){
  firebase.initializeApp(firebaseConfig);
}

// Expose helpers
window._fb = {
  auth: window.firebase ? firebase.auth() : null,
  db: window.firebase ? firebase.firestore() : null,
};