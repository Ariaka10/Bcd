import { HttpError } from '../util.js';
import { tx } from '../db.js';
import { staff } from '../guards.js';
import { DOC_TYPES } from '../cote.js';
import { toCsv } from '../csv.js';
import { buildSearch } from './documents.js';

function listItems(db, id) {
  return db.prepare(`
    SELECT d.id, d.title, d.subtitle, d.authors, d.publisher, d.pub_year, d.cote, d.doc_type, d.cover_url, d.isbn,
      d.series, d.summary, i.position,
      (SELECT COUNT(*) FROM copies c WHERE c.document_id = d.id AND c.state IN ('ok', 'abime')
        AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.returned_at IS NULL)) AS available_count
    FROM list_items i JOIN documents d ON d.id = i.document_id
    WHERE i.list_id = ? ORDER BY i.position, d.cote, d.title`).all(id);
}

function addItems(db, listId, ids) {
  const max = db.prepare('SELECT coalesce(MAX(position), 0) AS m FROM list_items WHERE list_id = ?').get(listId).m;
  const ins = db.prepare('INSERT OR IGNORE INTO list_items (list_id, document_id, position) VALUES (?, ?, ?)');
  let added = 0;
  ids.forEach((id, i) => { added += Number(ins.run(listId, Number(id), max + i + 1).changes); });
  return added;
}

export default function (r) {
  r.get('/api/lists', staff, ({ db }) => db.prepare(`
    SELECT l.id, l.name, l.description, l.created_at, u.first_name || ' ' || u.last_name AS author,
      (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS count
    FROM lists l LEFT JOIN users u ON u.id = l.created_by ORDER BY l.name`).all());

  r.post('/api/lists', staff, ({ db, body, user }) => tx(db, () => {
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Nom de liste requis');
    const id = Number(db.prepare('INSERT INTO lists (name, description, created_by) VALUES (?, ?, ?)')
      .run(name, body.description || null, user.id).lastInsertRowid);
    let ids = body.document_ids ?? [];
    // Liste thématique créée à partir d'une recherche (ex. tous les documentaires sur les animaux).
    if (body.from_search) {
      const { sql, args } = buildSearch(body.from_search);
      ids = db.prepare(`SELECT d.id FROM documents d ${sql} ORDER BY d.cote, d.title LIMIT 2000`).all(...args).map((x) => x.id);
    }
    return { id, added: addItems(db, id, ids) };
  }));

  r.get('/api/lists/:id', staff, ({ db, params }) => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(params.id);
    if (!l) throw new HttpError(404, 'Liste introuvable');
    l.items = listItems(db, l.id);
    return l;
  });

  r.put('/api/lists/:id', staff, ({ db, params, body }) => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(params.id);
    if (!l) throw new HttpError(404, 'Liste introuvable');
    db.prepare('UPDATE lists SET name = ?, description = ? WHERE id = ?')
      .run(String(body.name ?? l.name).trim() || l.name, body.description ?? l.description, l.id);
    if (Array.isArray(body.order)) {
      const upd = db.prepare('UPDATE list_items SET position = ? WHERE list_id = ? AND document_id = ?');
      body.order.forEach((docId, i) => upd.run(i + 1, l.id, Number(docId)));
    }
    return { ok: true };
  });

  r.delete('/api/lists/:id', staff, ({ db, params }) => {
    db.prepare('DELETE FROM lists WHERE id = ?').run(params.id);
    return { ok: true };
  });

  r.post('/api/lists/:id/items', staff, ({ db, params, body }) => {
    if (!db.prepare('SELECT 1 FROM lists WHERE id = ?').get(params.id)) throw new HttpError(404, 'Liste introuvable');
    return { added: addItems(db, Number(params.id), body.document_ids ?? []) };
  });

  r.delete('/api/lists/:id/items/:docId', staff, ({ db, params }) => {
    db.prepare('DELETE FROM list_items WHERE list_id = ? AND document_id = ?').run(params.id, params.docId);
    return { ok: true };
  });

  r.get('/api/lists/:id/export.csv', staff, ({ db, params, res }) => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(params.id);
    if (!l) throw new HttpError(404, 'Liste introuvable');
    const rows = [['Cote', 'Titre', 'Auteurs', 'Éditeur', 'Année', 'Type', 'ISBN', 'Disponible']];
    for (const d of listItems(db, l.id)) {
      rows.push([d.cote, d.title, d.authors, d.publisher, d.pub_year, DOC_TYPES[d.doc_type]?.label, d.isbn, d.available_count ? 'oui' : 'non']);
    }
    const fname = l.name.normalize('NFD').replace(/[^\w-]+/g, '_');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}.csv"` });
    res.end(toCsv(rows));
  });
}
