// Kuvaaja-välilehden SVG: närästys yöllä ja päivällä sekä nuoleminen (0–3) sekä merkintärivit
// ulosteelle ja satunnaisille tapahtumille. Ruoka- ja lääkemuutokset pystyviivoina.
import { addDays, daysBetween, parse, EVENT_TYPES, REGIMEN_KINDS, SYMPTOMS } from './util.js';

export const CHART_W = 320;
export const CHART_L = 34; // vasen marginaali tasoille ja rivien kuvakkeille
const R = 6;
const PLOT_W = CHART_W - CHART_L - R;
const LEVEL_H = 72;

export const EVENT_COLORS = { treat: '#b07a2a', forbidden: '#b5482f', med: '#4f67b0', note: '#6c746f' };
export const KIND_COLORS = { food: '#2f6f5e', med: '#4f67b0' };
const STOOL_COLOR = '#8a5aa8';
const BLOOD_COLOR = '#c8382d';

// Päivän indeksi napautuskohdasta (viewBox-koordinaatteina)
export function dayIndexAt(vx, n) {
  const i = Math.floor((vx - CHART_L) / (PLOT_W / n));
  return Math.max(0, Math.min(n - 1, i));
}

export function buildChart(data, from, to, sel) {
  const n = daysBetween(from, to) + 1;
  const cw = PLOT_W / n;
  const xc = i => CHART_L + (i + 0.5) * cw;
  const dates = Array.from({ length: n }, (_, i) => addDays(from, i));
  const evBy = {};
  data.events.forEach(e => { if (e.date >= from && e.date <= to) ((evBy[e.date] ||= {})[e.type] = true); });

  let y = 4;
  const parts = [];
  const top = y;

  // Valitun päivän korostus piirretään myöhemmin koko korkeudelle
  const selIdx = sel && sel >= from && sel <= to ? daysBetween(from, sel) : -1;

  // Muutosmerkit yläreunaan
  const changes = [];
  data.regimens.forEach(r => {
    if (r.startDate >= from && r.startDate <= to) changes.push({ i: daysBetween(from, r.startDate), edge: 0, r, start: true });
    if (r.endDate && r.endDate >= from && r.endDate <= to) changes.push({ i: daysBetween(from, r.endDate), edge: 1, r, start: false });
  });
  y += 12;

  // Oirekuvaajat (närästys, nuoleminen)
  const levelChart = (field, title) => {
    const t = y + 20, h = LEVEL_H;
    const yv = v => t + (3 - v) * h / 3;
    let s = `<text x="4" y="${y + 9}" class="ch-title">${title}</text>`;
    [0, 1, 2, 3].forEach(v => {
      s += `<line x1="${CHART_L}" x2="${CHART_W - R}" y1="${yv(v)}" y2="${yv(v)}" class="ch-grid"/>`;
      s += `<text x="${CHART_L - 5}" y="${yv(v) + 3}" class="ch-ax" text-anchor="end">${v === 0 ? 'ei' : v}</text>`;
    });
    // Viiva katkeaa päivinä, joilta kirjaus puuttuu
    let path = '', prev = false;
    const dots = [];
    dates.forEach((d, i) => {
      const v = data.days[d]?.[field];
      if (v == null) { prev = false; return; }
      path += `${prev ? 'L' : 'M'}${xc(i).toFixed(1)} ${yv(v)}`;
      prev = true;
      dots.push([i, v]);
    });
    s += `<path d="${path}" class="ch-line"/>`;
    const r = Math.max(1.4, Math.min(3.4, cw * 0.32));
    dots.forEach(([i, v]) => { s += `<circle cx="${xc(i).toFixed(1)}" cy="${yv(v)}" r="${r.toFixed(1)}" fill="var(--l${v})"/>`; });
    y = t + h + 10;
    return s;
  };
  SYMPTOMS.forEach(s => parts.push(levelChart(s.field, `${s.icon} ${s.label}`)));

  // Merkintärivit
  const rowH = 17;
  const mr = Math.max(1.6, Math.min(4.2, cw * 0.36));
  const row = (icon, color, has) => {
    const cy = y + rowH / 2;
    let s = `<line x1="${CHART_L}" x2="${CHART_W - R}" y1="${cy}" y2="${cy}" class="ch-row"/>`;
    s += `<text x="${CHART_L - 6}" y="${cy + 4}" class="ch-ico" text-anchor="end">${icon}</text>`;
    dates.forEach((d, i) => { const c = has(d); if (c) s += `<circle cx="${xc(i).toFixed(1)}" cy="${cy}" r="${mr.toFixed(1)}" fill="${c === true ? color : c}"/>`; });
    y += rowH;
    return s;
  };
  y += 2;
  parts.push(row('💩', STOOL_COLOR, d => {
    const st = data.days[d]?.stool || [];
    return st.includes('verta') ? BLOOD_COLOR : st.length > 0;
  }));
  Object.entries(EVENT_TYPES).forEach(([k, T]) => parts.push(row(T.icon, EVENT_COLORS[k], d => !!evBy[d]?.[k])));
  const bottom = y + 2;

  // Muutosviivat koko korkeudelle
  let lines = '';
  changes.forEach(c => {
    const x = (CHART_L + (c.i + c.edge) * cw).toFixed(1);
    const col = KIND_COLORS[c.r.kind] || '#666';
    lines += `<line x1="${x}" x2="${x}" y1="${top + 10}" y2="${bottom}" stroke="${col}" class="ch-chg${c.start ? '' : ' end'}"/>`;
    lines += c.start
      ? `<path d="M${x} ${top} l7 4.5 l-7 4.5z" fill="${col}"/>`
      : `<rect x="${(x - 7).toFixed(1)}" y="${top + 1}" width="7" height="7" fill="${col}"/>`;
  });

  // Päivämäärät alareunaan
  y = bottom + 12;
  const step = Math.max(1, Math.ceil(n / 6));
  let ax = '';
  dates.forEach((d, i) => {
    if ((n - 1 - i) % step) return;
    const dt = parse(d);
    const lbl = n > 400 ? `${dt.getMonth() + 1}/${String(dt.getFullYear()).slice(2)}` : `${dt.getDate()}.${dt.getMonth() + 1}.`;
    ax += `<line x1="${xc(i).toFixed(1)}" x2="${xc(i).toFixed(1)}" y1="${bottom}" y2="${bottom + 3}" class="ch-grid"/>`;
    const last = i === n - 1;
    ax += `<text x="${last ? CHART_W - 1 : xc(i).toFixed(1)}" y="${y}" class="ch-ax" text-anchor="${last ? 'end' : 'middle'}">${lbl}</text>`;
  });
  const H = y + 4;

  const hi = selIdx >= 0
    ? `<rect x="${(CHART_L + selIdx * cw).toFixed(1)}" y="${top}" width="${Math.max(cw, 2).toFixed(1)}" height="${bottom - top}" class="ch-sel"/>`
    : '';

  return `<svg class="chart" viewBox="0 0 ${CHART_W} ${H}" data-act="chartTap" data-from="${from}" data-n="${n}" role="img" aria-label="Oirekuvaaja ${from}–${to}">
    ${hi}${parts.join('')}${lines}${ax}
  </svg>`;
}

// Ruoka- ja lääkemuutokset aikavälillä, uusin ensin
export function changesIn(regimens, from, to) {
  const out = [];
  regimens.forEach(r => {
    if (r.startDate >= from && r.startDate <= to) out.push({ date: r.startDate, r, start: true });
    if (r.endDate && r.endDate >= from && r.endDate <= to) out.push({ date: r.endDate, r, start: false });
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
export const kindIcon = k => REGIMEN_KINDS[k]?.icon || '';
