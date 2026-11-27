/* fb.js — Firebase init terpusat + resolver DB ID + localStorage helpers */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const cfg = {
  apiKey: "AIzaSyDEsM1oAvOw_7Zd14wd2SmlnOAqAgwbQIU",
  authDomain: "gpa---work-order.firebaseapp.com",
  projectId: "gpa---work-order",
  storageBucket: "gpa---work-order.firebasestorage.app",
  messagingSenderId: "352208521958",
  appId: "1:352208521958:web:895d25863e8ec918070927",
};

export const app  = initializeApp(cfg);
export const auth = getAuth(app);

const cache = new Map();
function makeDb(id) {
  if (cache.has(id)) return cache.get(id);
  let db;
  try {
    db = initializeFirestore(app, {}, id);                        // WebChannel normal
  } catch {
    db = initializeFirestore(app, { experimentalForceLongPolling: true }, id); // fallback
  }
  cache.set(id, db);
  return db;
}

export const ls    = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };
export const lsDel = k       => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export async function resolveDb(uid) {
  const ids = [...new Set([ls('woDb'), '(default)', 'default'].filter(Boolean))];
  let lastErr;
  for (const id of ids) {
    try {
      const db = makeDb(id);
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) { ls('woDb', id); return { db, me: snap.data() }; }
    } catch (e) {
      if (e.code !== 'unavailable' && e.code !== 'not-found') throw e;
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('User belum punya dokumen role di Firestore.');
}