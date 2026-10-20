# Martin päiväkirja

Koiran ravitsemus- ja oirepäiväkirja (PWA). Toimii Android-puhelimessa asennettuna sovelluksena ja tavallisessa selaimessa. Tiedot tallentuvat Firebaseen (Firestore) ja synkronoituvat kaikille laitteille. Koiran päiväkirja on yhteinen: kaikki koiran käyttäjälistalla olevat Google-tilit (nyt tkoljonen@gmail.com ja koljonen.pia@gmail.com) näkevät ja muokkaavat samoja tietoja. Kirjaukset toimivat myös offline-tilassa ja synkronoituvat, kun yhteys palaa.

Ilman Firebase-asetuksia sovellus toimii **paikallisessa testitilassa**: tiedot tallentuvat vain kyseiseen selaimeen.

## Mitä kirjataan

| Mitä | Missä |
|---|---|
| Närästys yöllä ja päivällä sekä pintojen ja itsensä nuoleminen (ei / 1 / 2 / 3), jokaiselle vapaaehtoinen kommentti | Kirjaa |
| Uloste: limainen, löysä, tavallista tiheämpi, verta (normaali, jos mitään ei valita) | Kirjaa |
| Herkut ja satunnaiset ruoat, kielletyt/vahingossa syödyt, satunnaiset lääkkeet, muistiinpanot | Kirjaa |
| Perusravinto ja jatkuva lääkitys (aloitus- ja lopetuspäivä) | Ruoka & lääkkeet |

"Yö" tarkoittaa kirjauspäivää edeltävää yötä (kirjataan aamulla).

**Vakiovastaukset:** herkun, kielletyn, satunnaisen lääkkeen ja muistiinpanon tekstin voi tallentaa vakiovastaukseksi ("Tallenna vakiovastaukseksi"). Jatkossa sen voi valita valikosta tai kirjoittaa vapaan tekstin. Jokaisella tyypillä on oma listansa, ja listat tallentuvat koiran tietoihin (`treatTemplates`, `forbiddenTemplates`, `medTemplates`, `noteTemplates`), joten ne ovat yhteisiä kaikille käyttäjille ja tulevat varmuuskopion mukana.

## Kuvaaja

Kuvaaja-välilehdellä näkyvät närästys yöllä ja päivällä sekä pintojen ja itsensä nuoleminen omina viivakuvaajinaan (puuttuva kirjaus katkaisee viivan) sekä merkintärivit ulosteelle (veri punaisella) ja satunnaisille tapahtumille. Ruoka- ja lääkemuutokset näkyvät pystyviivoina (▶ aloitus, ■ lopetus). Kun kuvaajaa napauttaa, sen päivän tiedot avautuvat kuvaajan alle. Aikaväliksi voi valita 14, 30 tai 90 päivää tai kaikki tiedot.

## Vienti tekoälylle

Vienti-sivulta saat **Markdown-tiedoston** (.md), jossa on tulkintaohjeet, ruoka- ja lääkityshistoria sekä päiväkohtaiset kirjaukset jaksoittain. Jakso vaihtuu aina, kun perusravinto tai lääkitys muuttuu, ja jokaisella jaksolla on oma yhteenveto. Tiedoston voi antaa tekoälylle liitteenä tai jakaa suoraan puhelimen jakovalikosta. JSON-varmuuskopiossa on sama data koneluettavassa muodossa, ja sen voi myös tuoda takaisin sovellukseen.

## Firebase (projekti `martti-paivakirja`)

Käytössä: Google-kirjautuminen, sallittu domain `tkoljonen-wq.github.io`, Firestore (europe-north1) ja säännöt ([`firestore.rules`](firestore.rules)).

**API-avain** (`firebase-config.js`) on Firebasen julkinen web-avain, ei salaisuus. Se on rajattu Google Cloud Consolessa (APIs & Services → Credentials → Browser key → Website restrictions) osoitteisiin `https://tkoljonen-wq.github.io/*`, `https://martti-paivakirja.firebaseapp.com/*` ja `http://localhost:8080/*`. Jos sovellusta ajetaan jostain muusta osoitteesta (esim. eri portista), lisää se listaan. GitHubin secret scanning -hälytys avaimesta on suljettu perusteella "won't fix".

