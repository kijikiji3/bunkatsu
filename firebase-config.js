// Firebase config placeholder. Create a Firebase project, enable Google sign-in and Firestore, then replace these values.
// Example: https://console.firebase.google.com/

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  // storageBucket, messagingSenderId, appId optional for this use-case
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