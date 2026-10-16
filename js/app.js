import { createStore } from './store.js';
import { defaultMembers } from '../firebase-config.js';
import {
  todayStr, addDays, daysBetween, fiDate, newId, esc, isActive, dayHasRecord,
  LEVELS, STOOL_FLAGS, stoolLabel, EVENT_TYPES, REGIMEN_KINDS,
} from './util.js';
import { buildMarkdown, buildJSON, dataRange } from './export.js';

const APP_VERSION = '1.0.0';
const $ = s => document.querySelector(s);
const main = $('#main');
const dlg = $('#dlg');

const S = {
  store: null, user: null,
  dogs: [], dogId: null,
  data: { regimens: [], days: {}, events: [] },
  date: todayStr(),
  view: 'log',
  pending: false,
  histLimit: 60,
  histFrom: null, histTo: null, // historian aikaväli (null = kaikki)
  unsubDogs: null, unsubDog: null,
  autoCreating: false,
  deferRender: false,
};

// localStorage on jaettu muiden saman originin sovellusten kanssa → avaimille etuliite
const LS_DOG = 'martti-selectedDog';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ei väliä */ } };

const dog = () => S.dogs.find(d => d.id === S.dogId);
const dayOf = date => S.data.days[date] || {};

// ------------------------------------------------------------ yleiset
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
window.addEventListener('store-error', e => {
  console.error(e.detail);
  toast('Tallennusvirhe: ' + (e.detail?.code || e.detail?.message || e.detail));
});

function updateSync() {
  const el = $('#syncStatus');
  if (!S.store) return;
  if (!S.store.cloud) { el.textContent = '💾 Paikallinen'; el.className = 'sync'; return; }
  const waiting = S.pending || !navigator.onLine;
  el.textContent = waiting ? '⏳ Odottaa synkr.' : '☁️ Tallennettu';
  el.className = 'sync' + (waiting ? ' pending' : '');
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', updateSync);

const isEditing = () => {
  const a = document.activeElement;
  return a && main.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'date' && a.type !== 'file'));
};
function requestRender() {
  if (isEditing()) { S.deferRender = true; return; }
  render();
}
main.addEventListener('focusout', () => setTimeout(() => {
  if (S.deferRender && !isEditing()) { S.deferRender = false; render(); }
}, 0));

// ------------------------------------------------------------ käynnistys
async function init() {
  try {
    S.store = await createStore();
  } catch (e) {
    main.innerHTML = `<div class="card error">Tietokantaa ei voitu ladata (${esc(e.message)}). Tarkista verkkoyhteys ja yritä uudelleen.</div>`;
    return;
  }
  updateSync();
  S.store.onAuth(user => {
    S.user = user;
    S.unsubDogs?.(); S.unsubDogs = null;
    S.unsubDog?.(); S.unsubDog = null;
    S.dogId = null; S.dogs = [];
    if (!user) {
      document.body.classList.add('locked');
      $('#login').hidden = false;
      return;
    }
    document.body.classList.remove('locked');
    $('#login').hidden = true;
    main.innerHTML = '<p class="loading">Ladataan…</p>';
    S.unsubDogs = S.store.watchDogs(onDogs, onDogsError);
  });
}

$('#loginBtn').addEventListener('click', async () => {
  $('#loginError').textContent = '';
  try { await S.store.signIn(); } catch (e) {
    $('#loginError').textContent = 'Kirjautuminen epäonnistui: ' + (e.code || e.message);
  }
});

function onDogsError(e) {
  console.error(e);
  const denied = e?.code === 'permission-denied';
  main.innerHTML = `<div class="card">
    <h2>${denied ? 'Ei käyttöoikeutta' : 'Tietojen haku epäonnistui'}</h2>
    <p>${denied ? `Tilillä <b>${esc(S.user?.email || '')}</b> ei ole pääsyä tähän sovellukseen.` : esc(e?.message || e)}</p>
    <button class="btn" data-act="signOut">Kirjaudu ulos</button>
  </div>`;
}

function onDogs(dogs, meta) {
  S.dogs = dogs;
  if (!dogs.length) {
    // Luodaan ensimmäinen koira vasta kun palvelin on vahvistanut, ettei koiria ole
    if (!meta.fromCache && !S.autoCreating) { S.autoCreating = true; S.dogId = S.store.addDog('Martti', { id: 'martti', members: defaultMembers }); }
    return;
  }
  const saved = lsGet(LS_DOG);
  const next = dogs.some(d => d.id === S.dogId) ? S.dogId : (dogs.find(d => d.id === saved)?.id || dogs[0].id);
  renderDogSelect();
  if (next !== S.dogId || !S.unsubDog) selectDog(next); else requestRender();
}

