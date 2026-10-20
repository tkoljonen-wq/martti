// Vienti tekoälylle (Markdown) ja varmuuskopio (JSON)
import {
  todayStr, addDays, fiDate, isActive, dayHasRecord, LEVELS, SYMPTOMS, STOOL_FLAGS, stoolLabel,
  EVENT_TYPES, REGIMEN_KINDS,
} from './util.js';

export function dataRange(data) {
  const dates = [
    ...Object.keys(data.days),
    ...data.events.map(e => e.date),
    ...data.regimens.map(r => r.startDate),
  ].filter(Boolean).sort();
  return { from: dates[0] || todayStr(), to: todayStr() };
}

const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim();
const lvl = (v, comment) => {
  let s = v == null ? '–' : String(v);
  if (comment) s += ` (${comment})`;
  return s;
};
const regText = r => `${r.name}${r.details ? ` – ${r.details}` : ''}`;
const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '–';

function levelStats(values) {
  const rec = values.filter(v => v != null);
  const counts = [0, 1, 2, 3].map(l => rec.filter(v => v === l).length);
  return `kirjattu ${rec.length} kpl; ei oireita ${counts[0]}, lievä ${counts[1]}, kohtalainen ${counts[2]}, vakava ${counts[3]}; keskiarvo ${avg(rec)}`;
}

