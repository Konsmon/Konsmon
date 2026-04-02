// config.js
// Firebase configuration.
//
// HOW TO KEEP THIS SAFE ON GITHUB:
//   1. Add "config.js" to your .gitignore file.
//   2. In your repo, commit a "config.example.js" with empty/placeholder values
//      so other devs know what fields are needed.
//   3. On GitHub Pages you deploy manually (drag & drop or a deploy script),
//      so the real config.js never enters the repo.
//
// NOTE ON FIREBASE API KEYS:
//   The apiKey here is NOT a secret — it just identifies your Firebase project.
//   Real security comes from Firebase Database Rules in the Firebase Console.
//   Make sure your rules restrict read/write access appropriately.
//
// ADMIN PASSWORD:
//   Never store the plaintext admin password in Firebase or in this file.
//   Instead, generate a SHA-256 hash of your chosen password and store ONLY
//   the hash under admin/passwordHash in your Firebase Realtime Database.
//   Generate a hash here: https://emn178.github.io/online-tools/sha256.html

const firebaseConfig = {
    apiKey:            'AIzaSyBeDzJgPfga58CNlEFriKkxVBG-d04JXO4',
    authDomain:        'konsmon-website.firebaseapp.com',
    databaseURL:       'https://konsmon-website-default-rtdb.europe-west1.firebasedatabase.app',
    projectId:         'konsmon-website',
    storageBucket:     'konsmon-website.firebasestorage.app',
    messagingSenderId: '1004639372000',
    appId:             '1:1004639372000:web:49980358b5ac43526e8685',
    measurementId:     'G-WJE8C8CY3E',
};
