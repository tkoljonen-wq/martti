// Firebase-projektin asetukset (Firebase-konsoli: Project settings → General → Your apps → martti-web → Config).
// apiKey ei ole salaisuus – tietoturva hoidetaan Firestoren säännöillä, ks. firestore.rules.
//
// Jos apiKey puuttuu, sovellus toimii paikallisessa testitilassa (data vain tässä selaimessa).

export const firebaseConfig = {
  apiKey: "AIzaSyA0mtni0hS2P5iOs0wzGw1LH2sU9-uv1EM",
  authDomain: "martti-paivakirja.firebaseapp.com",
  projectId: "martti-paivakirja",
  storageBucket: "martti-paivakirja.firebasestorage.app",
  messagingSenderId: "45063030191",
  appId: "1:45063030191:web:aa35b169c24465bf90db5a"
};

// Tilit, joille uudet koirat (ja automaattisesti luotava Martti) jaetaan.
// Pääsy rajataan lisäksi Firestoren säännöissä (firestore.rules) – lisää uusi tili molempiin.
export const defaultMembers = ['tkoljonen@gmail.com', 'koljonen.pia@gmail.com'];
