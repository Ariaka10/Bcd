/**
 * Lecture des listes d'élèves : export ONDE (« Extraction élèves », CSV séparé par « ; »)
 * ou tout fichier CSV contenant au moins les colonnes nom, prénom et classe.
 */
import { normalize } from './util.js';

export function detectDelimiter(line) {
  const counts = [';', ',', '\t'].map((d) => [d, line.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ';';
}

export function parseCsv(text, delimiter) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const d = delimiter ?? detectDelimiter(firstLine);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}

// Pour chaque champ : en-têtes reconnus (normalisés), du plus spécifique au plus général.
const COLUMNS = {
  usage_name: ["nom d usage eleve", "nom d usage"],
  last_name: ['nom eleve', 'nom de famille', 'nom'],
  first_name: ['prenom eleve', 'prenom 1', 'prenom'],
  birth_date: ['date naissance', 'date de naissance', 'ne e le', 'naissance'],
  class_name: ['libelle classe', 'classe', 'classes'],
  level: ['libelle niveau', 'niveau'],
  sex: ['sexe'],
  ine: ['ine', 'identifiant national eleve', 'identifiant national', 'identifiant'],
};

function headerKey(h) {
  return normalize(h).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function mapHeaders(headers) {
  const keys = headers.map(headerKey);
  const map = {};
  const used = new Set();
  // 1er passage : correspondances exactes ; 2e passage : l'en-tête commence par le libellé.
  for (const exact of [true, false]) {
    for (const [field, candidates] of Object.entries(COLUMNS)) {
      if (map[field] !== undefined) continue;
      for (const cand of candidates) {
        const idx = keys.findIndex((k, i) => !used.has(i) && (exact ? k === cand : k.startsWith(cand + ' ')));
        if (idx !== -1) { map[field] = idx; used.add(idx); break; }
      }
    }
  }
  return map;
}

/** Convertit « 03/09/2016 », « 2016-09-03 »… en AAAA-MM-JJ. */
export function parseDate(s) {
  s = String(s ?? '').trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function capitalize(s) {
  return String(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase());
}

/**
 * Renvoie { students: [...], errors: [...], columns } à partir du texte d'un fichier.
 * `defaultClass` sert quand le fichier n'a pas de colonne « classe ».
 */
export function parseStudentList(text, { defaultClass } = {}) {
  const rows = parseCsv(text);
  const errors = [];
  let headerIdx = -1;
  let map = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = mapHeaders(rows[i]);
    if ((m.last_name !== undefined || m.usage_name !== undefined) && m.first_name !== undefined) {
      headerIdx = i; map = m; break;
    }
  }
  if (headerIdx === -1) {
    return { students: [], errors: ['Colonnes « Nom » et « Prénom » introuvables dans le fichier.'], columns: {} };
  }
  if (map.class_name === undefined && !defaultClass) {
    errors.push('Pas de colonne « Classe » : choisissez une classe de destination.');
  }

  const students = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const val = (f) => (map[f] !== undefined ? (r[map[f]] ?? '').trim() : '');
    const last = val('usage_name') || val('last_name');
    const first = val('first_name');
    if (!last && !first) continue;
    if (!last || !first) {
      errors.push(`Ligne ${i + 1} : nom ou prénom manquant.`);
      continue;
    }
    students.push({
      line: i + 1,
      last_name: last.toUpperCase(),
      first_name: capitalize(first),
      birth_date: parseDate(val('birth_date')),
      class_name: val('class_name') || defaultClass || '',
      level: val('level'),
      sex: val('sex').toUpperCase().slice(0, 1) || null,
      ine: val('ine') || null,
    });
  }
  return { students, errors, columns: Object.fromEntries(Object.entries(map).map(([k, i]) => [k, rows[headerIdx][i]])) };
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}
