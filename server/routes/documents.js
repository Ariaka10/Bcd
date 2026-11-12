import { HttpError, normalize } from '../util.js';
import { tx } from '../db.js';
import { staff, admin, anyUser, catalog } from '../guards.js';
import { computeCote, DOC_TYPES } from '../cote.js';
import { toIsbn13, cleanIsbn } from '../isbn.js';
import { lookupIsbn as defaultLookup } from '../notice.js';
import { toCsv } from '../csv.js';
import { fixFields } from '../text.js';
import { getSettings } from '../db.js';
import { readTable, guessMapping, importCatalog, IMPORT_FIELDS } from '../catalog-import.js';
import { storeCover, imageInfo } from '../covers.js';

const DOC_FIELDS = [
  'isbn', 'title', 'subtitle', 'authors', 'publisher', 'pub_year', 'pages', 'series', 'series_number',
  'doc_type', 'dewey', 'subjects', 'summary', 'audience', 'cover_url', 'cote', 'location', 'notes',
  'source', 'source_url', 'keywords', 'periodicity', 'subscription_end',
];
const TEXT_FIELDS = ['title', 'subtitle', 'authors', 'publisher', 'series', 'subjects', 'summary', 'keywords', 'audience'];
const COPY_STATES = ['ok', 'abime', 'perdu', 'reparation'];

const AVAILABLE_SQL = `(SELECT COUNT(*) FROM copies c WHERE c.document_id = d.id AND c.state IN ('ok', 'abime')
  AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.returned_at IS NULL))`;
const COPIES_SQL = `(SELECT COUNT(*) FROM copies c WHERE c.document_id = d.id)`;