function renderDogSelect() {
  const sel = $('#dogSelect');
  sel.innerHTML = S.dogs.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('') +
    '<option value="__add">＋ Lisää koira…</option>';
  sel.value = S.dogId && S.dogs.some(d => d.id === S.dogId) ? S.dogId : S.dogs[0]?.id;
}
$('#dogSelect').addEventListener('change', e => {
  if (e.target.value === '__add') {
    e.target.value = S.dogId;
    addDogPrompt();
  } else selectDog(e.target.value);
});
function addDogPrompt() {
  const name = prompt('Uuden koiran nimi:');
  if (!name || !name.trim()) return;
  const id = S.store.addDog(name.trim(), { members: dog()?.members || defaultMembers });
  selectDog(id);
  toast(`${name.trim()} lisätty`);
}

function selectDog(id) {
  S.dogId = id;
  lsSet(LS_DOG, id);
  S.unsubDog?.();
  S.data = { regimens: [], days: {}, events: [] };
  S.unsubDog = S.store.watchDog(id, (data, meta) => {
    if (S.dogId !== id) return;
    S.data = data;
    S.pending = meta.pending;
    updateSync();
    requestRender();
  });
  renderDogSelect();
  render();
}

// ------------------------------------------------------------ näkymät
$('#tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  S.view = b.dataset.view;
  if (S.view === 'history') S.histLimit = 60;
  render();
  window.scrollTo(0, 0);
});

function render() {
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  if (!S.dogId) return;
  const v = { log: renderLog, regimens: renderRegimens, history: renderHistory, settings: renderSettings }[S.view];
  main.innerHTML = v();
}

// ------------------------------------------------------------ asennus (oma painike)
const installHtml = () => window.__installPrompt
  ? '<button class="btn primary wide" data-act="install" style="margin-bottom:12px">📲 Asenna Martin päiväkirja puhelimeen</button>'
  : '';
async function doInstall() {
  const evt = window.__installPrompt;
  if (!evt) return;
  // Tapahtuma on kertakäyttöinen: prompt() voi kutsua vain kerran
  window.__installPrompt = null;
  updateInstallUI();
  try {
    await evt.prompt();
    await evt.userChoice;
  } catch {
    toast('Asennusikkunan avaaminen epäonnistui');
  }
}
function updateInstallUI() {
  $('#loginInstall').hidden = !window.__installPrompt;
  if (S.dogId) requestRender();
}
document.addEventListener('installprompt-ready', updateInstallUI);
$('#loginInstall').addEventListener('click', doInstall);

function localBanner() {
  return S.store.cloud ? '' :
    '<div class="banner">Paikallinen testitila: tiedot tallentuvat vain tähän selaimeen. Pilvisynkronointi otetaan käyttöön lisäämällä Firebase-asetukset (ks. README).</div>';
}

// --- Kirjaa
function relDay(date) {
  const n = daysBetween(date, todayStr());
  if (n === 0) return 'Tänään';
  if (n === 1) return 'Eilen';
  if (n > 1) return `${n} päivää sitten`;
  return 'Tulevaisuudessa';
}

function levelCard(field, commentField, title, sub, d) {
  return `<section class="card">
    <h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>
    <div class="levels" data-field="${field}">
      ${LEVELS.map(l => `<button type="button" data-level="${l.v}" class="${d[field] === l.v ? 'sel' : ''}">${l.label}<small>${l.v === 0 ? 'ei oireita' : l.long}</small></button>`).join('')}
    </div>
    <input class="comment" data-field="${commentField}" value="${esc(d[commentField] || '')}" placeholder="Kommentti (vapaaehtoinen)" autocomplete="off">
  </section>`;
}

