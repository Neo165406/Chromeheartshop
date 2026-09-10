// js/firebase-config.js
// Shared Firebase/Firestore/Auth setup for fashion1sta. Imported as an ES
// module by index.html and admin.html — no build step required.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  doc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE",
  authDomain: "argentum-3709f.firebaseapp.com",
  projectId: "argentum-3709f",
  storageBucket: "argentum-3709f.firebasestorage.app",
  messagingSenderId: "640506841572",
  appId: "1:640506841572:web:b23582fb753967d5365ff1",
  measurementId: "G-L6NY1E2LH6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export {
  db, collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  doc, query, orderBy, serverTimestamp,
  auth, signInWithEmailAndPassword, onAuthStateChanged, signOut
};
