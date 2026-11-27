/* auth.js — login gate + logout */
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, resolveDb } from "./fb.js";

/** Resolve {user, role, me, db} atau redirect ke index.html. */
export function requireLogin() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      unsub();
      if (!u) { location.replace('index.html'); return; }
      try {
        const { db, me } = await resolveDb(u.uid);
        resolve({ user: u, role: me.role || '', me, db });
      } catch {
        await signOut(auth);
        location.replace('index.html');
      }
    });
  });
}

export function logout() { return signOut(auth); }