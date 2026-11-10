/**
 * Import d'un catalogue existant (export Hibouthèque, BCDI, PMB, tableur…) au format CSV ou XML « plat ».
 * Les colonnes sont reconnues automatiquement d'après leur en-tête ; l'utilisateur peut corriger
 * l'association avant l'import. Une ligne = un exemplaire : les lignes du même livre (même ISBN,
 * ou même titre + auteur) sont regroupées en un seul document avec plusieurs exemplaires.
 */
import { parseCsv, parseDate } from './csv.js';
import { normalize, HttpError } from './util.js';
import { tx } from './db.js';
import { computeCote, DOC_TYPES } from './cote.js';
import { toIsbn13, cleanIsbn } from './isbn.js';
import { fixMojibake } from './text.js';

/** Champs importables, avec les en-têtes reconnus (normalisés, du plus précis au plus général). */
export const IMPORT_FIELDS = {
  title: { label: 'Titre', headers: ['titre propre', 'titre principal', 'titre du document', 'titre', 'title'] },
  subtitle: { label: 'Sous-titre', headers: ['sous titre', 'complement du titre', 'complement de titre', 'subtitle'] },
  authors: { label: 'Auteur(s)', headers: ['auteurs', 'auteur', 'auteur principal', 'auteur s', 'responsabilite', 'responsabilites', 'author', 'authors', 'nom auteur'] },
  illustrators: { label: 'Illustrateur(s)', headers: ['illustrateur', 'illustrateurs', 'illustrations', 'illustrateur s'] },
  publisher: { label: 'Éditeur', headers: ['editeur', 'editeurs', 'edition', 'maison d edition', 'publisher'] },
  pub_year: { label: 'Année', headers: ['annee', 'annee d edition', 'annee de parution', 'date de parution', 'date d edition', 'date de publication', 'parution', 'date edition', 'year'] },
  isbn: { label: 'ISBN / EAN', headers: ['isbn', 'isbn 13', 'isbn13', 'isbn 10', 'ean', 'ean13', 'code ean', 'isbn ean'] },
  barcode: { label: 'N° / code-barres de l\'exemplaire', headers: ['code barre', 'code barres', 'codebarre', 'code barre exemplaire', 'numero d exemplaire', 'n d exemplaire', 'n exemplaire', 'numero exemplaire', 'numero d inventaire', 'n d inventaire', 'n inventaire', 'inventaire', 'numero', 'n', 'no', 'id exemplaire', 'exemplaire'] },
  copies: { label: 'Nombre d\'exemplaires', headers: ['nombre d exemplaires', 'nb exemplaires', 'nombre exemplaires', 'nbre d exemplaires', 'exemplaires', 'quantite', 'qte'] },
  cote: { label: 'Cote', headers: ['cote', 'cotation', 'cote du document', 'call number'] },
  doc_type: { label: 'Type / genre', headers: ['type de document', 'type document', 'nature', 'nature du document', 'support', 'genre', 'type', 'categorie'] },
  series: { label: 'Collection / série', headers: ['collection', 'serie', 'titre de serie', 'titre de la collection', 'series'] },
  series_number: { label: 'N° dans la série', headers: ['numero dans la collection', 'n dans la collection', 'numero de serie', 'tome', 'n de collection', 'numero collection', 'volume'] },
  subjects: { label: 'Sujets', headers: ['sujets', 'sujet', 'descripteurs', 'descripteur', 'theme', 'themes', 'thematique', 'subjects'] },
  keywords: { label: 'Mots-clés', headers: ['mots cles', 'mot cle', 'mots clefs', 'mots cles libres', 'tags', 'keywords'] },
  summary: { label: 'Résumé', headers: ['resume', 'resumes', 'resume du document', 'description', 'note de contenu', 'summary'] },
  audience: { label: 'Public / niveau', headers: ['public', 'niveau', 'niveaux', 'public vise', 'age', 'tranche d age', 'cycle', 'lectorat'] },
  location: { label: 'Emplacement', headers: ['emplacement', 'localisation', 'rayon', 'lieu', 'section', 'etagere', 'bac'] },
  pages: { label: 'Nombre de pages', headers: ['pages', 'nombre de pages', 'nb pages', 'pagination', 'collation'] },
  dewey: { label: 'Indice Dewey', headers: ['dewey', 'indice dewey', 'indice', 'classification'] },
  state: { label: 'État de l\'exemplaire', headers: ['etat', 'etat de l exemplaire', 'etat exemplaire', 'statut'] },
  acquired_at: { label: 'Date d\'acquisition', headers: ['date d acquisition', 'date acquisition', 'acquis le', 'date d entree', 'date entree', 'date de creation', 'date d achat'] },
  notes: { label: 'Notes', headers: ['notes', 'note', 'remarques', 'remarque', 'observations', 'commentaire', 'commentaires'] },
  cover_url: { label: 'Image de couverture (adresse)', headers: ['couverture', 'image', 'vignette', 'url couverture', 'url image', 'cover'] },
};

