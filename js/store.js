// Tietovarasto: Firebase (Firestore + Google-kirjautuminen) tai paikallinen testitila.
//
// Rakenne (Firestore). Koiran tiedot ovat yhteisiä kaikille members-listan tileille:
//   dogs/{dogId}                    { name, background, members: [email], createdAt }
//   dogs/{dogId}/regimens/{id}      { kind: food|med, name, details, startDate, endDate }
//   dogs/{dogId}/days/{YYYY-MM-DD}  { nightLevel, nightComment, dayLevel, dayComment, stool[], stoolComment }
//   dogs/{dogId}/events/{id}        { type: treat|forbidden|med|note, date, text, comment }

import { firebaseConfig } from '../firebase-config.js';

export const isCloud = !!(firebaseConfig && firebaseConfig.apiKey);

export async function createStore() {
  return isCloud ? createFirebaseStore() : createLocalStore();
}

const nowIso = () => new Date().toISOString();
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------------------------------------------------------------- Firebase
async function createFirebaseStore() {
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try {
    // Offline-välimuisti: kirjaukset toimivat ilman verkkoa ja synkronoituvat myöhemmin
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn('Offline-välimuisti ei käytössä', e);
    db = F.getFirestore(app);
  }
  A.getRedirectResult(auth).catch(e => console.warn(e));

  let user = null;
  const dogsCol = () => F.collection(db, 'dogs');
  const dogRef = id => F.doc(db, 'dogs', id);
  const sub = (dogId, name) => F.collection(db, 'dogs', dogId, name);
  const subDoc = (dogId, name, id) => F.doc(db, 'dogs', dogId, name, id);
  const myEmail = () => (user.email || '').toLowerCase();
  // Kirjoituksia ei odoteta (offline-tilassa lupaus ratkeaa vasta synkronoinnissa)
  const fire = p => { p.catch(e => window.dispatchEvent(new CustomEvent('store-error', { detail: e }))); };

  return {
    cloud: true,
    onAuth(cb) {
      A.onAuthStateChanged(auth, u => { user = u; cb(u ? { name: u.displayName, email: u.email } : null); });
    },
    async signIn() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
          await A.signInWithRedirect(auth, provider);
        } else if (e.code !== 'auth/popup-closed-by-user') throw e;
      }
    },
    signOut: () => A.signOut(auth),

    watchDogs(cb, onError) {
      const q = F.query(dogsCol(), F.where('members', 'array-contains', myEmail()));
      return F.onSnapshot(q, { includeMetadataChanges: true }, snap => {
        const dogs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        cb(dogs, { fromCache: snap.metadata.fromCache });
      }, e => onError?.(e));
    },
    // id annetaan, kun luodaan oletuskoira: sama tunniste estää tuplat, jos molemmat kirjautuvat yhtä aikaa
    addDog(name, { id, members = [] } = {}) {
      const ref = id ? dogRef(id) : F.doc(dogsCol());
      const all = [...new Set([myEmail(), ...members.map(m => m.toLowerCase())])];
      fire(F.setDoc(ref, { name, background: '', members: all, createdAt: nowIso() }, { merge: true }));
      return ref.id;
    },
    updateDog(id, patch) { fire(F.setDoc(dogRef(id), clean(patch), { merge: true })); },

    watchDog(dogId, cb) {
      const state = { regimens: [], days: {}, events: [] };
      const pending = { regimens: false, days: false, events: false };
      const emit = () => cb(state, { pending: Object.values(pending).some(Boolean) });
      const unsubs = {};
      let stopped = false;
      const listen = (name, attempt = 0) => {
        unsubs[name] = F.onSnapshot(sub(dogId, name), { includeMetadataChanges: true }, snap => {
          pending[name] = snap.metadata.hasPendingWrites;
          if (name === 'days') {
            state.days = {};
            snap.docs.forEach(d => { state.days[d.id] = { date: d.id, ...d.data() }; });
          } else {
            state[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          }
          emit();
        }, e => {
          // Juuri luotu koira ei välttämättä ole vielä palvelimella, jolloin säännöt hylkäävät
          // kuuntelun hetkellisesti → yritetään uudelleen
          if (e.code === 'permission-denied' && attempt < 8 && !stopped) {
            setTimeout(() => { if (!stopped) listen(name, attempt + 1); }, 1000 * (attempt + 1));
          } else {
            window.dispatchEvent(new CustomEvent('store-error', { detail: e }));
          }
        });
      };
      ['regimens', 'days', 'events'].forEach(name => listen(name));
      return () => { stopped = true; Object.values(unsubs).forEach(u => u()); };
    },
    setDay(dogId, date, patch) {
      fire(F.setDoc(subDoc(dogId, 'days', date), { ...clean(patch), date, updatedAt: nowIso() }, { merge: true }));
    },
    putRegimen(dogId, r) {
      const { id, ...rest } = r;
      fire(F.setDoc(subDoc(dogId, 'regimens', id), { ...clean(rest), updatedAt: nowIso() }));
    },
    deleteRegimen(dogId, id) { fire(F.deleteDoc(subDoc(dogId, 'regimens', id))); },
    putEvent(dogId, ev) {
      const { id, ...rest } = ev;
      fire(F.setDoc(subDoc(dogId, 'events', id), { ...clean(rest), updatedAt: nowIso() }));
    },
    deleteEvent(dogId, id) { fire(F.deleteDoc(subDoc(dogId, 'events', id))); },

    async importData(dogId, data) {
      const writes = [];
      (data.regimens || []).forEach(r => { const { id, ...rest } = r; writes.push([subDoc(dogId, 'regimens', id), rest]); });
      (data.days || []).forEach(d => writes.push([subDoc(dogId, 'days', d.date), d]));
      (data.events || []).forEach(e => { const { id, ...rest } = e; writes.push([subDoc(dogId, 'events', id), rest]); });
      for (let i = 0; i < writes.length; i += 400) {
        const batch = F.writeBatch(db);
        writes.slice(i, i + 400).forEach(([ref, val]) => batch.set(ref, clean(val), { merge: true }));
        fire(batch.commit());
      }
      return writes.length;
    },
  };
}

