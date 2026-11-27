/* firebase.js - satu-satunya tempat konfigurasi & koneksi Firebase.
 * Semua halaman cukup: import {auth, connect, signOut, ...} from './firebase.js'
 * Versi SDK diganti di satu tempat saja (FB di bawah).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ls } from './util.js';

export { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
export { doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const cfg = { apiKey: "AIzaSyDEsM1oAvOw_7Zd14wd2SmlnOAqAgwbQIU", authDomain: "gpa---work-order.firebaseapp.com", projectId: "gpa---work-order", storageBucket: "gpa---work-order.firebasestorage.app", messagingSenderId: "352208521958", appId: "1:352208521958:web:895d25863e8ec918070927" };
export const app = initializeApp(cfg);
export const auth = getAuth(app);

/* Koneksi Firestore. Dulu dipaksa long-polling (lebih lambat & lebih banyak request).
 * Sekarang auto-detect: memakai koneksi cepat, dan baru jatuh ke long-polling bila jaringan memblokirnya.
 * Kalau di jaringan kantor muncul "Tidak bisa terhubung", ubah FORCE_LONG_POLLING menjadi true. */
const FORCE_LONG_POLLING = false;
const dbm = {};
export const dbFor = id => dbm[id] || (dbm[id] = initializeFirestore(app, FORCE_LONG_POLLING ? { experimentalForceLongPolling: true } : { experimentalAutoDetectLongPolling: true }, id));

/* Cari database yang benar (id terakhir yang berhasil diingat) lalu baca dokumen users/{uid}.
 * Mengembalikan {db, snap}. Melempar error bila database tidak bisa dihubungi. */
export async function connect(uid) {
  const ids = [...new Set([ls('woDb'), '(default)', 'default'].filter(Boolean))];
  let last;
  for (const id of ids) {
    const db = dbFor(id);
    try { const snap = await getDoc(doc(db, 'users', uid)); ls('woDb', id); return { db, snap }; }
    catch (e) { last = e; if (e.code !== 'unavailable' && e.code !== 'not-found') throw e; }
  }
  throw last;
}