export function buildMarkdown(dog, data, from, to) {
  const L = [];
  const regs = data.regimens
    .filter(r => r.startDate <= to && (!r.endDate || r.endDate >= from))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const events = data.events.filter(e => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const evByDate = {};
  events.forEach(e => (evByDate[e.date] ||= []).push(e));

  L.push(`# Ravitsemus- ja oirepäiväkirja: ${dog.name}`, '');
  L.push(`- Viety: ${todayStr()}`);
  L.push(`- Aikaväli: ${from} – ${to}`);
  if (dog.background) L.push(`- Taustatiedot: ${cell(dog.background)}`);
  L.push('');
  L.push('## Tulkintaohjeet', '');
  L.push(`- Oireet arvioidaan asteikolla 0 = ei oireita, 1 = lievä, 2 = kohtalainen, 3 = vakava. "–" = ei kirjattu. Oireet: ${SYMPTOMS.map(s => s.label.toLowerCase()).join(', ')}.`);
  L.push('- "Yö" tarkoittaa kirjauspäivää edeltävää yötä (kirjataan aamulla). "Päivä" tarkoittaa kirjauspäivän päiväaikaa.');
  L.push(`- Ulosteen havainnot: ${STOOL_FLAGS.map(f => f.label.toLowerCase()).join(', ')}. Jos päivälle on tehty oirekirjaus mutta ulostehavaintoja ei ole, uloste on ollut normaali.`);
  L.push('- Päivä, jolla ei ole mitään kirjauksia, on merkitty "ei kirjausta" – siitä ei tiedetä oireita.');
  L.push('- Perusravinto ja jatkuva lääkitys ovat voimassa aloituspäivästä lopetuspäivään asti (lopetuspäivä mukaan lukien).');
  L.push('- Satunnaiset: herkut ja satunnaiset ruoat, vahingossa syödyt kielletyt asiat sekä satunnaisesti annetut lääkkeet.');
  L.push('');

  for (const kind of ['food', 'med']) {
    L.push(`## ${REGIMEN_KINDS[kind].label} (aikajana)`, '');
    const list = regs.filter(r => r.kind === kind);
    if (!list.length) L.push('- Ei kirjauksia tällä aikavälillä.');
    list.forEach(r => L.push(`- ${r.startDate} → ${r.endDate || 'jatkuu'}: ${regText(r)}`));
    L.push('');
  }

  // Jaksot: peräkkäiset päivät, joina voimassa oleva perusravinto + lääkitys on sama
  const periods = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const active = regs.filter(r => isActive(r, d));
    const key = active.map(r => r.id).sort().join(',');
    const last = periods[periods.length - 1];
    if (last && last.key === key) { last.to = d; last.dates.push(d); }
    else periods.push({ key, from: d, to: d, dates: [d], active });
  }

  L.push('## Jaksot', '');
  L.push('Jakso vaihtuu aina, kun perusravinto tai jatkuva lääkitys muuttuu.', '');
  periods.forEach((p, i) => {
    const foods = p.active.filter(r => r.kind === 'food');
    const meds = p.active.filter(r => r.kind === 'med');
    const days = p.dates.map(d => data.days[d]).filter(dayHasRecord);
    const pEvents = p.dates.flatMap(d => evByDate[d] || []);
    L.push(`### Jakso ${i + 1}: ${p.from} – ${p.to} (${p.dates.length} pv)`, '');
    L.push(`- Perusravinto: ${foods.length ? foods.map(regText).join('; ') : 'ei kirjattu'}`);
    L.push(`- Jatkuva lääkitys: ${meds.length ? meds.map(regText).join('; ') : 'ei'}`);
    L.push(`- Päiviä, joilla oirekirjaus: ${days.length} / ${p.dates.length}`);
    SYMPTOMS.forEach(s => L.push(`- ${s.label}: ${levelStats(days.map(d => d[s.field]))}`));
    L.push(`- Uloste: ${STOOL_FLAGS.map(f => `${f.label.toLowerCase()} ${days.filter(d => (d.stool || []).includes(f.id)).length} pv`).join(', ')}`);
    L.push(`- Satunnaiset: ${['treat', 'forbidden', 'med'].map(t => `${EVENT_TYPES[t].short.toLowerCase()} ${pEvents.filter(e => e.type === t).length} kpl`).join(', ')}`);
    L.push('');
    L.push(`| Pvm | ${SYMPTOMS.map(s => s.label).join(' | ')} | Uloste | Satunnaiset | Muistiinpanot |`);
    L.push(`|---|${SYMPTOMS.map(() => '---|').join('')}---|---|---|`);
    p.dates.forEach(date => {
      const d = data.days[date];
      const evs = evByDate[date] || [];
      const sat = evs.filter(e => e.type !== 'note')
        .map(e => `${EVENT_TYPES[e.type]?.short || e.type}: ${e.text}${e.comment ? ` (${e.comment})` : ''}`).join('; ');
      const notes = evs.filter(e => e.type === 'note').map(e => e.text + (e.comment ? ` (${e.comment})` : '')).join('; ');
      const label = `${date} ${fiDate(date).split(' ')[0]}`;
      if (!dayHasRecord(d) && !evs.length) {
        L.push(`| ${label} | ei kirjausta |${' |'.repeat(SYMPTOMS.length + 2)}`);
        return;
      }
      let stool = '–';
      if (dayHasRecord(d)) {
        stool = (d.stool || []).length ? d.stool.map(stoolLabel).join(', ').toLowerCase() : 'normaali';
        if (d.stoolComment) stool += ` (${d.stoolComment})`;
      }
      L.push(`| ${label} | ${SYMPTOMS.map(s => cell(lvl(d?.[s.field], d?.[s.comment]))).join(' | ')} | ${cell(stool)} | ${cell(sat)} | ${cell(notes)} |`);
    });
    L.push('');
  });

  return L.join('\n');
}

export function buildJSON(dog, data) {
  return JSON.stringify({
    app: 'martti-paivakirja',
    format: 1,
    exportedAt: new Date().toISOString(),
    dog: {
      name: dog.name, background: dog.background || '',
      ...Object.fromEntries(Object.keys(EVENT_TYPES).map(k => [`${k}Templates`, dog[`${k}Templates`] || []])),
    },
    scales: {
      symptomLevels: Object.fromEntries(LEVELS.map(l => [l.v, l.v === 0 ? 'ei oireita' : l.long])),
      symptoms: Object.fromEntries(SYMPTOMS.map(s => [s.field, s.label])),
      stool: Object.fromEntries(STOOL_FLAGS.map(f => [f.id, f.label])),
      eventTypes: Object.fromEntries(Object.entries(EVENT_TYPES).map(([k, v]) => [k, v.label])),
    },
    regimens: [...data.regimens].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    days: Object.values(data.days).sort((a, b) => a.date.localeCompare(b.date)),
    events: [...data.events].sort((a, b) => a.date.localeCompare(b.date)),
  }, null, 2);
}