function renderLog() {
  const d = dayOf(S.date);
  const today = todayStr();
  const evs = S.data.events.filter(e => e.date === S.date)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const active = S.data.regimens.filter(r => isActive(r, S.date));
  const actList = kind => {
    const l = active.filter(r => r.kind === kind);
    return l.length ? l.map(r => esc(r.name) + (r.details ? ` <span class="muted">(${esc(r.details)})</span>` : '')).join('<br>') : '<span class="muted">ei kirjattu</span>';
  };
  return `
  <div class="datebar">
    <button class="navbtn" data-act="prev" aria-label="Edellinen päivä">‹</button>
    <label class="datepick">
      <span class="lbl">${fiDate(S.date)}</span><span class="sub">${relDay(S.date)}</span>
      <input type="date" id="dateInput" value="${esc(S.date)}" max="${today}" aria-label="Valitse päivä">
    </label>
    <button class="navbtn" data-act="next" aria-label="Seuraava päivä" ${S.date >= today ? 'disabled' : ''}>›</button>
  </div>
  ${S.date !== today ? '<button class="btn small today-link" data-act="today">↩ Siirry tähän päivään</button>' : ''}
  ${installHtml()}
  ${localBanner()}
  ${levelCard('nightLevel', 'nightComment', '🌙 Närästys yöllä', 'edeltävä yö', d)}
  ${levelCard('dayLevel', 'dayComment', '☀️ Närästys päivällä', '', d)}
  <section class="card">
    <h2>💩 Uloste</h2>
    <p class="hint">Valitse yksi tai useampi. Jos mitään ei valita, uloste katsotaan normaaliksi.</p>
    <div class="chips">
      ${STOOL_FLAGS.map(f => `<button type="button" data-flag="${f.id}" class="${(d.stool || []).includes(f.id) ? 'sel' : ''}">${f.label}</button>`).join('')}
    </div>
    <input class="comment" data-field="stoolComment" value="${esc(d.stoolComment || '')}" placeholder="Kommentti (vapaaehtoinen)" autocomplete="off">
  </section>
  <section class="card">
    <h2>Satunnaiset ja muistiinpanot</h2>
    ${evs.length ? `<ul class="list">${evs.map(e => `
      <li class="click" data-act="editEvent" data-id="${esc(e.id)}">
        <span class="ico">${EVENT_TYPES[e.type]?.icon || '•'}</span>
        <div class="grow"><div class="title">${esc(e.text)}</div>
        <div class="meta">${EVENT_TYPES[e.type]?.short || ''}${e.comment ? ' · ' + esc(e.comment) : ''}</div></div>
      </li>`).join('')}</ul>` : '<p class="empty">Ei kirjauksia tälle päivälle.</p>'}
    <div class="addgrid" style="margin-top:10px">
      ${Object.entries(EVENT_TYPES).map(([k, t]) => `<button class="btn" data-act="addEvent" data-type="${k}">${t.icon} ${k === 'note' ? 'Muistiinpano' : t.label}</button>`).join('')}
    </div>
  </section>
  <section class="card">
    <h2>Voimassa ${S.date === today ? 'nyt' : fiDate(S.date, false)}</h2>
    <p style="margin:0 0 6px"><b>🍲 Perusravinto:</b><br>${actList('food')}</p>
    <p style="margin:0 0 10px"><b>💊 Jatkuva lääkitys:</b><br>${actList('med')}</p>
    <button class="btn small" data-act="goRegimens">Muokkaa ruokaa ja lääkitystä</button>
  </section>`;
}

// --- Ruoka & lääkkeet
function renderRegimens() {
  const today = todayStr();
  const section = kind => {
    const K = REGIMEN_KINDS[kind];
    const all = S.data.regimens.filter(r => r.kind === kind);
    const current = all.filter(r => !r.endDate || r.endDate >= today).sort((a, b) => b.startDate.localeCompare(a.startDate));
    const ended = all.filter(r => r.endDate && r.endDate < today).sort((a, b) => b.endDate.localeCompare(a.endDate));
    const item = r => {
      const future = r.startDate > today;
      const meta = [
        r.details ? esc(r.details) : '',
        r.endDate ? `${fiDate(r.startDate, false)} – ${fiDate(r.endDate, false)} (${daysBetween(r.startDate, r.endDate) + 1} pv)`
          : future ? `alkaa ${fiDate(r.startDate, false)}`
            : `alkaen ${fiDate(r.startDate, false)} (${daysBetween(r.startDate, today) + 1}. päivä)`,
      ].filter(Boolean).join(' · ');
      return `<li class="click" data-act="editReg" data-id="${esc(r.id)}">
        <div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${meta}</div></div>
        ${!r.endDate ? `<button class="btn small" data-act="endReg" data-id="${esc(r.id)}">Lopeta</button>` : ''}
      </li>`;
    };
    return `<section class="card">
      <h2>${K.icon} ${K.label} <small>${kind === 'food' ? 'annetaan jatkuvasti' : 'säännöllinen lääkitys'}</small></h2>
      <h3>Käytössä</h3>
      ${current.length ? `<ul class="list">${current.map(item).join('')}</ul>` : '<p class="empty">Ei käytössä olevia.</p>'}
      <button class="btn primary wide" style="margin-top:8px" data-act="addReg" data-kind="${kind}">＋ Lisää ${K.label.toLowerCase()}</button>
      ${ended.length ? `<h3>Päättyneet</h3><ul class="list">${ended.map(item).join('')}</ul>` : ''}
    </section>`;
  };
  return `${localBanner()}
    ${section('food')}
    ${section('med')}
    <p class="hint" style="margin:0 4px">Kun ruokavalio vaihtuu, paina vanhan kohdalla <b>Lopeta</b> ja lisää uusi. Herkut, vahingossa syödyt asiat ja satunnaiset lääkkeet kirjataan <b>Kirjaa</b>-sivulla päiväkohtaisesti.</p>`;
}