function likeTerm(s) {
  return '%' + normalize(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

/** Construit la clause WHERE de la recherche simple + avancée. */
export function buildSearch(q) {
  const where = [];
  const args = [];
  const like = (expr, v) => { where.push(`norm(${expr}) LIKE ? ESCAPE '\\'`); args.push(likeTerm(v)); };

  if (q.q) {
    const all = `coalesce(d.title,'')||' '||coalesce(d.subtitle,'')||' '||coalesce(d.authors,'')||' '||coalesce(d.series,'')
      ||' '||coalesce(d.subjects,'')||' '||coalesce(d.publisher,'')||' '||coalesce(d.cote,'')||' '||coalesce(d.isbn,'')
      ||' '||coalesce(d.keywords,'')`;
    for (const term of normalize(q.q).split(' ').filter(Boolean)) {
      const isbn = toIsbn13(term);
      if (isbn) { where.push('d.isbn = ?'); args.push(isbn); }
      else if (/^\d{1,7}$/.test(term)) {
        // Un nombre : numéro d'exemplaire (« 12 ») ou texte (cote Dewey, titre…), sans fouiller dans les ISBN.
        const noIsbn = all.replace("||' '||coalesce(d.isbn,'')", '');
        where.push(`(d.id IN (SELECT document_id FROM copies WHERE barcode = ?) OR norm(${noIsbn}) LIKE ? ESCAPE '\\')`);
        args.push(term, likeTerm(term));
      } else like(all, term);
    }
  }
  if (q.title) like(`coalesce(d.title,'')||' '||coalesce(d.subtitle,'')`, q.title);
  if (q.author) like('d.authors', q.author);
  if (q.subject) like('d.subjects', q.subject);
  if (q.keyword) like(`coalesce(d.keywords,'')||' '||coalesce(d.subjects,'')`, q.keyword);
  if (q.theme_id) {
    where.push('d.id IN (SELECT document_id FROM document_themes WHERE theme_id = ?)');
    args.push(Number(q.theme_id));
  }
  if (q.no_theme === '1') where.push('NOT EXISTS (SELECT 1 FROM document_themes x WHERE x.document_id = d.id)');
  if (q.copy) {
    where.push('d.id IN (SELECT document_id FROM copies WHERE barcode = ? COLLATE NOCASE)');
    args.push(String(q.copy).trim());
  }
  if (q.state) {
    where.push('d.id IN (SELECT document_id FROM copies WHERE state = ?)');
    args.push(String(q.state));
  }
  // Élèves : seulement les livres des thèmes « visibles par les élèves », si l'option est active.
  if (q.students_only) {
    where.push(`d.id IN (SELECT dt.document_id FROM document_themes dt JOIN themes t ON t.id = dt.theme_id WHERE t.for_students = 1)`);
  }
  if (q.publisher) like('d.publisher', q.publisher);
  if (q.series) like('d.series', q.series);
  if (q.summary) like('d.summary', q.summary);
  if (q.location) like('d.location', q.location);
  if (q.audience) like('d.audience', q.audience);
  if (q.cote) { where.push(`upper(d.cote) LIKE ?`); args.push(String(q.cote).toUpperCase().trim() + '%'); }
  if (q.isbn) { where.push('d.isbn LIKE ?'); args.push('%' + cleanIsbn(q.isbn) + '%'); }
  if (q.dewey) { where.push('(d.dewey LIKE ? OR d.cote LIKE ?)'); args.push(q.dewey + '%', q.dewey + '%'); }
  if (q.doc_type) {
    const types = String(q.doc_type).split(',').filter((t) => DOC_TYPES[t]);
    if (types.length) { where.push(`d.doc_type IN (${types.map(() => '?').join(',')})`); args.push(...types); }
  }
  if (q.year_from) { where.push('d.pub_year >= ?'); args.push(Number(q.year_from)); }
  if (q.year_to) { where.push('d.pub_year <= ?'); args.push(Number(q.year_to)); }
  if (q.added_from) { where.push('date(d.created_at) >= ?'); args.push(q.added_from); }
  if (q.available === '1') where.push(`${AVAILABLE_SQL} > 0`);
  if (q.ids) {
    const ids = String(q.ids).split(',').map(Number).filter(Number.isInteger).slice(0, 5000);
    where.push(`d.id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
    args.push(...ids);
  }
  if (q.list_id) { where.push('d.id IN (SELECT document_id FROM list_items WHERE list_id = ?)'); args.push(Number(q.list_id)); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

const SORTS = {
  title: 'norm(d.title)',
  number: '(SELECT MIN(CAST(c.barcode AS INTEGER)) FROM copies c WHERE c.document_id = d.id), d.id',
  author: 'norm(d.authors), norm(d.title)',
  cote: 'd.cote, norm(d.title)',
  year: 'd.pub_year DESC, norm(d.title)',
  recent: 'd.created_at DESC, d.id DESC',
};

export function searchDocuments(db, q) {
  const { sql, args } = buildSearch(q);
  const limit = Math.min(Math.max(Number(q.limit) || 24, 1), 5000);
  const page = Math.max(Number(q.page) || 1, 1);
  const order = SORTS[q.sort] ?? (q.q ? SORTS.title : SORTS.recent);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM documents d ${sql}`).get(...args).n;
  const items = db.prepare(`
    SELECT d.id, d.isbn, d.title, d.subtitle, d.authors, d.publisher, d.pub_year, d.series, d.series_number,
      d.doc_type, d.dewey, d.subjects, d.cote, d.cover_url, d.audience, d.location, d.created_at, d.keywords,
      ${COPIES_SQL} AS copies_count, ${AVAILABLE_SQL} AS available_count,
      (SELECT group_concat(barcode, ', ') FROM (SELECT barcode FROM copies c WHERE c.document_id = d.id
        ORDER BY CAST(barcode AS INTEGER), barcode)) AS numbers,
      (SELECT group_concat(state) FROM copies c WHERE c.document_id = d.id) AS states,
      (SELECT group_concat(theme_id) FROM document_themes x WHERE x.document_id = d.id) AS theme_ids,
      (SELECT COUNT(*) FROM reviews r WHERE r.document_id = d.id AND r.rating = 3) AS loves
    FROM documents d ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit);
  return { total, page, limit, items };
}

function sanitizeDoc(body, existing = {}) {
  const d = { ...existing };
  for (const f of DOC_FIELDS) if (f in body) d[f] = body[f] === '' ? null : body[f];
  d.title = String(d.title ?? '').trim();
  if (!d.title) throw new HttpError(400, 'Le titre est obligatoire');
  if (!DOC_TYPES[d.doc_type]) d.doc_type = 'autre';
  if (d.isbn) d.isbn = toIsbn13(d.isbn) ?? cleanIsbn(d.isbn);
  for (const f of ['pub_year', 'pages']) d[f] = d[f] == null || d[f] === '' ? null : Number(d[f]) || null;
  for (const f of DOC_FIELDS) if (typeof d[f] === 'string') d[f] = d[f].trim() || null;
  fixFields(d, TEXT_FIELDS);
  if (d.keywords) d.keywords = splitKeywords(d.keywords).join(' ; ') || null;
  if (!d.cote) d.cote = computeCote(d);
  return d;
}

export function splitKeywords(s) {
  const seen = new Set();
  return String(s ?? '').split(/[;,]/).map((k) => k.trim()).filter((k) => {
    const n = normalize(k);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

/** Prochain numéro d'exemplaire libre : 1, 2, 3… dans l'ordre d'enregistrement. */
export function nextBarcode(db) {
  const max = db.prepare(`SELECT MAX(CAST(barcode AS INTEGER)) AS m FROM copies WHERE barcode GLOB '[0-9]*'`).get().m;
  return String((max ?? 0) + 1);
}

/** Remplace les thèmes d'un document. */
function setThemes(db, docId, themeIds) {
  if (!Array.isArray(themeIds)) return;
  db.prepare('DELETE FROM document_themes WHERE document_id = ?').run(docId);
  const ins = db.prepare('INSERT OR IGNORE INTO document_themes (document_id, theme_id) SELECT ?, id FROM themes WHERE id = ?');
  for (const t of themeIds) ins.run(docId, Number(t));
}

function addCopies(db, docId, { count = 1, barcodes = [], issue_label = null, issue_date = null } = {}) {
  const insert = db.prepare('INSERT INTO copies (document_id, barcode, issue_label, issue_date) VALUES (?, ?, ?, ?)');
  const ins = { run: (doc, barcode) => insert.run(doc, barcode, issue_label || null, issue_date || null) };
  const created = [];
  const list = barcodes.map((b) => String(b).trim()).filter(Boolean);
  for (const b of list) {
    if (db.prepare('SELECT 1 FROM copies WHERE barcode = ?').get(b)) throw new HttpError(409, `Numéro déjà utilisé : ${b}`);
    ins.run(docId, b); created.push(b);
  }
  for (let i = list.length; i < Math.min(Number(count) || 0, 50); i++) {
    const b = nextBarcode(db);
    ins.run(docId, b); created.push(b);
  }
  return created;
}

export function getDocument(db, id, user) {
  const d = db.prepare(`SELECT d.*, ${AVAILABLE_SQL} AS available_count, ${COPIES_SQL} AS copies_count,
      cv.origin AS cover_origin, cv.updated_at AS cover_date
    FROM documents d LEFT JOIN covers cv ON cv.document_id = d.id WHERE d.id = ?`).get(id);
  if (!d) throw new HttpError(404, 'Document introuvable');
  // Emprunteurs et réservations : réservés aux enseignant·es et à l'administrateur.
  const isStaff = user && ['admin', 'enseignant'].includes(user.role);
  d.copies = db.prepare(`
    SELECT c.id, c.barcode, c.state, c.acquired_at, c.notes, c.issue_label, c.issue_date,
      l.id AS loan_id, l.due_at, l.loaned_at, l.user_id, l.class_id AS loan_class_id,
      coalesce(u.first_name || ' ' || u.last_name, '📦 Classe ' || lc.name) AS borrower,
      coalesce(cl.name, lc.name) AS borrower_class,
      (SELECT u2.first_name || ' ' || u2.last_name FROM reservations rv JOIN users u2 ON u2.id = rv.user_id
        WHERE rv.document_id = c.document_id AND rv.status = 'prete' ORDER BY rv.ready_at LIMIT 1) AS held_for
    FROM copies c
    LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_at IS NULL
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN classes cl ON cl.id = u.class_id
    LEFT JOIN classes lc ON lc.id = l.class_id
    WHERE c.document_id = ?
    ORDER BY c.issue_date DESC, CASE WHEN c.issue_label IS NULL THEN CAST(c.barcode AS INTEGER) ELSE -c.id END, c.barcode`).all(id);
  if (!isStaff) {
    for (const c of d.copies) for (const k of ['borrower', 'borrower_class', 'user_id', 'loan_id', 'loan_class_id', 'held_for']) delete c[k];
  }
  d.themes = db.prepare(`SELECT t.id, t.name, t.emoji, t.color, t.for_students FROM themes t
    JOIN document_themes x ON x.theme_id = t.id WHERE x.document_id = ? ORDER BY t.position, t.name`).all(id);
  if (!isStaff) d.themes = d.themes.filter((t) => t.for_students);
  d.reviews = Object.fromEntries([1, 2, 3].map((n) => [n, 0]));
  for (const r of db.prepare('SELECT rating, COUNT(*) AS n FROM reviews WHERE document_id = ? GROUP BY rating').all(id)) d.reviews[r.rating] = r.n;
  d.my_review = user ? db.prepare('SELECT rating FROM reviews WHERE document_id = ? AND user_id = ?').get(id, user.id)?.rating ?? null : null;
  d.reservations = db.prepare(`SELECT rv.id, rv.user_id, rv.status, rv.created_at, u.first_name, u.last_name, u.avatar, c.name AS class_name
    FROM reservations rv JOIN users u ON u.id = rv.user_id LEFT JOIN classes c ON c.id = u.class_id
    WHERE rv.document_id = ? AND rv.status IN ('attente', 'prete') ORDER BY rv.created_at`).all(id);
  if (!isStaff) {
    d.reservations = d.reservations.filter((r) => r.user_id === user?.id);
    d.on_loan_to_me = Boolean(db.prepare(`SELECT 1 FROM loans WHERE document_id = ? AND user_id = ? AND returned_at IS NULL`).get(id, user?.id));
  }
  d.loan_count = db.prepare('SELECT COUNT(*) AS n FROM loans WHERE document_id = ?').get(id).n;
  d.lists = isStaff ? db.prepare(`SELECT l.id, l.name FROM lists l JOIN list_items i ON i.list_id = l.id
    WHERE i.document_id = ? ORDER BY l.name`).all(id) : [];
  return d;
}

/** Supprime des documents (désherbage). Ceux qui ont un exemplaire en prêt sont ignorés. */
export function deleteDocuments(db, ids) {
  const deleted = [];
  const skipped = [];
  tx(db, () => {
    for (const id of ids.map(Number)) {
      const d = db.prepare('SELECT id, title FROM documents WHERE id = ?').get(id);
      if (!d) continue;
      const onLoan = db.prepare(`SELECT COUNT(*) AS n FROM loans l JOIN copies c ON c.id = l.copy_id
        WHERE c.document_id = ? AND l.returned_at IS NULL`).get(id).n;
      if (onLoan) { skipped.push({ id, title: d.title, reason: 'exemplaire en prêt' }); continue; }
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      deleted.push(id);
    }
  });
  return { deleted: deleted.length, deleted_ids: deleted, skipped };
}

export default function (r, deps) {
  const lookup = deps.lookupIsbn ?? defaultLookup;

  r.get('/api/meta', () => ({ doc_types: DOC_TYPES, copy_states: COPY_STATES }));

  /* ----- Couverture ajoutée à la main (photo ou image du PC) ----- */

  r.get('/api/documents/:id/cover', anyUser, ({ db, params, res }) => {
    const c = db.prepare('SELECT mime, data FROM covers WHERE document_id = ?').get(params.id);
    if (!c) throw new HttpError(404, 'Pas de couverture');
    res.writeHead(200, { 'Content-Type': c.mime, 'Content-Length': c.data.length, 'Cache-Control': 'private, max-age=31536000' });
    res.end(Buffer.from(c.data));
  });

  r.put('/api/documents/:id/cover', catalog, ({ db, params, raw }) => {
    if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(params.id)) throw new HttpError(404, 'Document introuvable');
    if (!raw?.length) throw new HttpError(400, 'Image manquante');
    if (raw.length > 3 * 1024 * 1024) throw new HttpError(413, 'Image trop lourde (3 Mo maximum)');
    const mime = imageInfo(raw)?.mime;
    if (!mime) throw new HttpError(400, 'Format d\'image non reconnu (JPEG, PNG, GIF ou WebP)');
    const id = Number(params.id);
    storeCover(db, id, { mime, data: raw, source: 'manuel' });
    return { ok: true, cover_url: db.prepare('SELECT cover_url FROM documents WHERE id = ?').get(id).cover_url };
  });

  r.delete('/api/documents/:id/cover', catalog, ({ db, params }) => {
    tx(db, () => {
      db.prepare('DELETE FROM covers WHERE document_id = ?').run(params.id);
      // Couverture retirée volontairement : la recherche automatique ne la remet pas.
      db.prepare(`UPDATE documents SET cover_url = NULL, cover_tried_at = datetime('now') WHERE id = ?`).run(params.id);
    });
    return { ok: true };
  });

  /* ----- Import d'un catalogue existant (Hibouthèque, BCDI, PMB, tableur…) ----- */

  r.post('/api/catalog-import/analyze', admin, ({ body }) => {
    const table = readTable(body.text);
    return {
      headers: table.headers,
      mapping: guessMapping(table.headers),
      rows: table.rows.length,
      sample: table.rows.slice(0, 5),
      fields: Object.fromEntries(Object.entries(IMPORT_FIELDS).map(([k, f]) => [k, f.label])),
    };
  });

  r.post('/api/catalog-import', admin, ({ db, body }) => importCatalog(db, body));

  const restrictForStudent = (db, user) => user.role === 'eleve' && getSettings(db).restrict_student_catalog === '1';

  r.get('/api/documents', anyUser, ({ db, query, user }) => {
    const q = { ...query };
    delete q.students_only;
    if (restrictForStudent(db, user)) q.students_only = true;
    return searchDocuments(db, q);
  });

  // Coups de cœur : livres les plus « adorés » par les élèves.
  r.get('/api/coups-de-coeur', anyUser, ({ db, user }) => {
    const restrict = restrictForStudent(db, user);
    return db.prepare(`SELECT d.id, d.title, d.authors, d.cover_url, d.cote, COUNT(*) AS loves, ${AVAILABLE_SQL} AS available_count
      FROM reviews r JOIN documents d ON d.id = r.document_id
      WHERE r.rating = 3 ${restrict ? `AND d.id IN (SELECT dt.document_id FROM document_themes dt JOIN themes t ON t.id = dt.theme_id WHERE t.for_students = 1)` : ''}
      GROUP BY d.id ORDER BY loves DESC, d.title LIMIT 12`).all();
  });

  r.post('/api/documents/:id/review', anyUser, ({ db, params, body, user }) => {
    if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(params.id)) throw new HttpError(404, 'Document introuvable');
    const rating = Number(body.rating);
    if (!rating) {
      db.prepare('DELETE FROM reviews WHERE user_id = ? AND document_id = ?').run(user.id, params.id);
      return { ok: true };
    }
    if (![1, 2, 3].includes(rating)) throw new HttpError(400, 'Avis invalide');
    db.prepare(`INSERT INTO reviews (user_id, document_id, rating) VALUES (?, ?, ?)
      ON CONFLICT(user_id, document_id) DO UPDATE SET rating = excluded.rating, created_at = datetime('now')`).run(user.id, params.id, rating);
    return { ok: true };
  });

  r.get('/api/documents/export.csv', catalog, ({ db, query, res }) => {
    const { items } = searchDocuments(db, { ...query, limit: 5000 });
    const themes = new Map(db.prepare('SELECT id, name FROM themes').all().map((t) => [String(t.id), t.name]));
    const rows = [['N° exemplaires', 'Cote', 'Titre', 'Auteurs', 'Éditeur', 'Année', 'Collection', 'Type', 'Thèmes', 'Mots-clés',
      'ISBN', 'Sujets', 'Exemplaires', 'Disponibles']];
    for (const d of items) {
      const th = String(d.theme_ids ?? '').split(',').filter(Boolean).map((t) => themes.get(t)).join(', ');
      rows.push([d.numbers, d.cote, d.title, d.authors, d.publisher, d.pub_year, d.series, DOC_TYPES[d.doc_type]?.label, th,
        d.keywords, d.isbn, d.subjects, d.copies_count, d.available_count]);
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="inventaire.csv"' });
    res.end(toCsv(rows));
  });

  r.get('/api/documents/:id', anyUser, ({ db, params, user }) => {
    if (restrictForStudent(db, user) && !searchDocuments(db, { ids: params.id, students_only: true }).total) {
      throw new HttpError(404, 'Document introuvable');
    }
    return getDocument(db, Number(params.id), user);
  });

  r.post('/api/documents', catalog, ({ db, body }) => tx(db, () => {
    const d = sanitizeDoc(body);
    const cols = DOC_FIELDS;
    const { lastInsertRowid } = db.prepare(`INSERT INTO documents (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => d[c] ?? null));
    const id = Number(lastInsertRowid);
    setThemes(db, id, body.theme_ids);
    const barcodes = addCopies(db, id, { count: body.copies ?? 1, barcodes: body.barcodes ?? [] });
    // La couverture est cherchée juste après, sans faire attendre l'enregistrement.
    if (deps.autoCovers) setImmediate(() => deps.covers.queue(id));
    return { id, cote: d.cote, barcodes };
  }));

  r.put('/api/documents/:id', catalog, ({ db, params, body }) => {
    const existing = db.prepare('SELECT * FROM documents WHERE id = ?').get(params.id);
    if (!existing) throw new HttpError(404, 'Document introuvable');
    const d = sanitizeDoc(body, existing);
    tx(db, () => {
      db.prepare(`UPDATE documents SET ${DOC_FIELDS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...DOC_FIELDS.map((c) => d[c] ?? null), existing.id);
      setThemes(db, existing.id, body.theme_ids);
    });
    // ISBN ajouté ou nouvelle adresse d'image : on retente la couverture.
    const changed = (d.isbn ?? null) !== (existing.isbn ?? null)
      || (/^https?:/.test(d.cover_url ?? '') && d.cover_url !== existing.cover_url);
    if (changed) db.prepare('UPDATE documents SET cover_tried_at = NULL WHERE id = ?').run(existing.id);
    if (deps.autoCovers && (changed || existing.cover_tried_at == null)) setImmediate(() => deps.covers.queue(existing.id));
    return { id: existing.id, cote: d.cote };
  });

  r.delete('/api/documents/:id', admin, ({ db, params }) => {
    const r2 = deleteDocuments(db, [params.id]);
    if (r2.skipped.length) throw new HttpError(409, 'Impossible : un exemplaire est en prêt');
    return r2;
  });

  r.post('/api/documents/batch-delete', admin, ({ db, body }) => {
    if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError(400, 'Aucun document sélectionné');
    return deleteDocuments(db, body.ids);
  });

  r.post('/api/documents/recompute-cotes', admin, ({ db, body }) => tx(db, () => {
    const ids = Array.isArray(body.ids) && body.ids.length ? body.ids.map(Number)
      : db.prepare('SELECT id FROM documents').all().map((x) => x.id);
    const upd = db.prepare('UPDATE documents SET cote = ? WHERE id = ?');
    let n = 0;
    for (const id of ids) {
      const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
      if (!d) continue;
      upd.run(computeCote(d), id); n++;
    }
    return { updated: n };
  }));

  r.post('/api/cote', catalog, ({ body }) => ({ cote: computeCote(body) }));

  r.get('/api/isbn/:isbn', catalog, async ({ db, params }) => {
    const isbn = toIsbn13(params.isbn);
    const local = isbn ? db.prepare('SELECT id, title, cote FROM documents WHERE isbn = ?').get(isbn) : null;
    const result = await lookup(params.isbn);
    if (result.notice) {
      result.notice.doc_type = guessType(result.notice);
      result.notice.cote = computeCote(result.notice);
    }
    return { ...result, local: local ?? null };
  });

  // Exemplaires
  r.post('/api/documents/:id/copies', catalog, ({ db, params, body }) => tx(db, () => {
    if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(params.id)) throw new HttpError(404, 'Document introuvable');
    const issue = { issue_label: String(body.issue_label ?? '').trim() || null, issue_date: /^\d{4}-\d{2}(-\d{2})?$/.test(body.issue_date ?? '') ? body.issue_date : null };
    return { barcodes: addCopies(db, Number(params.id), { count: body.count ?? (body.barcode ? 0 : 1), barcodes: body.barcode ? [body.barcode] : [], ...issue }) };
  }));

  r.get('/api/copies/by-barcode/:code', staff, ({ db, params }) => {
    const code = String(params.code).trim();
    let c = db.prepare('SELECT id, document_id FROM copies WHERE barcode = ? COLLATE NOCASE').get(code);
    if (!c) {
      // Lecture de l'ISBN au lieu du code-barres de l'exemplaire.
      const isbn = toIsbn13(code);
      const doc = isbn && db.prepare('SELECT id FROM documents WHERE isbn = ?').get(isbn);
      if (doc) return { document: getDocument(db, doc.id, { role: 'admin' }), by_isbn: true };
      throw new HttpError(404, `Aucun exemplaire « ${code} »`);
    }
    return { copy_id: c.id, document: getDocument(db, c.document_id, { role: 'admin' }) };
  });

  r.put('/api/copies/:id', catalog, ({ db, params, body }) => {
    const c = db.prepare('SELECT * FROM copies WHERE id = ?').get(params.id);
    if (!c) throw new HttpError(404, 'Exemplaire introuvable');
    const state = body.state ?? c.state;
    if (!COPY_STATES.includes(state)) throw new HttpError(400, 'État inconnu');
    const barcode = String(body.barcode ?? c.barcode).trim();
    if (!barcode) throw new HttpError(400, 'Numéro requis');
    db.prepare('UPDATE copies SET state = ?, barcode = ?, notes = ?, issue_label = ?, issue_date = ? WHERE id = ?')
      .run(state, barcode, body.notes ?? c.notes, 'issue_label' in body ? (String(body.issue_label ?? '').trim() || null) : c.issue_label,
        'issue_date' in body ? (body.issue_date || null) : c.issue_date, c.id);
    return { ok: true };
  });

  // Périodiques : retirer d'un coup les anciens numéros (parus avant une date), sauf ceux en prêt.
  r.post('/api/documents/:id/issues/purge', admin, ({ db, params, body }) => {
    if (!/^\d{4}-\d{2}$/.test(body.before ?? '')) throw new HttpError(400, 'Date invalide');
    const r2 = db.prepare(`DELETE FROM copies WHERE document_id = ? AND issue_date IS NOT NULL AND issue_date < ?
      AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = copies.id AND l.returned_at IS NULL)`).run(params.id, body.before);
    return { deleted: Number(r2.changes) };
  });

  r.delete('/api/copies/:id', admin, ({ db, params }) => {
    if (db.prepare('SELECT 1 FROM loans WHERE copy_id = ? AND returned_at IS NULL').get(params.id)) {
      throw new HttpError(409, 'Exemplaire en prêt');
    }
    db.prepare('DELETE FROM copies WHERE id = ?').run(params.id);
    return { ok: true };
  });

  // Désherbage : repérer les documents anciens, abîmés ou qui ne sortent plus.
  r.get('/api/weeding', admin, ({ db, query }) => {
    const where = [];
    const args = [];
    if (query.year_before) { where.push('d.pub_year IS NOT NULL AND d.pub_year < ?'); args.push(Number(query.year_before)); }
    if (query.no_loan_years) {
      const since = `-${Number(query.no_loan_years)} years`;
      where.push(`date(d.created_at) <= date('now', ?) AND NOT EXISTS
        (SELECT 1 FROM loans l WHERE l.document_id = d.id AND l.loaned_at >= date('now', ?))`);
      args.push(since, since);
    }
    if (query.state) {
      where.push(`EXISTS (SELECT 1 FROM copies c WHERE c.document_id = d.id AND c.state = ?)`);
      args.push(query.state);
    }
    if (query.doc_type) { where.push('d.doc_type = ?'); args.push(query.doc_type); }
    if (!where.length) return { items: [] };
    return {
      items: db.prepare(`
        SELECT d.id, d.title, d.authors, d.cote, d.pub_year, d.doc_type, d.created_at,
          ${COPIES_SQL} AS copies_count,
          (SELECT COUNT(*) FROM loans l WHERE l.document_id = d.id) AS loan_count,
          (SELECT MAX(l.loaned_at) FROM loans l WHERE l.document_id = d.id) AS last_loan,
          (SELECT group_concat(DISTINCT c.state) FROM copies c WHERE c.document_id = d.id) AS states
        FROM documents d WHERE ${where.join(' AND ')}
        ORDER BY d.cote, d.title LIMIT 2000`).all(...args),
    };
  });
}

/** Devine le type de document d'après la notice (sujets, public, Dewey). */
export function guessType(n) {
  const t = normalize([n.subjects, n.title, n.series, n.audience, n.summary?.slice(0, 200)].filter(Boolean).join(' '));
  if (/bandes? dessinees?|\bbd\b|comics/.test(t)) return /manga/.test(t) ? 'manga' : 'bd';
  if (/manga/.test(t)) return 'manga';
  if (/dictionnaire|encyclopedie/.test(t)) return 'reference';
  if (/poesie|poemes|comptines/.test(t)) return 'poesie';
  if (/theatre/.test(t)) return 'theatre';
  if (/\bcontes?\b/.test(t)) return 'conte';
  if (/premieres? lectures?|j.apprends? a lire/.test(t)) return 'premiere_lecture';
  if (/albums?\b|livres? d.images/.test(t)) return 'album';
  if (/romans?\b|recit/.test(t)) return 'roman';
  const dewey = Number(String(n.dewey ?? '').slice(0, 3));
  if (n.dewey && !(dewey >= 800 && dewey < 900)) return 'documentaire';
  if (/documentaire|ouvrages? de vulgarisation/.test(t)) return 'documentaire';
  return n.pages && n.pages < 48 ? 'album' : 'roman';
}
