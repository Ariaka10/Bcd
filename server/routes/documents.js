import { HttpError, normalize } from '../util.js';
import { tx } from '../db.js';
import { staff, admin, anyUser } from '../guards.js';
import { computeCote, DOC_TYPES } from '../cote.js';
import { toIsbn13, cleanIsbn } from '../isbn.js';
import { lookupIsbn as defaultLookup } from '../notice.js';
import { toCsv } from '../csv.js';

const DOC_FIELDS = [
  'isbn', 'title', 'subtitle', 'authors', 'publisher', 'pub_year', 'pages', 'series', 'series_number',
  'doc_type', 'dewey', 'subjects', 'summary', 'audience', 'cover_url', 'cote', 'location', 'notes',
  'source', 'source_url',
];
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
      ||' '||coalesce(d.subjects,'')||' '||coalesce(d.publisher,'')||' '||coalesce(d.cote,'')||' '||coalesce(d.isbn,'')`;
    for (const term of normalize(q.q).split(' ').filter(Boolean)) {
      const isbn = toIsbn13(term);
      if (isbn) { where.push('d.isbn = ?'); args.push(isbn); } else like(all, term);
    }
  }
  if (q.title) like(`coalesce(d.title,'')||' '||coalesce(d.subtitle,'')`, q.title);
  if (q.author) like('d.authors', q.author);
  if (q.subject) like('d.subjects', q.subject);
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
      d.doc_type, d.dewey, d.subjects, d.cote, d.cover_url, d.audience, d.location, d.created_at,
      ${COPIES_SQL} AS copies_count, ${AVAILABLE_SQL} AS available_count
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
  if (!d.cote) d.cote = computeCote(d);
  return d;
}

/** Prochain code-barres libre : PRÉFIXE + numéro sur 6 chiffres. */
export function nextBarcode(db) {
  const prefix = db.prepare(`SELECT value FROM settings WHERE key = 'barcode_prefix'`).get()?.value ?? 'BCD';
  const rows = db.prepare('SELECT barcode FROM copies WHERE barcode LIKE ?').all(prefix + '%');
  let max = 0;
  for (const { barcode } of rows) {
    const n = Number(barcode.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(6, '0');
}

function addCopies(db, docId, { count = 1, barcodes = [] } = {}) {
  const ins = db.prepare('INSERT INTO copies (document_id, barcode) VALUES (?, ?)');
  const created = [];
  const list = barcodes.map((b) => String(b).trim()).filter(Boolean);
  for (const b of list) {
    if (db.prepare('SELECT 1 FROM copies WHERE barcode = ?').get(b)) throw new HttpError(409, `Code-barres déjà utilisé : ${b}`);
    ins.run(docId, b); created.push(b);
  }
  for (let i = list.length; i < Math.min(Number(count) || 0, 50); i++) {
    const b = nextBarcode(db);
    ins.run(docId, b); created.push(b);
  }
  return created;
}

export function getDocument(db, id, user) {
  const d = db.prepare(`SELECT d.*, ${AVAILABLE_SQL} AS available_count, ${COPIES_SQL} AS copies_count
    FROM documents d WHERE d.id = ?`).get(id);
  if (!d) throw new HttpError(404, 'Document introuvable');
  const isStaff = user && user.role !== 'eleve';
  d.copies = db.prepare(`
    SELECT c.id, c.barcode, c.state, c.acquired_at, c.notes,
      l.id AS loan_id, l.due_at, l.loaned_at, l.user_id,
      u.first_name || ' ' || u.last_name AS borrower, cl.name AS borrower_class
    FROM copies c
    LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_at IS NULL
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN classes cl ON cl.id = u.class_id
    WHERE c.document_id = ? ORDER BY c.barcode`).all(id);
  if (!isStaff) for (const c of d.copies) { delete c.borrower; delete c.borrower_class; delete c.user_id; delete c.loan_id; }
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

  r.get('/api/documents', anyUser, ({ db, query }) => searchDocuments(db, query));

  r.get('/api/documents/export.csv', staff, ({ db, query, res }) => {
    const { items } = searchDocuments(db, { ...query, limit: 5000 });
    const rows = [['Cote', 'Titre', 'Auteurs', 'Éditeur', 'Année', 'Collection', 'Type', 'ISBN', 'Sujets', 'Exemplaires', 'Disponibles']];
    for (const d of items) {
      rows.push([d.cote, d.title, d.authors, d.publisher, d.pub_year, d.series, DOC_TYPES[d.doc_type]?.label,
        d.isbn, d.subjects, d.copies_count, d.available_count]);
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="catalogue.csv"' });
    res.end(toCsv(rows));
  });

  r.get('/api/documents/:id', anyUser, ({ db, params, user }) => getDocument(db, Number(params.id), user));

  r.post('/api/documents', staff, ({ db, body }) => tx(db, () => {
    const d = sanitizeDoc(body);
    const cols = DOC_FIELDS;
    const { lastInsertRowid } = db.prepare(`INSERT INTO documents (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => d[c] ?? null));
    const id = Number(lastInsertRowid);
    const barcodes = addCopies(db, id, { count: body.copies ?? 1, barcodes: body.barcodes ?? [] });
    return { id, cote: d.cote, barcodes };
  }));

  r.put('/api/documents/:id', staff, ({ db, params, body }) => {
    const existing = db.prepare('SELECT * FROM documents WHERE id = ?').get(params.id);
    if (!existing) throw new HttpError(404, 'Document introuvable');
    const d = sanitizeDoc(body, existing);
    db.prepare(`UPDATE documents SET ${DOC_FIELDS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...DOC_FIELDS.map((c) => d[c] ?? null), existing.id);
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

  r.post('/api/cote', staff, ({ body }) => ({ cote: computeCote(body) }));

  r.get('/api/isbn/:isbn', staff, async ({ db, params }) => {
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
  r.post('/api/documents/:id/copies', staff, ({ db, params, body }) => tx(db, () => {
    if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(params.id)) throw new HttpError(404, 'Document introuvable');
    return { barcodes: addCopies(db, Number(params.id), { count: body.count ?? (body.barcode ? 0 : 1), barcodes: body.barcode ? [body.barcode] : [] }) };
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

  r.put('/api/copies/:id', staff, ({ db, params, body }) => {
    const c = db.prepare('SELECT * FROM copies WHERE id = ?').get(params.id);
    if (!c) throw new HttpError(404, 'Exemplaire introuvable');
    const state = body.state ?? c.state;
    if (!COPY_STATES.includes(state)) throw new HttpError(400, 'État inconnu');
    const barcode = String(body.barcode ?? c.barcode).trim();
    if (!barcode) throw new HttpError(400, 'Code-barres requis');
    db.prepare('UPDATE copies SET state = ?, barcode = ?, notes = ? WHERE id = ?')
      .run(state, barcode, body.notes ?? c.notes, c.id);
    return { ok: true };
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