// --- Historia
function badgeLevel(icon, v) {
  return v == null ? '' : `<span class="badge l${v}">${icon} ${v === 0 ? 'ei' : v}</span>`;
}
function avgOf(arr) {
  const v = arr.filter(x => x != null);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '–';
}
function summary(days) {
  const recs = days.map(dayOf).filter(dayHasRecord);
  const blood = recs.filter(d => (d.stool || []).includes('verta')).length;
  const loose = recs.filter(d => (d.stool || []).length).length;
  return `<b>${recs.length}</b> kirjattua pv · yö ka <b>${avgOf(recs.map(d => d.nightLevel))}</b> · päivä ka <b>${avgOf(recs.map(d => d.dayLevel))}</b> · poikkeava uloste <b>${loose}</b> pv${blood ? ` · <span style="color:var(--l3)">verta ${blood} pv</span>` : ''}`;
}

// Historian aikaväli: oletuksena ensimmäisestä kirjauksesta tähän päivään
function histRange() {
  const today = todayStr();
  const first = dataRange(S.data).from;
  let from = S.histFrom || first, to = S.histTo || today;
  if (to > today) to = today;
  if (from > to) [from, to] = [to, from];
  return { from, to, first, today };
}
const HIST_PRESETS = [{ days: 30, label: '30 pv' }, { days: 90, label: '3 kk' }, { days: 365, label: 'Vuosi' }];

function renderHistory() {
  const { from, to, first, today } = histRange();
  const filtered = !!(S.histFrom || S.histTo);
  const total = daysBetween(from, to) + 1;
  const last = k => Array.from({ length: k }, (_, i) => addDays(today, -i));
  const starts = {}, ends = {};
  S.data.regimens.forEach(r => {
    (starts[r.startDate] ||= []).push(r);
    if (r.endDate) (ends[r.endDate] ||= []).push(r);
  });
  const evByDate = {};
  S.data.events.forEach(e => (evByDate[e.date] ||= []).push(e));
  const thisYear = today.slice(0, 4);

  // Vain päivät, joilla on kirjauksia; histLimit rajaa näytettävien päivien määrää
  let rows = '', shown = 0, more = false;
  for (let i = 0; i < total; i++) {
    const date = addDays(to, -i);
    const d = S.data.days[date];
    const evs = evByDate[date] || [];
    const has = dayHasRecord(d) || evs.length > 0;
    if (has && shown >= S.histLimit) { more = true; break; }
    (ends[date] || []).forEach(r => { rows += `<div class="hsep end">■ Lopetettu ${fiDate(date, false)}: ${REGIMEN_KINDS[r.kind].icon} ${esc(r.name)}</div>`; });
    if (has) {
      shown++;
      let cells = '';
      if (dayHasRecord(d)) {
        cells += badgeLevel('🌙', d.nightLevel) + badgeLevel('☀️', d.dayLevel);
        (d.stool || []).forEach(f => { cells += `<span class="badge ${f === 'verta' ? 'blood' : 'stool'}">${esc(stoolLabel(f))}</span>`; });
        if (d.nightComment || d.dayComment || d.stoolComment) cells += '<span class="badge">💬</span>';
      }
      evs.forEach(e => { cells += `<span class="badge" title="${esc(e.text)}">${EVENT_TYPES[e.type]?.icon || '•'} ${esc(e.text.length > 18 ? e.text.slice(0, 17) + '…' : e.text)}</span>`; });
      const [wd, dm] = fiDate(date).split(' ');
      const year = date.slice(0, 4) !== thisYear ? ` ${date.slice(0, 4)}` : '';
      rows += `<div class="hrow" data-act="openDay" data-date="${esc(date)}"><div class="d"><b>${dm.split('.').slice(0, 2).join('.')}.${year}</b><span>${wd}${date === today ? ' · tänään' : ''}</span></div><div class="cells">${cells}</div></div>`;
    }
    (starts[date] || []).forEach(r => { rows += `<div class="hsep">▶ Aloitettu ${fiDate(date, false)}: ${REGIMEN_KINDS[r.kind].icon} ${esc(r.name)}</div>`; });
  }
  if (!shown) rows += '<p class="nodata" style="margin:10px 0 0">Ei kirjauksia valitulla aikavälillä.</p>';

  const preset = HIST_PRESETS.find(p => S.histTo == null && S.histFrom === addDays(today, -(p.days - 1)));
  const chip = (act, label, sel, extra = '') => `<button type="button" data-act="${act}"${extra} class="${sel ? 'sel' : ''}">${label}</button>`;
  const rangeDays = Array.from({ length: Math.min(total, 3650) }, (_, i) => addDays(to, -i));
  return `${localBanner()}
    <section class="card">
      <h2>Yhteenveto</h2>
      <p style="margin:0 0 6px;font-size:14px"><span class="muted">7 pv:</span> ${summary(last(7))}</p>
      <p style="margin:0;font-size:14px"><span class="muted">30 pv:</span> ${summary(last(30))}</p>
      ${filtered ? `<p style="margin:6px 0 0;font-size:14px"><span class="muted">${fiDate(from, false)}–${fiDate(to, false)}:</span> ${summary(rangeDays)}</p>` : ''}
    </section>
    <section class="card">
      <h2>Aikaväli</h2>
      <div class="chips">
        ${HIST_PRESETS.map(p => chip('histPreset', p.label, preset === p, ` data-days="${p.days}"`)).join('')}
        ${chip('histAll', 'Kaikki', !filtered)}
      </div>
      <div class="btnrow">
        <label class="field" style="flex:1;margin:0"><span>Alkaen</span><input type="date" id="histFrom" value="${esc(from)}" max="${esc(today)}"></label>
        <label class="field" style="flex:1;margin:0"><span>Päättyen</span><input type="date" id="histTo" value="${esc(to)}" max="${esc(today)}"></label>
      </div>
    </section>
    <section class="card">
      <h2>Päivät <small>napauta muokataksesi</small></h2>
      ${rows}
      ${more ? '<button class="btn wide" style="margin-top:10px" data-act="more">Näytä lisää</button>' : ''}
    </section>`;
}