## Tila (16.10.2026)

- Julkaistu: https://tkoljonen-wq.github.io/martti/
- Testattu: kirjautuminen ja pilvitallennus localhostissa (tkoljonen@gmail.com)
- Versio 1.4.0: pintojen ja itsensä nuoleminen (0–3) närästyksen rinnalle
- Versio 1.3.0: vakiovastaukset ja Kuvaaja-välilehti
- Asennettu Android-puhelimiin (Timo ja Pia). Jos Chrome väittää sovelluksen olevan "jo asennettu", päivitä sivu kahdesti ja sulje välilehti, jotta uusi manifest otetaan käyttöön.

**Uuden käyttäjän lisääminen:**
1. Lisää sähköpostiosoite sääntöjen `allowed()`-listaan ([`firestore.rules`](firestore.rules)) ja julkaise säännöt Firebase-konsolissa (Firestore → Rules → Publish).
2. Lisää osoite sovelluksessa: Vienti → Jaettu käyttäjille. Voit lisätä sen myös tiedoston `firebase-config.js` `defaultMembers`-listaan uusia koiria varten.

### Käyttöönotto alusta (jos projekti joskus luodaan uudelleen)

1. Mene osoitteeseen https://console.firebase.google.com ja valitse **Create a project**, esim. nimellä `martti`. Google Analyticsia ei tarvita.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.** Valitse tukisähköposti ja tallenna.
3. **Authentication → Settings → Authorized domains → Add domain:** `tkoljonen-wq.github.io`
4. **Build → Firestore Database → Create database.** Valitse sijainniksi esim. `europe-north1 (Finland)` ja käynnistä *production mode* -tilassa.
5. **Firestore → Rules:** korvaa sisältö tiedoston [`firestore.rules`](firestore.rules) sisällöllä ja valitse **Publish**.
6. **Project settings (rataskuvake) → General → Your apps → `</>` (Web).** Rekisteröi sovellus (Hostingia ei tarvita) ja kopioi `firebaseConfig`-olio tiedostoon [`firebase-config.js`](firebase-config.js) `null`-arvon tilalle.
7. Vie muutokset GitHubiin. Sovellus kysyy nyt Google-kirjautumista.

Ilmaiskiintiö (Spark): 50 000 lukua ja 20 000 kirjoitusta päivässä sekä 1 GiB tallennustilaa. Tämä riittää päiväkirjakäyttöön moninkertaisesti.

**Paikallisen testitilan datan siirto pilveen:** lataa Vienti-sivulta varmuuskopio (.json) ennen Firebasen käyttöönottoa ja tuo se kirjautumisen jälkeen.

## Julkaisu GitHub Pagesiin

Repo `martti` → Settings → Pages → Deploy from branch `main` / root. Osoite: `https://tkoljonen-wq.github.io/martti/`

Android: avaa osoite Chromessa ja valitse ⋮ → **Asenna sovellus** / **Lisää aloitusnäytölle**.

## Paikallinen kehitys

```bash
python -m http.server 8080
```
Avaa http://localhost:8080. `localhost` on Firebasen sallituissa domaineissa oletuksena.

## Tiedostot

- `index.html`, `css/style.css`: käyttöliittymä
- `js/app.js`: näkymät ja toiminnot
- `js/store.js`: tietovarasto (Firestore tai paikallinen testitila)
- `js/export.js`: Markdown- ja JSON-vienti
- `js/chart.js`: Kuvaaja-välilehden SVG-kuvaaja
- `js/util.js`: päivämäärät, vakiot
- `sw.js`: service worker (network first, välimuistin etuliite `martti-paivakirja-`)
- `manifest.json`, `icons/`: PWA (PNG-ikonit WebAPK-asennusta varten, manifestissa oma `id`)
- `firestore.rules`: Firestoren tietoturvasäännöt