const key = (h) => normalize(h).replace(/[^a-z0-9]+/g, ' ').trim();

// Champs qui peuvent occuper plusieurs colonnes (« Auteur 1 », « Auteur 2 »…) : les valeurs sont cumulées.
const MULTI = new Set(['authors', 'illustrators', 'subjects', 'keywords', 'notes']);

/**
 * Devine le champ de chaque colonne. Une correspondance exacte l'emporte toujours, puis l'en-tête
 * reconnu le plus long (« Titre de série » → collection, et non titre).
 */
export function guessMapping(headers) {
  const keys = headers.map(key);
  const scores = [];
  keys.forEach((k, i) => {
    for (const [field, def] of Object.entries(IMPORT_FIELDS)) {
      for (const cand of def.headers) {
        const s = k === cand ? 1000 + cand.length : k.startsWith(cand + ' ') ? cand.length : 0;
        if (s) scores.push({ i, field, s });
      }
    }
  });
  scores.sort((a, b) => b.s - a.s);
  const mapping = headers.map(() => '');
  const used = new Set();
  for (const { i, field } of scores) {
    if (mapping[i] || (used.has(field) && !MULTI.has(field))) continue;
    mapping[i] = field;
    used.add(field);
  }
  return mapping;
}

/** XML « plat » (une balise répétée par document, une sous-balise par champ) → tableau. */
function parseFlatXml(text) {
  const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const counts = {};
  for (const m of text.matchAll(/<([\w:-]+)[\s>]/g)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  // La balise « document » est la plus répétée qui contient elle-même des sous-balises.
  const candidates = Object.entries(counts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  for (const [tag] of candidates) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
    const records = [...text.matchAll(re)].map((m) => m[1]).filter((inner) => /<[\w:-]+[\s>]/.test(inner));
    if (records.length < 1) continue;
    const headers = [];
    const rows = records.map((inner) => {
      const row = {};
      for (const f of inner.matchAll(/<([\w:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
        if (!headers.includes(f[1])) headers.push(f[1]);
        row[f[1]] = row[f[1]] ? `${row[f[1]]} ; ${decode(f[2])}` : decode(f[2]);
      }
      return row;
    });
    if (headers.length >= 2) return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
  }
  throw new HttpError(400, 'Fichier XML non reconnu');
}

/** Lit le fichier : renvoie { headers, rows } (rows = tableaux de chaînes). */
export function readTable(text) {
  text = String(text ?? '').replace(/^﻿/, '');
  if (!text.trim()) throw new HttpError(400, 'Fichier vide');
  const table = /^\s*</.test(text) ? parseFlatXml(text) : parseCsv(text);
  // En-tête = première ligne (parmi les 10 premières) dont au moins 2 colonnes sont reconnues, sinon la première.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    if (guessMapping(table[i]).filter(Boolean).length >= 2) { headerIdx = i; break; }
  }
  const headers = table[headerIdx].map((h, i) => h || `Colonne ${i + 1}`);
  const rows = table.slice(headerIdx + 1).filter((r) => r.some((v) => v && v.trim()));
  return { headers, rows };
}

const TYPE_WORDS = [
  [/premi[eè]res? lectures?/, 'premiere_lecture'], [/album/, 'album'], [/bande|bd\b|comic/, 'bd'], [/manga/, 'manga'],
  [/roman/, 'roman'], [/conte/, 'conte'], [/po[eé]s|comptine/, 'poesie'], [/th[eé][aâ]tre/, 'theatre'],
  [/documentaire|doc\b|sciences?/, 'documentaire'], [/dictionnaire|encyclop/, 'reference'],
  [/p[eé]riodique|revue|magazine|journal/, 'periodique'], [/multim[eé]dia|\bcd\b|audio|disque|\bdvd\b|vid[eé]o|film/, 'multimedia'],
  [/jeu/, 'jeu'],
];

export function guessDocType(value) {
  const v = normalize(value);
  if (!v) return null;
  if (DOC_TYPES[v]) return v;
  for (const [re, t] of TYPE_WORDS) if (re.test(v)) return t;
  return null;
}

function guessState(value) {
  const v = normalize(value);
  if (/perdu|manquant|disparu/.test(v)) return 'perdu';
  if (/repar/.test(v)) return 'reparation';
  if (/abim|use|mauvais|dechir/.test(v)) return 'abime';
  return 'ok';
}

/** « Prénom Nom ; Prénom2 Nom2 » ou « NOM Prénom » → format de l'appli « Nom, Prénom ; … ». */
export function normalizeAuthors(value) {
  return String(value ?? '').split(/\s*[;/|]\s*|\s+et\s+|\s*&\s*/).map((a) => a.trim()).filter(Boolean).map((a) => {
    if (a.includes(',')) return a.replace(/\s*,\s*/, ', ');
    const words = a.split(/\s+/);
    if (words.length < 2) return a;
    // « DUPONT Marie » : le nom en majuscules est en premier.
    const upper = words.findIndex((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w));
    if (upper === 0) {
      const n = words.filter((w) => w === w.toUpperCase()).length;
      return `${words.slice(0, n).join(' ')}, ${words.slice(n).join(' ')}`.replace(/, $/, '');
    }
    if (upper > 0) return `${words.slice(upper).join(' ')}, ${words.slice(0, upper).join(' ')}`;
    return `${words[words.length - 1]}, ${words.slice(0, -1).join(' ')}`;
  }).join(' ; ');
}

/** Convertit les lignes en documents regroupés, avec leurs exemplaires. */
export function buildDocuments({ headers, rows }, mapping, { default_type = 'album' } = {}) {
  const docs = new Map();
  const errors = [];
  rows.forEach((row, n) => {
    const val = (field) => {
      const parts = [];
      mapping.forEach((f, i) => { if (f === field && row[i] && row[i].trim()) parts.push(fixMojibake(row[i].trim())); });
      return parts.join(' ; ');
    };
    const title = val('title');
    if (!title) { errors.push(`Ligne ${n + 2} : pas de titre, ignorée`); return; }
    const rawIsbn = val('isbn');
    const isbn = rawIsbn ? (toIsbn13(rawIsbn.split(/[;,\s]+/)[0]) ?? (cleanIsbn(rawIsbn) || null)) : null;
    let authors = normalizeAuthors(val('authors'));
    const ill = normalizeAuthors(val('illustrators'));
    if (ill) authors = [authors, ill].filter(Boolean).join(' ; ');
    const groupKey = isbn || `${normalize(title)}|${normalize(authors)}|${normalize(val('publisher'))}`;

    if (!docs.has(groupKey)) {
      const year = (val('pub_year').match(/\d{4}/) ?? [])[0];
      const pages = (val('pages').match(/\d+/) ?? [])[0];
      const typeValue = val('doc_type');
      const type = guessDocType(typeValue) ?? default_type;
      const doc = {
        title, subtitle: val('subtitle') || null, authors: authors || null, publisher: val('publisher') || null,
        pub_year: year ? Number(year) : null, pages: pages ? Number(pages) : null, isbn,
        series: val('series') || null, series_number: val('series_number') || null,
        doc_type: type, dewey: (val('dewey').match(/\d{3}(\.\d+)?/) ?? [])[0] ?? null,
        subjects: val('subjects') || null,
        // Un genre qui n'est pas un type connu (« Animaux », « Humour »…) devient un mot-clé.
        keywords: [val('keywords'), typeValue && !guessDocType(typeValue) ? typeValue : ''].filter(Boolean).join(' ; ') || null,
        summary: val('summary') || null, audience: val('audience') || null, location: val('location') || null,
        notes: val('notes') || null, cover_url: /^https?:\/\//.test(val('cover_url')) ? val('cover_url') : null,
        cote: val('cote') || null, source: 'import', copies: [],
      };
      docs.set(groupKey, doc);
    }
    const doc = docs.get(groupKey);
    const count = Math.max(1, Math.min(Number((val('copies').match(/\d+/) ?? [])[0]) || 1, 50));
    let barcode = val('barcode').split(/\s*;\s*/)[0] || null;
    // « 000012 » → « 12 » : c'est ce qu'on tape au comptoir.
    if (barcode && /^\d{1,15}$/.test(barcode)) barcode = String(Number(barcode));
    const state = guessState(val('state'));
    const acquired = parseDate(val('acquired_at'));
    for (let i = 0; i < count; i++) doc.copies.push({ barcode: i === 0 ? barcode : null, state, acquired_at: acquired });
  });
  return { documents: [...docs.values()], errors };
}

/**
 * Importe (ou simule) : renvoie un compte rendu. Les livres déjà au catalogue (même ISBN, ou même titre + auteur)
 * sont ignorés pour pouvoir relancer l'import sans doublons.
 */
export function importCatalog(db, { text, mapping, keep_numbers = true, default_type = 'album', dry_run = false }) {
  const table = readTable(text);
  if (!Array.isArray(mapping) || mapping.length !== table.headers.length) mapping = guessMapping(table.headers);
  if (!mapping.includes('title')) throw new HttpError(400, 'Indiquez quelle colonne contient le titre');
  const { documents, errors } = buildDocuments(table, mapping, { default_type });
  const report = {
    rows: table.rows.length, documents: 0, copies: 0, skipped: [], renumbered: 0, errors,
    sample: documents.slice(0, 8).map((d) => ({ title: d.title, authors: d.authors, isbn: d.isbn, cote: d.cote ?? computeCote(d), doc_type: d.doc_type, copies: d.copies.length })),
  };

  const existsByIsbn = db.prepare('SELECT id FROM documents WHERE isbn = ?');
  const existsByTitle = db.prepare(`SELECT id FROM documents WHERE norm(title) = ? AND norm(coalesce(authors, '')) = ?`);
  const takenNumbers = new Set(db.prepare('SELECT barcode FROM copies').all().map((c) => c.barcode.toLowerCase()));
  let next = (db.prepare(`SELECT MAX(CAST(barcode AS INTEGER)) AS m FROM copies WHERE barcode GLOB '[0-9]*'`).get().m ?? 0);

  const insertDoc = db.prepare(`INSERT INTO documents (title, subtitle, authors, publisher, pub_year, pages, isbn, series, series_number,
    doc_type, dewey, subjects, keywords, summary, audience, location, notes, cover_url, cote, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertCopy = db.prepare(`INSERT INTO copies (document_id, barcode, state, acquired_at) VALUES (?, ?, ?, coalesce(?, date('now', 'localtime')))`);

  // Les numéros d'origine sont gardés s'ils sont libres ; les nouveaux numéros continuent après le plus grand.
  if (keep_numbers) {
    for (const d of documents) for (const c of d.copies) {
      const n = Number(c.barcode);
      if (c.barcode && Number.isInteger(n) && n > next && !takenNumbers.has(c.barcode.toLowerCase())) next = Math.max(next, n);
    }
  }

  const run = () => {
    for (const d of documents) {
      const dup = (d.isbn && existsByIsbn.get(d.isbn)) || existsByTitle.get(normalize(d.title), normalize(d.authors ?? ''));
      if (dup) { report.skipped.push(d.title); continue; }
      d.cote ||= computeCote(d);
      report.documents++;
      if (dry_run) {
        report.copies += d.copies.length;
        continue;
      }
      const id = Number(insertDoc.run(d.title, d.subtitle, d.authors, d.publisher, d.pub_year, d.pages, d.isbn, d.series, d.series_number,
        d.doc_type, d.dewey, d.subjects, d.keywords, d.summary, d.audience, d.location, d.notes, d.cover_url, d.cote, d.source).lastInsertRowid);
      for (const c of d.copies) {
        let number = keep_numbers && c.barcode && !takenNumbers.has(c.barcode.toLowerCase()) ? c.barcode : null;
        if (!number) {
          number = String(++next);
          if (keep_numbers && c.barcode) report.renumbered++;
        }
        takenNumbers.add(number.toLowerCase());
        insertCopy.run(id, number, c.state, c.acquired_at);
        report.copies++;
      }
    }
  };
  if (dry_run) run();
  else tx(db, run);
  return report;
}