// --- Vienti ja asetukset
function renderSettings() {
  const r = dataRange(S.data);
  const d = dog() || {};
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.md', { type: 'text/plain' })] }));
  return `${installHtml()}${localBanner()}
  <section class="card">
    <h2>📤 Vienti tekoälylle</h2>
    <p class="hint">Markdown-tiedosto sisältää tulkintaohjeet, ruokavalio- ja lääkityshistorian sekä päiväkohtaiset kirjaukset jaksoittain. Anna se tekoälylle liitteenä tai liitä sisältö keskusteluun.</p>
    <div class="btnrow" style="margin-bottom:12px">
      <label class="field" style="flex:1"><span>Alkaen</span><input type="date" id="exFrom" value="${esc(r.from)}" max="${esc(r.to)}"></label>
      <label class="field" style="flex:1"><span>Päättyen</span><input type="date" id="exTo" value="${esc(r.to)}" max="${esc(r.to)}"></label>
    </div>
    <div class="btnrow">
      <button class="btn primary" data-act="exportMd">📄 Lataa (.md)</button>
      ${canShare ? '<button class="btn" data-act="shareMd">📲 Jaa…</button>' : ''}
      <button class="btn" data-act="copyMd">📋 Kopioi</button>
    </div>
  </section>
  <section class="card">
    <h2>💾 Varmuuskopio</h2>
    <p class="hint">JSON-tiedosto sisältää koko koiran datan. Sitä voi käyttää myös tekoälyn raakadatana.</p>
    <div class="btnrow">
      <button class="btn" data-act="exportJson">Lataa varmuuskopio (.json)</button>
      <label class="btn" style="display:inline-flex;align-items:center;justify-content:center">Tuo varmuuskopio<input type="file" id="importFile" accept=".json,application/json" hidden></label>
    </div>
  </section>
  <section class="card">
    <h2>🐕 Koira</h2>
    <label class="field"><span>Nimi</span><input id="dogName" value="${esc(d.name || '')}"></label>
    <label class="field"><span>Taustatiedot tekoälylle (vapaaehtoinen)</span><textarea id="dogBg" placeholder="Esim. rotu, ikä, paino, diagnoosi (tulehduksellinen suolistosairaus), aiemmat kokeilut…">${esc(d.background || '')}</textarea></label>
    <div class="btnrow">
      <button class="btn primary" data-act="saveDog">Tallenna</button>
      <button class="btn" data-act="addDog">＋ Lisää uusi koira</button>
    </div>
  </section>
  ${S.store.cloud ? `<section class="card">
    <h2>👥 Jaettu käyttäjille</h2>
    <p class="hint">Nämä Google-tilit näkevät ja muokkaavat koiran ${esc(d.name || '')} tietoja. Uuden tilin pitää olla myös Firestoren säännöissä sallittu.</p>
    <ul class="list">${(d.members || []).map(m => `<li><div class="grow"><div class="title">${esc(m)}</div>${m === (S.user?.email || '').toLowerCase() ? '<div class="meta">sinä</div>' : ''}</div>
      ${m !== (S.user?.email || '').toLowerCase() ? `<button class="btn small danger" data-act="removeMember" data-email="${esc(m)}">Poista</button>` : ''}</li>`).join('')}</ul>
    <div class="btnrow" style="margin-top:8px">
      <input class="comment" id="newMember" type="email" placeholder="nimi@gmail.com" style="flex:1 1 180px" autocomplete="off">
      <button class="btn" data-act="addMember">Lisää</button>
    </div>
  </section>` : ''}
  <section class="card">
    <h2>👤 Tili</h2>
    ${S.store.cloud
      ? `<p style="margin:0 0 10px">Kirjautuneena: <b>${esc(S.user?.name || '')}</b><br><span class="muted">${esc(S.user?.email || '')}</span></p>
         <button class="btn danger" data-act="signOut">Kirjaudu ulos</button>`
      : '<p class="muted" style="margin:0">Paikallinen testitila – ei kirjautumista.</p>'}
  </section>
  <p class="hint" style="text-align:center">Martin päiväkirja v${APP_VERSION}</p>`;
}

