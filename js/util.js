// Yleiset apufunktiot ja vakiot

export const pad = n => String(n).padStart(2, '0');

// Päivämäärät käsitellään aina paikallisena YYYY-MM-DD -merkkijonona (ei UTC)
export function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayStr = () => fmt(new Date());
export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}
export function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}
const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
export function fiDate(s, withWd = true) {
  if (!s) return '';
  const d = parse(s);
  return `${withWd ? WD[d.getDay()] + ' ' : ''}${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const isActive = (reg, date) => reg.startDate <= date && (!reg.endDate || reg.endDate >= date);

export const LEVELS = [
  { v: 0, label: 'Ei', long: 'ei närästystä' },
  { v: 1, label: '1', long: 'lievä' },
  { v: 2, label: '2', long: 'kohtalainen' },
  { v: 3, label: '3', long: 'vakava' },
];

// Asteikolla 0–3 kirjattavat oireet (päivän kentät)
export const SYMPTOMS = [
  { field: 'nightLevel', comment: 'nightComment', icon: '🌙', label: 'Närästys yöllä', short: 'Yö', sub: 'edeltävä yö' },
  { field: 'dayLevel', comment: 'dayComment', icon: '☀️', label: 'Närästys päivällä', short: 'Päivä' },
  { field: 'lickSurfaceLevel', comment: 'lickSurfaceComment', icon: '👅', label: 'Pintojen nuoleminen', short: 'Pinnat' },
  { field: 'lickSelfLevel', comment: 'lickSelfComment', icon: '🐾', label: 'Itsensä nuoleminen', short: 'Itsensä' },
];

export const STOOL_FLAGS = [
  { id: 'limainen', label: 'Limainen' },
  { id: 'loysa', label: 'Löysä' },
  { id: 'tihea', label: 'Tavallista tiheämpi' },
  { id: 'verta', label: 'Verta ulosteessa' },
];
export const stoolLabel = id => STOOL_FLAGS.find(f => f.id === id)?.label || id;

export const EVENT_TYPES = {
  treat: { label: 'Herkku / satunnainen ruoka', short: 'Herkku', icon: '🦴', what: 'Mitä annettiin' },
  forbidden: { label: 'Kielletty / vahingossa syöty', short: 'Kielletty', icon: '⚠️', what: 'Mitä söi' },
  med: { label: 'Satunnainen lääke', short: 'Lääke', icon: '💊', what: 'Lääke ja annos' },
  note: { label: 'Muistiinpano', short: 'Muistiinpano', icon: '📝', what: 'Muistiinpano' },
};

export const REGIMEN_KINDS = {
  food: { label: 'Perusravinto', icon: '🍲', details: 'Määrä / koostumus' },
  med: { label: 'Jatkuva lääkitys', icon: '💊', details: 'Annos' },
};

// Onko päivälle tehty jokin oirekirjaus
export function dayHasRecord(d) {
  if (!d) return false;
  return SYMPTOMS.some(s => d[s.field] != null || !!d[s.comment]) ||
    (d.stool && d.stool.length > 0) || !!d.stoolComment;
}