// ---------------------------------------------------------------- Paikallinen testitila
function createLocalStore() {
  const KEY = 'martti-localdb-v1'; // etuliite: origin on jaettu muiden sovellusten kanssa
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || null; } catch { db = null; }
  if (!db) db = { dogs: {}, data: {} };
  const dogListeners = new Set();
  const dataListeners = new Map(); // dogId -> Set(cb)

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.error(e); } };
  const bucket = dogId => (db.data[dogId] ||= { regimens: {}, days: {}, events: {} });
  const dogList = () => Object.entries(db.dogs).map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const snapshot = dogId => {
    const b = bucket(dogId);
    return {
      regimens: Object.entries(b.regimens).map(([id, r]) => ({ id, ...r })),
      days: structuredClone(b.days),
      events: Object.entries(b.events).map(([id, e]) => ({ id, ...e })),
    };
  };
  const notifyDogs = () => dogListeners.forEach(cb => cb(dogList(), { fromCache: false }));
  const notify = dogId => { save(); (dataListeners.get(dogId) || []).forEach(cb => cb(snapshot(dogId), { pending: false })); };
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  return {
    cloud: false,
    onAuth(cb) { setTimeout(() => cb({ name: 'Paikallinen testitila', email: '' }), 0); },
    async signIn() {},
    async signOut() {},
    watchDogs(cb) {
      dogListeners.add(cb);
      // (paikallisessa tilassa ei käyttöoikeusvirheitä)
      setTimeout(() => cb(dogList(), { fromCache: false }), 0);
      return () => dogListeners.delete(cb);
    },
    addDog(name, { id: fixedId, members = [] } = {}) {
      const dogId = fixedId || id();
      db.dogs[dogId] = { name, background: '', members, createdAt: nowIso() };
      save(); notifyDogs();
      return dogId;
    },
    updateDog(dogId, patch) { Object.assign(db.dogs[dogId], clean(patch)); save(); notifyDogs(); },
    watchDog(dogId, cb) {
      if (!dataListeners.has(dogId)) dataListeners.set(dogId, new Set());
      dataListeners.get(dogId).add(cb);
      setTimeout(() => cb(snapshot(dogId), { pending: false }), 0);
      return () => dataListeners.get(dogId).delete(cb);
    },
    setDay(dogId, date, patch) {
      const b = bucket(dogId);
      b.days[date] = { ...(b.days[date] || {}), ...clean(patch), date, updatedAt: nowIso() };
      notify(dogId);
    },
    putRegimen(dogId, r) { const { id: rid, ...rest } = r; bucket(dogId).regimens[rid] = { ...clean(rest), updatedAt: nowIso() }; notify(dogId); },
    deleteRegimen(dogId, rid) { delete bucket(dogId).regimens[rid]; notify(dogId); },
    putEvent(dogId, ev) { const { id: eid, ...rest } = ev; bucket(dogId).events[eid] = { ...clean(rest), updatedAt: nowIso() }; notify(dogId); },
    deleteEvent(dogId, eid) { delete bucket(dogId).events[eid]; notify(dogId); },
    async importData(dogId, data) {
      const b = bucket(dogId);
      let n = 0;
      (data.regimens || []).forEach(r => { const { id: rid, ...rest } = r; b.regimens[rid] = { ...b.regimens[rid], ...rest }; n++; });
      (data.days || []).forEach(d => { b.days[d.date] = { ...b.days[d.date], ...d }; n++; });
      (data.events || []).forEach(e => { const { id: eid, ...rest } = e; b.events[eid] = { ...b.events[eid], ...rest }; n++; });
      notify(dogId);
      return n;
    },
  };
}