// ------------------------------------------------------------ dialogit
function datalist(id, values) {
  const uniq = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fi'));
  return `<datalist id="${id}">${uniq.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

function openEventDialog(ev) {
  const T = EVENT_TYPES[ev.type];
  const isNote = ev.type === 'note';
  const isNew = !ev.id;
  dlg.innerHTML = `<form method="dialog" id="evForm">
    <h2>${T.icon} ${T.label}</h2>
    <label class="field"><span>Päivämäärä</span><input type="date" name="date" value="${esc(ev.date)}" max="${todayStr()}" required></label>
    ${isNote
      ? `<label class="field"><span>${T.what}</span><textarea name="text" required>${esc(ev.text || '')}</textarea></label>`
      : `<label class="field"><span>${T.what}</span><input name="text" list="evList" value="${esc(ev.text || '')}" required autocomplete="off"></label>
         ${datalist('evList', S.data.events.filter(e => e.type === ev.type).map(e => e.text))}
         <label class="field"><span>Kommentti (vapaaehtoinen)</span><textarea name="comment">${esc(ev.comment || '')}</textarea></label>`}
    <div class="btnrow">
      <button class="btn primary" value="save">Tallenna</button>
      ${!isNew ? '<button class="btn danger" value="delete" formnovalidate>Poista</button>' : ''}
      <button class="btn" value="cancel" formnovalidate>Peruuta</button>
    </div>
  </form>`;
  const form = $('#evForm');
  form.addEventListener('submit', e => {
    const action = e.submitter?.value;
    if (action === 'delete') {
      if (!confirm('Poistetaanko kirjaus?')) { e.preventDefault(); return; }
      S.store.deleteEvent(S.dogId, ev.id);
      toast('Poistettu');
    } else if (action === 'save') {
      const f = new FormData(form);
      const text = String(f.get('text') || '').trim();
      if (!text) { e.preventDefault(); return; }
      S.store.putEvent(S.dogId, {
        id: ev.id || newId(),
        type: ev.type,
        date: f.get('date') || S.date,
        text,
        comment: String(f.get('comment') || '').trim(),
        createdAt: ev.createdAt || new Date().toISOString(),
      });
      toast('Tallennettu');
    }
  });
  dlg.showModal();
  if (isNew) setTimeout(() => form.querySelector('[name=text]').focus(), 50);
}

function openRegimenDialog(r, focusEnd = false) {
  const K = REGIMEN_KINDS[r.kind];
  const isNew = !r.id;
  dlg.innerHTML = `<form method="dialog" id="regForm">
    <h2>${K.icon} ${isNew ? 'Lisää ' + K.label.toLowerCase() : K.label}</h2>
    <label class="field"><span>Nimi</span><input name="name" list="regList" value="${esc(r.name || '')}" required autocomplete="off" placeholder="${r.kind === 'food' ? 'Esim. hydrolysoitu kuivaruoka' : 'Esim. prednisoloni'}"></label>
    ${datalist('regList', S.data.regimens.filter(x => x.kind === r.kind).map(x => x.name))}
    <label class="field"><span>${K.details} (vapaaehtoinen)</span><input name="details" value="${esc(r.details || '')}" autocomplete="off"></label>
    <div class="btnrow">
      <label class="field" style="flex:1"><span>Aloitettu</span><input type="date" name="startDate" value="${esc(r.startDate || todayStr())}" required></label>
      <label class="field" style="flex:1"><span>Lopetettu (viimeinen päivä)</span><input type="date" name="endDate" value="${esc(r.endDate || '')}"></label>
    </div>
    <p class="hint">Jätä lopetuspäivä tyhjäksi, jos käyttö jatkuu.</p>
    <p class="error" id="regErr"></p>
    <div class="btnrow">
      <button class="btn primary" value="save">Tallenna</button>
      ${!isNew ? '<button class="btn danger" value="delete" formnovalidate>Poista</button>' : ''}
      <button class="btn" value="cancel" formnovalidate>Peruuta</button>
    </div>
  </form>`;
  const form = $('#regForm');
  form.addEventListener('submit', e => {
    const action = e.submitter?.value;
    if (action === 'delete') {
      if (!confirm(`Poistetaanko "${r.name}" kokonaan? (Jos käyttö vain loppui, aseta lopetuspäivä.)`)) { e.preventDefault(); return; }
      S.store.deleteRegimen(S.dogId, r.id);
      toast('Poistettu');
    } else if (action === 'save') {
      const f = new FormData(form);
      const name = String(f.get('name') || '').trim();
      const startDate = f.get('startDate');
      const endDate = f.get('endDate') || '';
      if (!name || !startDate) { e.preventDefault(); return; }
      if (endDate && endDate < startDate) {
        e.preventDefault();
        $('#regErr').textContent = 'Lopetuspäivä ei voi olla ennen aloituspäivää.';
        return;
      }
      S.store.putRegimen(S.dogId, {
        id: r.id || newId(), kind: r.kind, name,
        details: String(f.get('details') || '').trim(),
        startDate, endDate,
        createdAt: r.createdAt || new Date().toISOString(),
      });
      toast('Tallennettu');
    }
  });
  dlg.showModal();
  if (focusEnd) setTimeout(() => form.querySelector('[name=endDate]').focus(), 50);
}

dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

// ------------------------------------------------------------ tiedostot
function fileBase() {
  const name = (dog()?.name || 'koira').toLowerCase().replace(/[^a-z0-9åäö]+/gi, '-');
  return `${name}-paivakirja`;
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportRange() {
  let from = $('#exFrom').value, to = $('#exTo').value;
  if (!from || !to) { const r = dataRange(S.data); from ||= r.from; to ||= r.to; }
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
const mdText = () => { const { from, to } = exportRange(); return { from, to, text: buildMarkdown(dog(), S.data, from, to) }; };

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.days) || !Array.isArray(data.events) || !Array.isArray(data.regimens)) throw new Error('Tiedosto ei ole tämän sovelluksen varmuuskopio.');
    // Hyväksytään vain kelvolliset päivämäärät, tunnisteet ja arvot
    const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const okId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
    const flags = STOOL_FLAGS.map(f => f.id);
    const lvl = v => ([0, 1, 2, 3].includes(v) ? v : null);
    data.days = data.days.filter(d => isDate(d?.date)).map(d => ({
      ...d, nightLevel: lvl(d.nightLevel), dayLevel: lvl(d.dayLevel),
      stool: Array.isArray(d.stool) ? d.stool.filter(f => flags.includes(f)) : [],
    }));
    data.events = data.events.filter(e => okId(e?.id) && isDate(e.date) && EVENT_TYPES[e.type] && typeof e.text === 'string');
    data.regimens = data.regimens.filter(r => okId(r?.id) && REGIMEN_KINDS[r.kind] && isDate(r.startDate) && (!r.endDate || isDate(r.endDate)) && typeof r.name === 'string');
    const n = data.days.length + data.events.length + data.regimens.length;
    if (!confirm(`Tuodaanko ${n} tietuetta (${data.dog?.name || '?'}) koiralle ${dog().name}? Saman tunnisteen tiedot korvataan.`)) return;
    const count = await S.store.importData(S.dogId, data);
    toast(`Tuotu ${count} tietuetta`);
  } catch (e) {
    alert('Tuonti epäonnistui: ' + e.message);
  }
}

// ------------------------------------------------------------ tapahtumat
main.addEventListener('click', async e => {
  const lvlBtn = e.target.closest('.levels button');
  if (lvlBtn) {
    const field = lvlBtn.parentElement.dataset.field;
    const level = Number(lvlBtn.dataset.level);
    const cur = dayOf(S.date)[field];
    S.store.setDay(S.dogId, S.date, { [field]: cur === level ? null : level });
    return;
  }
  const flagBtn = e.target.closest('.chips button[data-flag]');
  if (flagBtn) {
    const flag = flagBtn.dataset.flag;
    const cur = dayOf(S.date).stool || [];
    const next = cur.includes(flag) ? cur.filter(f => f !== flag) : [...cur, flag];
    S.store.setDay(S.dogId, S.date, { stool: STOOL_FLAGS.map(f => f.id).filter(id => next.includes(id)) });
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'prev': S.date = addDays(S.date, -1); render(); break;
    case 'next': if (S.date < todayStr()) { S.date = addDays(S.date, 1); render(); } break;
    case 'today': S.date = todayStr(); render(); break;
    case 'addEvent': openEventDialog({ type: el.dataset.type, date: S.date }); break;
    case 'editEvent': { const ev = S.data.events.find(x => x.id === el.dataset.id); if (ev) openEventDialog(ev); break; }
    case 'goRegimens': S.view = 'regimens'; render(); window.scrollTo(0, 0); break;
    case 'addReg': openRegimenDialog({ kind: el.dataset.kind }); break;
    case 'editReg': { const r = S.data.regimens.find(x => x.id === el.dataset.id); if (r) openRegimenDialog(r); break; }
    case 'endReg': {
      e.stopPropagation();
      const r = S.data.regimens.find(x => x.id === el.dataset.id);
      if (r) openRegimenDialog({ ...r, endDate: r.startDate > todayStr() ? r.startDate : todayStr() }, true);
      break;
    }
    case 'openDay': S.date = el.dataset.date; S.view = 'log'; render(); window.scrollTo(0, 0); break;
    case 'more': S.histLimit += 60; render(); break;
    case 'histPreset': S.histFrom = addDays(todayStr(), -(Number(el.dataset.days) - 1)); S.histTo = null; S.histLimit = 60; render(); break;
    case 'histAll': S.histFrom = S.histTo = null; S.histLimit = 60; render(); break;
    case 'exportMd': { const { from, to, text } = mdText(); download(text, `${fileBase()}-${from}_${to}.md`, 'text/markdown;charset=utf-8'); break; }
    case 'shareMd': {
      const { from, to, text } = mdText();
      const file = new File([text], `${fileBase()}-${from}_${to}.md`, { type: 'text/plain' });
      try { await navigator.share({ files: [file], title: `${dog().name}: päiväkirja ${from}–${to}` }); }
      catch (err) { if (err.name !== 'AbortError') toast('Jakaminen ei onnistunut'); }
      break;
    }
    case 'copyMd': {
      try { await navigator.clipboard.writeText(mdText().text); toast('Kopioitu leikepöydälle'); }
      catch { toast('Kopiointi ei onnistunut'); }
      break;
    }
    case 'exportJson': download(buildJSON(dog(), S.data), `${fileBase()}-varmuuskopio-${todayStr()}.json`, 'application/json'); break;
    case 'saveDog': {
      const name = $('#dogName').value.trim();
      if (!name) { toast('Nimi puuttuu'); break; }
      S.store.updateDog(S.dogId, { name, background: $('#dogBg').value.trim() });
      toast('Tallennettu');
      break;
    }
    case 'addDog': addDogPrompt(); break;
    case 'install': doInstall(); break;
    case 'addMember': {
      const email = $('#newMember').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Tarkista sähköpostiosoite'); break; }
      const members = [...new Set([...(dog().members || []), email])];
      S.store.updateDog(S.dogId, { members });
      toast(`${email} lisätty`);
      break;
    }
    case 'removeMember': {
      const email = el.dataset.email;
      if (!confirm(`Poistetaanko käyttäjän ${email} pääsy?`)) break;
      S.store.updateDog(S.dogId, { members: (dog().members || []).filter(m => m !== email) });
      break;
    }
    case 'signOut': if (confirm('Kirjaudutaanko ulos?')) S.store.signOut(); break;
  }
});

main.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'dateInput' && t.value) { S.date = t.value > todayStr() ? todayStr() : t.value; render(); return; }
  if (t.id === 'histFrom' || t.id === 'histTo') {
    // Tyhjä kenttä = rajaton; tähän päivään päättyvä väli seuraa päivän vaihtumista
    const v = t.value || null;
    if (t.id === 'histFrom') S.histFrom = v; else S.histTo = v && v < todayStr() ? v : null;
    S.histLimit = 60; render(); return;
  }
  if (t.id === 'importFile' && t.files[0]) { importFile(t.files[0]); t.value = ''; return; }
  if (t.matches('input.comment[data-field]')) saveComment(t);
});
// Kommentit tallentuvat myös kirjoittaessa (viive), jottei mitään katoa jos sovellus suljetaan
const commentTimers = {};
main.addEventListener('input', e => {
  const t = e.target;
  if (!t.matches('input.comment[data-field]')) return;
  const date = S.date;
  clearTimeout(commentTimers[t.dataset.field]);
  commentTimers[t.dataset.field] = setTimeout(() => saveComment(t, date), 1200);
});
function saveComment(t, date = S.date) {
  clearTimeout(commentTimers[t.dataset.field]);
  const val = t.value.trim();
  if ((dayOf(date)[t.dataset.field] || '') === val) return;
  S.store.setDay(S.dogId, date, { [t.dataset.field]: val });
}
main.addEventListener('click', e => {
  const pick = e.target.closest('.datepick input');
  if (pick && pick.showPicker) { try { pick.showPicker(); } catch { /* selain avaa itse */ } }
});

document.addEventListener('visibilitychange', () => {
  // Jos sovellus on ollut auki yön yli, "tänään" vaihtuu
  if (document.visibilityState === 'visible' && S.dogId && !isEditing()) render();
});

updateInstallUI();
init();
